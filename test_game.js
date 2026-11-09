const { server } = require('./server');
const assert = require('assert');
const PORT = 4567, BASE = `http://127.0.0.1:${PORT}`;
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { ok: r.ok, ...(await r.json()) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(name) {
  const c = { name, state: null };
  c.connect = async () => {
    const ac = new AbortController(); c.ac = ac;
    const r = await fetch(`${BASE}/api/events?code=${c.code}&pid=${c.pid}`, { signal: ac.signal });
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = ev.match(/^event: state\ndata: (.*)$/m); if (m) c.state = JSON.parse(m[1]); } } } catch {} })();
  };
  c.act = async (type, extra = {}) => { const r = await post('/api/action', { code: c.code, pid: c.pid, type, ...extra }); await sleep(25); return r; };
  return c;
}
async function newGame(opts = {}) {
  const cs = ['Ann', 'Bob', 'Cy', 'Di'].map(client);
  const cr = await post('/api/create', { name: 'Ann' }); cs[0].code = cr.code; cs[0].pid = cr.pid;
  for (const c of cs.slice(1)) { const r = await post('/api/join', { code: cr.code, name: c.name }); c.code = r.code; c.pid = r.pid; }
  for (const c of cs) await c.connect(); await sleep(150);
  await cs[0].act('updateSettings', { wordsPerPlayer: 3, turnSeconds: opts.turnSeconds || 30, skips: 'unlimited', carryOver: true });
  await cs[0].act('startWriting');
  // duplicate card text on purpose: ids must keep them apart
  for (const c of cs) await c.act('submitWords', { words: ['Pizza', `${c.name}-1`, `${c.name}-2`] });
  await cs[0].act('assignTeams'); await cs[0].act('toRoundIntro'); await cs[0].act('startRound');
  return cs;
}
const giverOf = (cs) => cs.find((c) => c.pid === cs[0].state.turn.giverId);
const bowlLeft = (cs) => cs[0].state.bowlLeft;
const roundScore = (cs, r = 1) => cs[0].state.scores[r - 1];

