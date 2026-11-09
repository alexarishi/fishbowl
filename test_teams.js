// Manual team distribution + random shuffle + team names (host + one player on the other team), v4 rules
const { server } = require('./server'); const assert = require('assert');
const { sleep, makeRoom, toTeams, PORT } = require('./test_helpers');
(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const cs = await makeRoom(['A', 'B', 'C', 'D', 'E', 'F']); await toTeams(cs);
  const [A, B, C, D, E, F] = cs;
  const names = (t) => A.state.players.filter((p) => p.team === t).map((p) => p.name).sort().join('');
  assert.equal(A.state.phase, 'teams'); assert.equal(A.state.players.filter((p) => p.team === 0).length, 3, 'auto draw is 3/3');

  // permissions & validation
  assert(!(await B.act('setTeam', { playerId: C.pid, team: 0 })).ok); assert(!(await B.act('clearTeams')).ok); assert(!(await B.act('reshuffleTeams')).ok);
  assert(!(await A.act('setTeam', { playerId: 'nope', team: 0 })).ok); assert(!(await A.act('setTeam', { playerId: C.pid, team: 7 })).ok);

  // the example: A hosts; A + C + D vs B + E + F
  assert((await A.act('clearTeams')).ok);
  assert(A.state.players.every((p) => p.team === null) && B.state.players.every((p) => p.team === null));
  assert(!(await A.act('toRoundIntro')).ok, 'cannot continue with nobody assigned');
  for (const [c, t] of [[A, 0], [C, 0], [D, 0], [B, 1], [E, 1]]) assert((await A.act('setTeam', { playerId: c.pid, team: t })).ok);
  let r = await A.act('toRoundIntro'); assert(!r.ok && /F/.test(r.error), r.error);
  await A.act('setTeam', { playerId: F.pid, team: 1 });
  assert.equal(names(0), 'ACD'); assert.equal(names(1), 'BEF'); assert.equal(B.state.me.team, 1); assert.equal(C.state.me.team, 0);
  await A.act('setTeam', { playerId: F.pid, team: 0 }); assert.equal(names(0), 'ACDF');
  await A.act('setTeam', { playerId: F.pid, team: null }); await A.act('setTeam', { playerId: F.pid, team: 1 });
  const alt = await makeRoom(['H', 'I', 'J', 'K']); await toTeams(alt); await alt[0].act('clearTeams');
  for (const c of alt) await alt[0].act('setTeam', { playerId: c.pid, team: 0 });
  r = await alt[0].act('toRoundIntro'); assert(!r.ok && /at least one/.test(r.error), r.error);
  console.log('manual distribution (A+C+D vs B+E+F) ok');

  // naming: host names own team; ONE player (first connected member) names the other
  assert.deepEqual(A.state.canRename, [true, false]); assert.deepEqual(B.state.canRename, [false, true]);
  assert.deepEqual(E.state.canRename, [false, false]); assert.deepEqual(C.state.canRename, [false, false]);
  assert.deepEqual(A.state.namers, ['A', 'B']);
  assert((await A.act('renameTeam', { team: 0, name: '  The   Sharks  ' })).ok); assert((await B.act('renameTeam', { team: 1, name: 'Dolphins' })).ok);
  for (const c of cs) assert.deepEqual(c.state.teamNames, ['The Sharks', 'Dolphins']);
  r = await E.act('renameTeam', { team: 1, name: 'Nope' }); assert(!r.ok && /B/.test(r.error));
  assert(!(await C.act('renameTeam', { team: 0, name: 'Nope' })).ok); assert(!(await A.act('renameTeam', { team: 1, name: 'Hijack' })).ok); assert(!(await B.act('renameTeam', { team: 0, name: 'Hijack' })).ok);
  r = await B.act('renameTeam', { team: 1, name: 'the sharks' }); assert(!r.ok && /already/.test(r.error));
  assert((await B.act('renameTeam', { team: 1, name: '<b>Wave</b> Riders and a very long name' })).ok);
  assert(!/[<>]/.test(A.state.teamNames[1]) && A.state.teamNames[1].length <= 20);
  assert((await B.act('renameTeam', { team: 1, name: '' })).ok); assert.equal(A.state.teamNames[1], 'Team Seafoam'); await B.act('renameTeam', { team: 1, name: 'Dolphins' });
  await A.act('setTeam', { playerId: B.pid, team: 0 }); assert.deepEqual(E.state.canRename, [false, true], 'next member takes over'); await A.act('setTeam', { playerId: B.pid, team: 1 });
  assert((await A.act('reshuffleTeams')).ok); assert.equal(A.state.players.filter((p) => p.team === 0).length, 3);
  assert(A.state.canRename[A.state.me.team], 'host always names own team');
  await A.act('clearTeams'); for (const [c, t] of [[A, 0], [C, 0], [D, 0], [B, 1], [E, 1], [F, 1]]) await A.act('setTeam', { playerId: c.pid, team: t });
  await A.act('renameTeam', { team: 0, name: 'The Sharks' }); await B.act('renameTeam', { team: 1, name: 'Dolphins' });
  assert((await A.act('toRoundIntro')).ok); assert(!(await A.act('renameTeam', { team: 0, name: 'Late' })).ok, 'locked once confirmed');
  assert(!(await A.act('setTeam', { playerId: B.pid, team: 0 })).ok, 'teams locked once confirmed');
  await A.act('startRound'); assert.equal(A.state.turn.team, 0); assert(['A', 'C', 'D'].includes(A.state.turn.giverName));
  assert.deepEqual(F.state.teamNames, ['The Sharks', 'Dolphins']);
  console.log('team naming ok'); console.log('TEAM TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
