// Manual team distribution + random shuffle + team naming (host + one random player on the other team)
const { server } = require('./server'); const assert = require('assert');
const { sleep, makeRoom, toTeams, PORT } = require('./test_helpers');
(async () => {
  await new Promise((r) => server.listen(PORT, r));

  /* ---- the example from the brief: A hosts, B C D E F join; A + C + D vs B + E + F ---- */
  const cs = await makeRoom(['A', 'B', 'C', 'D', 'E', 'F']); await toTeams(cs);
  const [A, B, C, D, E, F] = cs;
  const team = (c) => A.state.players.find((p) => p.id === c.pid).team;
  const names = (t) => A.state.players.filter((p) => p.team === t).map((p) => p.name).sort().join('');
  assert.equal(A.state.phase, 'teams'); assert.equal(A.state.players.filter((p) => p.team === 0).length, 3, 'auto draw is balanced 3/3');

  // permissions & validation
  assert(!(await B.act('setTeam', { playerId: C.pid, team: 0 })).ok, 'non-host cannot move players');
  assert(!(await B.act('clearTeams')).ok); assert(!(await B.act('reshuffleTeams')).ok);
  assert(!(await A.act('setTeam', { playerId: 'nope', team: 0 })).ok); assert(!(await A.act('setTeam', { playerId: C.pid, team: 7 })).ok);

  // manual distribution
  assert((await A.act('clearTeams')).ok);
  assert(A.state.players.every((p) => p.team === null) && B.state.players.every((p) => p.team === null), 'everyone is unassigned and sees it');
  assert(!(await A.act('toRoundIntro')).ok, 'cannot continue with nobody assigned');
  assert.deepEqual(A.state.canRename, [false, false], 'naming stays closed until teams are complete');
  for (const [c, t] of [[A, 0], [C, 0], [D, 0], [B, 1], [E, 1]]) assert((await A.act('setTeam', { playerId: c.pid, team: t })).ok);
  assert.equal(B.state.me.team, 1); assert.equal(C.state.me.team, 0, 'players see their own team live');
  let r = await A.act('toRoundIntro'); assert(!r.ok && /F/.test(r.error), 'F is still unassigned: ' + r.error);
  await A.act('setTeam', { playerId: F.pid, team: 1 });
  assert.equal(names(0), 'ACD'); assert.equal(names(1), 'BEF'); console.log('A+C+D vs B+E+F built by hand');

  // moving players across / taking them off
  await A.act('setTeam', { playerId: F.pid, team: 0 }); assert.equal(names(0), 'ACDF');
  await A.act('setTeam', { playerId: F.pid, team: null }); assert.equal(team(F), null);
  await A.act('setTeam', { playerId: F.pid, team: 1 });
  // an empty team is refused
  const alt = await makeRoom(['H', 'I', 'J', 'K']); await toTeams(alt); await alt[0].act('clearTeams');
  for (const c of alt) await alt[0].act('setTeam', { playerId: c.pid, team: 0 });
  r = await alt[0].act('toRoundIntro'); assert(!r.ok && /at least one/.test(r.error), r.error);

  /* ---- naming: host names own team; ONE random player of the other team names theirs ---- */
  assert.deepEqual(A.state.canRename, [true, false], 'host names the team they are on');
  const pickerIdx = cs.findIndex((c) => c.state.canRename[1]); assert([1, 3, 4, 5].includes(pickerIdx), 'picker is on the other team');
  const picker = cs[pickerIdx]; assert.equal(cs.filter((c) => c.state.canRename[1]).length, 1, 'exactly one picker');
  assert.equal(cs.filter((c) => c.state.canRename[0]).length, 1, 'only the host names team 0');
  assert.deepEqual(A.state.namers, ['A', picker.name]);
  const pickerStays = picker.name; await A.act('setTeam', { playerId: C.pid, team: 0 }); // unrelated edit
  assert.equal(cs.find((c) => c.state.canRename[1]).name, pickerStays, 'random pick is stable, not re-rolled');

  assert((await A.act('renameTeam', { team: 0, name: '  The   Sharks  ' })).ok);
  assert((await picker.act('renameTeam', { team: 1, name: 'Dolphins' })).ok);
  for (const c of cs) assert.deepEqual(c.state.teamNames, ['The Sharks', 'Dolphins'], c.name + ' sees both names live');
  const nonPicker = cs.find((c) => c.state.me.team === 1 && c !== picker);
  r = await nonPicker.act('renameTeam', { team: 1, name: 'Nope' }); assert(!r.ok && r.error.includes(picker.name), r.error);
  assert(!(await C.act('renameTeam', { team: 0, name: 'Nope' })).ok, 'teammate of host cannot');
  assert(!(await A.act('renameTeam', { team: 1, name: 'Hijack' })).ok, 'host cannot override an online picker');
  assert(!(await picker.act('renameTeam', { team: 0, name: 'Hijack' })).ok, 'picker cannot rename the host team');
  r = await picker.act('renameTeam', { team: 1, name: 'the sharks' }); assert(!r.ok && /already/.test(r.error));
  assert((await picker.act('renameTeam', { team: 1, name: '<b>Wave</b> Riders and a very long name' })).ok);
  assert(!/[<>]/.test(A.state.teamNames[1]) && A.state.teamNames[1].length <= 20, A.state.teamNames[1]);
  assert((await picker.act('renameTeam', { team: 1, name: '' })).ok); assert.equal(A.state.teamNames[1], 'Team Seafoam', 'blank = default');
  await picker.act('renameTeam', { team: 1, name: 'Dolphins' });

  // picker leaves the team -> a new random member takes over; names stay
  await A.act('setTeam', { playerId: picker.pid, team: 0 });
  assert.equal(cs.filter((c) => c.state.canRename[1]).length, 1); assert.notEqual(cs.find((c) => c.state.canRename[1]).pid, picker.pid);
  assert.equal(A.state.teamNames[1], 'Dolphins'); await A.act('setTeam', { playerId: picker.pid, team: 1 });

  // host moves to the other team -> host now names that team
  await A.act('setTeam', { playerId: A.pid, team: 1 }); assert.deepEqual(A.state.canRename, [false, true]);
  assert.equal(cs.filter((c) => c.state.canRename[0]).length, 1, 'a random player now names the team the host left');
  await A.act('setTeam', { playerId: A.pid, team: 0 });

  // picked player offline -> host may step in
  const p2 = cs.find((c) => c.state.canRename[1]); p2.ac.abort(); await sleep(250);
  assert.equal(A.state.canRename[1], true, 'host can name the team when the picker is offline');
  await p2.connect(); await sleep(150);

  // shuffle re-draws teams, resets names and picks again
  assert((await A.act('reshuffleTeams')).ok);
  assert.deepEqual(A.state.teamNames, ['Team Coral', 'Team Seafoam']);
  assert.equal(A.state.players.filter((p) => p.team === 0).length, 3);
  for (const t of [0, 1]) assert.equal(cs.filter((c) => c.state.canRename[t]).length, 1, 'one namer per team after shuffle');
  assert(A.state.canRename[A.state.me.team], 'host always names own team');

  // names flow into the game, lock when teams are confirmed
  await A.act('clearTeams'); for (const [c, t] of [[A, 0], [C, 0], [D, 0], [B, 1], [E, 1], [F, 1]]) await A.act('setTeam', { playerId: c.pid, team: t });
  await A.act('renameTeam', { team: 0, name: 'The Sharks' }); const pk = cs.find((c) => c.state.canRename[1]); await pk.act('renameTeam', { team: 1, name: 'Dolphins' });
  assert((await A.act('toRoundIntro')).ok);
  assert(!(await A.act('renameTeam', { team: 0, name: 'Late' })).ok, 'locked once teams are confirmed');
  assert(!(await A.act('setTeam', { playerId: B.pid, team: 0 })).ok, 'teams locked once confirmed');
  await A.act('startRound'); const t0 = A.state.turn;
  assert.equal(t0.team, 0); assert(['A', 'C', 'D'].includes(t0.giverName), 'turns follow the manual teams');
  assert.deepEqual(F.state.teamNames, ['The Sharks', 'Dolphins']);
  console.log('TEAM TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