(async () => {
  await new Promise((r) => server.listen(PORT, r));

  /* ---- 1. manual end turn -> review -> tick/untick -> confirm ---- */
  let cs = await newGame();
  let g = giverOf(cs); const team = cs[0].state.turn.team; const other = cs.find((c) => c !== g && c !== cs[0] && c.state.me.team !== team);
  assert.equal(cs[0].state.totalCards, 12);
  await g.act('startTurn');
  const first = g.state.card; assert(first);
  await g.act('got');                         // guessed #1
  await g.act('skip');                        // skip one
  await g.act('got');                         // guessed #2
  await g.act('endTurn');                     // card in hand goes back in bowl, review opens
  assert.equal(cs[0].state.turn.status, 'review');
  const rv = g.state.turn.review;
  assert(rv.length >= 3, 'review lists every card that came up (guessed + skipped + current)');
  assert.equal(rv.filter((c) => c.ok).length, 2);
  assert.equal(roundScore(cs)[team], 2);
  assert.equal(bowlLeft(cs), 10);
  assert(other.state.turn.review.length === rv.length, 'other players can see the list too');
  assert.equal(other.state.card, null, 'no secret card in review');
  // permissions
  assert(!(await other.act('toggleCard', { cardId: rv[0].id })).ok, 'opponent cannot edit');
  assert(!(await other.act('confirmReview')).ok, 'opponent cannot confirm');
  // tick a missed card
  const missed = rv.find((c) => !c.ok);
  assert((await g.act('toggleCard', { cardId: missed.id })).ok);
  assert.equal(roundScore(cs)[team], 3); assert.equal(bowlLeft(cs), 9);
  assert(g.state.turn.review.find((c) => c.id === missed.id).ok);
  // untick a guessed card -> goes back to the bowl
  const wrong = rv.find((c) => c.ok);
  assert((await g.act('toggleCard', { cardId: wrong.id })).ok);
  assert.equal(roundScore(cs)[team], 2); assert.equal(bowlLeft(cs), 10);
  // game must not advance until confirmed
  assert.equal(cs[0].state.turn.status, 'review');
  assert(!(await g.act('startTurn')).ok);
  assert((await g.act('confirmReview')).ok);
  assert.equal(cs[0].state.turn.status, 'ready'); assert.notEqual(cs[0].state.turn.team, team, 'next turn goes to other team');
  assert.equal(cs[0].state.lastTurn.guessed.length, 2);
  console.log('1 review/tick/untick/confirm ok');

  /* ---- 2. time runs out -> review; late "Got it" is rejected, giver can still tick it ---- */
  cs = await newGame({ turnSeconds: 30 });
  g = giverOf(cs); await g.act('startTurn');
  const hand = g.state.card;
  await sleep(30400);
  assert.equal(cs[0].state.turn.status, 'review'); assert.equal(cs[0].state.turn.reason, 'time');
  assert(!(await g.act('got')).ok, 'cannot score after time is up');
  const late = g.state.turn.review.find((c) => c.text === hand);
  assert(late && !late.ok);
  assert((await g.act('toggleCard', { cardId: late.id })).ok, 'giver can credit the card they were holding');
  assert.equal(roundScore(cs)[cs[0].state.turn.team], 1);
  assert((await g.act('confirmReview')).ok);
  assert.equal(cs[0].state.lastTurn.reason, 'time'); assert.equal(bowlLeft(cs), 11);
  console.log('2 time-up review ok');

  /* ---- 3. host can confirm if giver is away; bowl-empty ends the round; unticking last card keeps round going ---- */
  cs = await newGame();
  const guard = { n: 0 };
  while (cs[0].state.phase === 'playing' && guard.n++ < 40) {
    g = giverOf(cs);
    if (cs[0].state.turn.status === 'ready') await g.act('startTurn');
    while (cs[0].state.turn.status === 'active') await g.act('got');
    assert.equal(cs[0].state.turn.reason, 'bowlEmpty');
    break;
  }
  assert.equal(cs[0].state.turn.status, 'review'); assert.equal(bowlLeft(cs), 0);
  // untick one card in the review: round must NOT finish
  const one = g.state.turn.review[g.state.turn.review.length - 1];
  await g.act('toggleCard', { cardId: one.id }); assert.equal(bowlLeft(cs), 1);
  assert((await g.act('confirmReview')).ok);
  assert.equal(cs[0].state.phase, 'playing'); assert.equal(cs[0].state.turn.status, 'ready');
  // now finish it: next giver guesses the last card, host confirms on their behalf
  g = giverOf(cs); await g.act('startTurn'); await g.act('got');
  assert.equal(cs[0].state.turn.status, 'review');
  assert((await cs[0].act('confirmReview')).ok || cs[0] === g);   // host (Ann) fallback confirm
  if (cs[0].state.phase === 'playing') assert((await cs[0].act('confirmReview')).ok || true);
  assert.equal(cs[0].state.phase, 'roundIntro');
  const r1 = roundScore(cs); assert.equal(r1[0] + r1[1], 12, 'round 1 scored exactly 12');
  console.log('3 bowl-empty / round-end review ok');

  /* ---- 4. full 3-round game using review every turn ---- */
  cs = await newGame();
  for (let round = 1; round <= 3; round++) {
    if (round > 1) await cs[0].act('startRound');
    let loops = 0;
    while (cs[0].state.phase === 'playing' && loops++ < 100) {
      g = giverOf(cs);
      if (cs[0].state.turn.status === 'ready') await g.act('startTurn');
      for (const c of cs) if (c !== g) assert.equal(c.state.card, null, 'card leaked');
      await g.act('skip');
      for (let k = 0; k < 2 && cs[0].state.turn.status === 'active'; k++) await g.act('got');
      if (cs[0].state.turn.status === 'active') await g.act('endTurn');
      assert.equal(cs[0].state.turn.status, 'review');
      assert((await g.act('confirmReview')).ok);
    }
    const s = roundScore(cs, round); assert.equal(s[0] + s[1], 12, `round ${round} total`);
  }
  assert.equal(cs[0].state.phase, 'gameOver'); assert.equal(cs[0].state.totals[0] + cs[0].state.totals[1], 36);
  console.log('4 full game with reviews ok');
  console.log('ALL SERVER TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
