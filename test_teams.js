const { server } = require('./server');
const assert = require('assert');
const PORT = 4568, BASE = `http://127.0.0.1:${PORT}`;
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { ok: r.ok, ...(await r.json()) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(name) {
  const c = { name, state: null };
  c.connect = async () => {
    const r = await fetch(`${BASE}/api/events?code=${c.code}&pid=${c.pid}`);
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = ev.match(/^event: state\ndata: (.*)$/m); if (m) c.state = JSON.parse(m[1]); } } } catch {} })();
  };
  c.act = async (type, extra = {}) => { const r = await post('/api/action', { code: c.code, pid: c.pid, type, ...extra }); await sleep(25); return r; };
  return c;
}
(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const cs = ['Ann', 'Bob', 'Cy', 'Di', 'Eve'].map(client);
  const cr = await post('/api/create', { name: 'Ann' }); cs[0].code = cr.code; cs[0].pid = cr.pid;
  for (const c of cs.slice(1)) { const r = await post('/api/join', { code: cr.code, name: c.name }); c.code = r.code; c.pid = r.pid; }
  for (const c of cs) await c.connect(); await sleep(150);
  const [host, bob, cy, di, eve] = cs;
  await host.act('startWriting');
  for (const c of cs) await c.act('submitWords', { words: [c.name + '1', c.name + '2', c.name + '3'] });
  await host.act('assignTeams');
  const team = (c) => host.state.players.find((p) => p.id === c.pid).team;
  const counts = () => [0, 1].map((t) => host.state.players.filter((p) => p.team === t).length);
  assert.equal(host.state.phase, 'teams'); assert.deepEqual(counts().sort(), [2, 3]);
  const ids = (t) => host.state.players.filter((p) => p.team === t).map((p) => p.name).sort().join(',');

  // permissions
  assert(!(await bob.act('setTeam', { playerId: cy.pid, team: 0 })).ok, 'non-host cannot move players');
  assert(!(await bob.act('clearTeams')).ok, 'non-host cannot clear');
  // validation
  assert(!(await host.act('setTeam', { playerId: 'nope', team: 0 })).ok);
  assert(!(await host.act('setTeam', { playerId: cy.pid, team: 7 })).ok);

  // manual: clear, then everyone shows as unassigned to all players
  assert((await host.act('clearTeams')).ok);
  assert.deepEqual(counts(), [0, 0]);
  assert(host.state.players.every((p) => p.team === null) && bob.state.players.every((p) => p.team === null), 'everyone sees unassigned');
  assert.equal(bob.state.me.team, null);
  assert(!(await host.act('toRoundIntro')).ok, 'cannot continue with nobody assigned');

  // assign 4 of 5 -> still blocked
  for (const [c, t] of [[host, 0], [bob, 0], [cy, 1], [di, 1]]) assert((await host.act('setTeam', { playerId: c.pid, team: t })).ok);
  assert.equal(bob.state.me.team, 0); assert.equal(cy.state.me.team, 1, 'players see their own team update live');
  let r = await host.act('toRoundIntro'); assert(!r.ok && /Eve/.test(r.error), 'blocked while Eve unassigned: ' + r.error);

  // an empty team is blocked
  await host.act('setTeam', { playerId: eve.pid, team: 0 });
  for (const c of [cy, di]) await host.act('setTeam', { playerId: c.pid, team: 0 });
  assert.deepEqual(counts(), [5, 0]);
  r = await host.act('toRoundIntro'); assert(!r.ok && /at least one/.test(r.error), r.error);

  // move players across (uneven 4/1 is allowed), unassign + reassign
  await host.act('setTeam', { playerId: eve.pid, team: 1 });
  assert.deepEqual(counts(), [4, 1]);
  await host.act('setTeam', { playerId: eve.pid, team: null }); assert.equal(team(eve), null);
  await host.act('setTeam', { playerId: eve.pid, team: 1 });

  // random reshuffle still works and gives a balanced, fully assigned result
  assert((await host.act('reshuffleTeams')).ok);
  assert.deepEqual(counts().sort(), [2, 3]); assert(host.state.players.every((p) => p.team === 0 || p.team === 1));

  // manual tweak after shuffle, then start playing; turns follow the manual teams
  await host.act('clearTeams');
  for (const [c, t] of [[host, 0], [bob, 1], [cy, 0], [di, 1], [eve, 1]]) await host.act('setTeam', { playerId: c.pid, team: t });
  assert((await host.act('toRoundIntro')).ok); assert.equal(host.state.phase, 'roundIntro');
  assert(!(await host.act('setTeam', { playerId: bob.pid, team: 0 })).ok, 'teams locked once the game starts');
  assert((await host.act('startRound')).ok);
  const t0 = host.state.turn; assert.equal(t0.team, 0);
  assert(['Ann', 'Cy'].includes(t0.giverName), 'first giver comes from team 0: ' + t0.giverName);
  const giver = cs.find((c) => c.pid === t0.giverId);
  await giver.act('startTurn'); await giver.act('endTurn'); await giver.act('confirmReview');
  assert.equal(host.state.turn.team, 1); assert(['Bob', 'Di', 'Eve'].includes(host.state.turn.giverName));
  console.log('manual teams, clear, shuffle, guards, lock-in all OK');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
