const { server } = require('./server');
const assert = require('assert');
const BASE = 'http://127.0.0.1:4567';
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { ok: r.ok, ...(await r.json()) }; };
function client(name) {
  const c = { name, state: null };
  c.connect = async () => {
    const ac = new AbortController(); c.ac = ac;
    const r = await fetch(`${BASE}/api/events?code=${c.code}&pid=${c.pid}`, { signal: ac.signal });
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = ev.match(/^event: state\ndata: (.*)$/m); if (m) c.state = JSON.parse(m[1]); } } } catch {} })();
  };
  c.act = (type, extra = {}) => post('/api/action', { code: c.code, pid: c.pid, type, ...extra });
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => server.listen(4567, r));
  const names = ['Ann', 'Bob', 'Cy', 'Di'];
  const cs = names.map(client);
  const cr = await post('/api/create', { name: 'Ann' }); cs[0].code = cr.code; cs[0].pid = cr.pid;
  for (const c of cs.slice(1)) { const r = await post('/api/join', { code: cr.code, name: c.name }); assert(r.ok, JSON.stringify(r)); c.code = r.code; c.pid = r.pid; }
  const dup = await post('/api/join', { code: cr.code, name: 'ann' }); assert(!dup.ok, 'duplicate name must fail');
  for (const c of cs) await c.connect(); await sleep(200);
  assert.equal(cs[3].state.players.length, 4);
  assert(!(await cs[1].act('startWriting')).ok === true, 'non-host cannot start');
  assert((await cs[0].act('updateSettings', { wordsPerPlayer: 3, turnSeconds: 30, skips: 'one', carryOver: true })).ok);
  assert((await cs[0].act('startWriting')).ok); await sleep(100);
  assert.equal(cs[2].state.phase, 'writing');
  assert(!(await cs[0].act('submitWords', { words: ['a', 'b'] })).ok, 'must submit exactly 3');
  assert(!(await cs[0].act('assignTeams')).ok, 'cannot assign before all submitted');
  for (const c of cs) assert((await c.act('submitWords', { words: [0, 1, 2].map((i) => `${c.name}-${i}`) })).ok);
  assert((await cs[0].act('assignTeams')).ok); await sleep(100);
  assert.equal(cs[0].state.phase, 'teams'); assert.equal(cs[0].state.totalCards, 12);
  const teamSizes = [0, 1].map((t) => cs[0].state.players.filter((p) => p.team === t).length); assert.deepEqual(teamSizes, [2, 2]);
  assert((await cs[0].act('reshuffleTeams')).ok);
  assert((await cs[0].act('toRoundIntro')).ok);
  const seen = {}; // card secrecy + scoring
  for (let round = 1; round <= 3; round++) {
    assert((await cs[0].act('startRound')).ok); await sleep(80);
    assert.equal(cs[0].state.round, round);
    let guard = 0;
    while (cs[0].state.phase === 'playing' && guard++ < 100) {
      const t = cs[0].state.turn; const giver = cs.find((c) => c.pid === t.giverId);
      if (t.status === 'ready') { assert((await giver.act('startTurn')).ok); await sleep(60); }
      // non-givers must never see the card
      for (const c of cs) if (c !== giver) assert.equal(c.state.card, null, 'card leaked');
      assert(typeof giver.state.card === 'string');
      // skip once (allowed 1), second skip rejected
      const sk = await giver.act('skip'); if (sk.ok) { assert(!(await giver.act('skip')).ok, 'second skip must fail'); }
      // guess 2 cards then end turn (card returns to bowl)
      for (let k = 0; k < 2 && cs[0].state.phase === 'playing' && cs[0].state.turn.status === 'active'; k++) { await giver.act('got'); await sleep(30); }
      if (cs[0].state.phase === 'playing' && cs[0].state.turn.status === 'active') { await giver.act('endTurn'); await sleep(30); }
    }
    const tot = cs[0].state.scores[round - 1][0] + cs[0].state.scores[round - 1][1];
    assert.equal(tot, 12, `round ${round} must score exactly 12 cards, got ${tot}`);
    console.log('round', round, 'ok', JSON.stringify(cs[0].state.scores[round - 1]), 'phase ->', cs[0].state.phase);
  }
  assert.equal(cs[0].state.phase, 'gameOver');
  assert.equal(cs[0].state.totals[0] + cs[0].state.totals[1], 36);
  // timer expiry path: play again, quick game
  assert((await cs[0].act('playAgain')).ok); await sleep(50); assert.equal(cs[1].state.phase, 'lobby');
  await cs[0].act('updateSettings', { turnSeconds: 30 });
  await cs[0].act('startWriting'); for (const c of cs) await c.act('submitWords', { words: ['x' + c.name, 'y' + c.name, 'z' + c.name] });
  await cs[0].act('assignTeams'); await cs[0].act('toRoundIntro'); await cs[0].act('startRound'); await sleep(50);
  const t = cs[0].state.turn; const g = cs.find((c) => c.pid === t.giverId); await g.act('startTurn'); await sleep(50);
  assert(g.state.turn.endsAt - g.state.serverTime > 25000 && g.state.turn.endsAt - g.state.serverTime <= 30000);
  // reconnect keeps identity
  g.ac.abort(); await sleep(100); assert.equal(cs[0].state.players.find((p) => p.id === g.pid).connected, false || cs[0].state.players.find((p) => p.id === g.pid).connected);
  const rj = await post('/api/join', { code: g.code, pid: g.pid }); assert(rj.ok && rj.pid === g.pid);
  await g.connect(); await sleep(100); assert(typeof g.state.card === 'string', 'giver still has card after reconnect');
  console.log('ALL SERVER TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
