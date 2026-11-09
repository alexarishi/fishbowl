const { server } = require('./server');
const assert = require('assert');
const PORT = 4569, BASE = `http://127.0.0.1:${PORT}`;
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
  // deterministic teams: host+Bob+Cy on team 0 ; Di+Eve on team 1
  await host.act('clearTeams');
  for (const [c, t] of [[host, 0], [bob, 0], [cy, 0], [di, 1], [eve, 1]]) await host.act('setTeam', { playerId: c.pid, team: t });

  // who may rename what
  assert.deepEqual(host.state.canRename, [true, false], 'host names own team only');
  assert.deepEqual(di.state.canRename, [false, true], 'first member of the other team is the namer');
  assert.deepEqual(eve.state.canRename, [false, false], 'second member of other team cannot');
  assert.deepEqual(bob.state.canRename, [false, false], 'teammate of host cannot');
  assert.deepEqual(host.state.namers, ['Ann', 'Di']);
  assert.deepEqual(eve.state.teamNames, ['Team Coral', 'Team Seafoam'], 'defaults');

  // renaming
  assert((await host.act('renameTeam', { team: 0, name: '  The   Sharks  ' })).ok);
  assert((await di.act('renameTeam', { team: 1, name: 'Dolphins' })).ok);
  for (const c of cs) assert.deepEqual(c.state.teamNames, ['The Sharks', 'Dolphins'], c.name + ' sees both names live');

  // forbidden
  let r = await eve.act('renameTeam', { team: 1, name: 'Nope' }); assert(!r.ok && /Di/.test(r.error), r.error);
  r = await bob.act('renameTeam', { team: 0, name: 'Nope' }); assert(!r.ok);
  r = await host.act('renameTeam', { team: 1, name: 'Hijack' }); assert(!r.ok, 'host cannot override a present namer');
  r = await di.act('renameTeam', { team: 0, name: 'Hijack' }); assert(!r.ok, 'namer cannot rename the other team');
  assert(!(await host.act('renameTeam', { team: 5, name: 'x' })).ok);
  assert.deepEqual(host.state.teamNames, ['The Sharks', 'Dolphins']);

  // validation: unique (case-insensitive), trimmed/sanitised, length cap, empty resets
  r = await di.act('renameTeam', { team: 1, name: 'the sharks' }); assert(!r.ok && /already/.test(r.error));
  assert((await di.act('renameTeam', { team: 1, name: '<b>Wave</b> Riders and some very long name' })).ok);
  assert(!/[<>]/.test(host.state.teamNames[1]) && host.state.teamNames[1].length <= 20, host.state.teamNames[1]);
  assert((await di.act('renameTeam', { team: 1, name: '' })).ok); assert.equal(host.state.teamNames[1], 'Team Seafoam', 'empty = default');
  assert((await di.act('renameTeam', { team: 1, name: 'Dolphins' })).ok);

  // moving the namer away hands the job to the next member; names stay with the team
  await host.act('setTeam', { playerId: di.pid, team: 0 });
  assert.deepEqual(eve.state.canRename, [false, true]); assert.deepEqual(di.state.canRename, [false, false]);
  assert.equal(host.state.teamNames[1], 'Dolphins');
  await host.act('setTeam', { playerId: di.pid, team: 1 });
  assert.deepEqual(di.state.canRename, [false, true], 'Di is first member again');

  // empty team -> host may name it
  await host.act('setTeam', { playerId: di.pid, team: 0 }); await host.act('setTeam', { playerId: eve.pid, team: 0 });
  assert.deepEqual(host.state.canRename, [true, true]);
  assert((await host.act('renameTeam', { team: 1, name: 'Ghosts' })).ok);
  await host.act('setTeam', { playerId: di.pid, team: 1 }); await host.act('setTeam', { playerId: eve.pid, team: 1 });
  await host.act('renameTeam', { team: 1, name: 'Dolphins' }); // host is allowed? namer Di exists now
  await di.act('renameTeam', { team: 1, name: 'Dolphins' });

  // shuffle keeps names; whoever lands where, exactly one namer per team
  await host.act('reshuffleTeams');
  assert.deepEqual(host.state.teamNames, ['The Sharks', 'Dolphins']);
  const n = (t) => cs.filter((c) => c.state.canRename[t]).length;
  assert.equal(n(0), 1); assert.equal(n(1), 1, 'exactly one namer per team');
  const hostTeam = host.state.me.team; assert(host.state.canRename[hostTeam], 'host always names own team');

  // names flow into the game and lock once play starts
  await host.act('clearTeams');
  for (const [c, t] of [[host, 0], [bob, 0], [cy, 0], [di, 1], [eve, 1]]) await host.act('setTeam', { playerId: c.pid, team: t });
  await host.act('toRoundIntro');
  assert(!(await host.act('renameTeam', { team: 0, name: 'Late' })).ok, 'locked after teams are confirmed');
  await host.act('startRound');
  assert.equal(eve.state.teamNames[host.state.turn.team], host.state.turn.team === 0 ? 'The Sharks' : 'Dolphins');

  // play again resets names to defaults
  const g = cs.find((c) => c.pid === host.state.turn.giverId);
  await g.act('startTurn');
  while (host.state.turn && host.state.turn.status === 'active') await g.act('got');
  while (host.state.phase === 'playing' || host.state.phase === 'roundIntro') {
    if (host.state.phase === 'roundIntro') { await host.act('startRound'); continue; }
    const t = host.state.turn; const gv = cs.find((c) => c.pid === t.giverId);
    if (t.status === 'review') await gv.act('confirmReview');
    else if (t.status === 'ready') await gv.act('startTurn');
    else await gv.act('got');
  }
  assert.equal(host.state.phase, 'gameOver');
  await host.act('playAgain'); assert.equal(host.state.phase, 'lobby');
  assert.deepEqual(host.state.teamNames, ['Team Coral', 'Team Seafoam']);
  console.log('team naming: permissions, validation, hand-over, shuffle, lock, reset all OK');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
