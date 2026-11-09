// 1) duplicate cards are refused (case-insensitive, first come first served)   2) "Up next" follows the real rotation
const { server } = require('./server'); const assert = require('assert');
const { post, sleep, makeRoom, PORT } = require('./test_helpers');
const POOL_MSG = 'Something similar is already in the pool. Please change:';
(async () => {
  await new Promise((r) => server.listen(PORT, r));

  /* ---------------- duplicates ---------------- */
  let cs = await makeRoom(['P1', 'P2', 'P3', 'P4']); const [P1, P2, P3, P4] = cs;
  await P1.act('startWriting'); assert.equal(P1.state.phase, 'writing');
  const ok = async (c, w) => { const r = await c.act('submitWords', { words: w }); assert(r.ok, `${c.name} ${JSON.stringify(w)} should be accepted: ${r.error}`); };
  const bad = async (c, w, msg, idx) => {
    const r = await c.act('submitWords', { words: w });
    assert(!r.ok, `${c.name} ${JSON.stringify(w)} must be refused`);
    assert(r.error.startsWith(msg), `wrong message: ${r.error}`);
    if (idx) assert.deepEqual(r.dupIndexes, idx, 'flags the offending card(s)');
    assert.equal(c.state.me.submitted, false, c.name + ' stays un-submitted');
    return r;
  };

  await ok(P1, ['Apple', 'Banana', 'Cherry']);                                         // first one in owns the words
  let r = await bad(P2, ['apple', 'Orange', 'Grape'], POOL_MSG, [0]);                 // apple
  assert.equal(r.error, `${POOL_MSG} apple`, 'exact error text');
  await bad(P2, ['APPLE', 'Orange', 'Grape'], POOL_MSG, [0]);                          // APPLE
  await bad(P2, ['aPPle', 'Orange', 'Grape'], POOL_MSG, [0]);                          // aPPle
  await bad(P2, ['Orange', 'appLE', 'Grape'], POOL_MSG, [1]);                          // appLE, in a different slot
  await bad(P2, ['  apple  ', 'Orange', 'Grape'], POOL_MSG, [0]);                      // stray spaces
  await bad(P2, ['Orange', 'Grape', 'bANANA'], POOL_MSG, [2]);                         // a different one of P1's cards
  r = await bad(P2, ['apple', 'BANANA', 'Grape'], POOL_MSG, [0, 1]);                   // two clashes -> both listed
  assert.equal(r.error, `${POOL_MSG} apple, BANANA`);
  assert.equal(P2.state.players.find((p) => p.id === P2.pid).submitted, false);
  await ok(P2, ['Apple Pie', 'Orange', 'Grape']);                                      // "Apple Pie" is NOT "Apple"
  await bad(P3, ['apple   pie', 'Kiwi', 'Lime'], POOL_MSG, [0]);                       // inner spacing / case
  await bad(P3, ['ＣＨＥＲＲＹ', 'Kiwi', 'Lime'], POOL_MSG, [0]);                       // full-width letters normalise too
  // the same card twice inside ONE player's own list
  r = await bad(P3, ['Kiwi', 'kiwi', 'Lime'], 'You wrote the same card more than once.', [1]);
  assert(!r.error.startsWith(POOL_MSG)); await bad(P3, ['Lime', 'Kiwi', 'LIME'], 'You wrote the same card more than once.', [2]);
  await ok(P3, ['Kiwi', 'Lemon', 'Lime']);

  // errors never reveal anyone else's cards
  r = await post('/api/action', { code: P4.code, pid: P4.pid, type: 'submitWords', words: ['apple', 'x1', 'x2'] });
  assert(!/Banana|Cherry|Orange|Grape|Kiwi|Lemon|Lime|P1|P2|P3/.test(r.error.replace('apple', '')), 'no leak: ' + r.error);
  assert(!/Banana|Cherry|Orange/.test(P4.raw), 'state does not contain other players\' cards');

  // editing frees the player's cards for others; first-come-first-served keeps applying
  assert((await P1.act('unsubmit')).ok);
  await ok(P4, ['Apple', 'Mango', 'Peach']);                                           // free now
  await bad(P1, ['apple', 'Banana', 'Cherry'], POOL_MSG, [0]);                         // P1 lost Apple to P4
  await ok(P1, ['Avocado', 'Banana', 'Cherry']);
  assert.equal(P1.state.players.every((p) => p.submitted), true);
  console.log('1a duplicates refused case-insensitively; message + flagged cards correct');

  // two players submitting the same card at the very same moment: exactly one gets in
  cs = await makeRoom(['R1', 'R2', 'R3', 'R4']); await cs[0].act('startWriting');
  const [a, b] = [cs[1], cs[2]];
  const res = await Promise.all([
    post('/api/action', { code: a.code, pid: a.pid, type: 'submitWords', words: ['Race', 'a1', 'a2'] }),
    post('/api/action', { code: b.code, pid: b.pid, type: 'submitWords', words: ['RACE', 'b1', 'b2'] }),
  ]);
  assert.equal(res.filter((x) => x.ok).length, 1, 'exactly one simultaneous submit succeeds'); assert.equal(res.filter((x) => !x.ok).length, 1);
  console.log('1b simultaneous duplicate submit: one accepted, one refused');

  // submissions after writing is over are refused as before
  assert(!(await cs[3].act('submitWords', { words: [] })).ok);

  /* ---------------- "Up next" ---------------- */
  cs = await makeRoom(['Ann', 'Bob', 'Cy', 'Di', 'Eve', 'Flo']);
  const { toTeams } = require('./test_helpers');
  await toTeams(cs); await cs[0].act('toRoundIntro');
  for (const c of cs) { assert.equal(c.state.upNext, null, 'no up-next outside a turn'); assert.equal(c.state.me.name, c.name, 'my own name is in my state'); }
  await cs[0].act('startRound');
  const byPid = (id) => cs.find((c) => c.pid === id);
  const nameOf = (id) => cs[0].state.players.find((p) => p.id === id).name;
  const teamOf = (id) => cs[0].state.players.find((p) => p.id === id).team;

  let seqOk = 0; let expectGiver = null; let expectNextUp = null; const order = [];
  for (let turn = 0; turn < 12; turn++) {
    const t = cs[0].state.turn; const g = byPid(t.giverId); order.push(g.name);
    // whoever was advertised as "up next" during the previous turn is the one who is up now
    if (expectGiver) { assert.equal(t.giverId, expectGiver, `turn ${turn}: advertised next player is the real next player`); seqOk++; }
    // ...and the "after" player shown during the review of the previous turn is now the one shown as up next
    const ups = cs.map((c) => c.state.upNext); assert(ups.every((u) => u && u.id === ups[0].id), 'everyone sees the same up-next');
    if (expectNextUp) assert.equal(ups[0].id, expectNextUp, `turn ${turn}: the player shown as 'after' became 'up next'`);
    assert.equal(ups[0].team, 1 - t.team, 'up next is always from the other team'); assert.equal(ups[0].name, nameOf(ups[0].id));
    const predicted = ups[0].id;
    await g.act('startTurn');
    assert.equal(g.state.upNext.id, predicted, 'still shown during the turn'); assert.equal(cs[3].state.upNext.id, predicted);
    await g.act('got'); await g.act('endTurn');
    // review: the reviewer sees the next giver; everyone else (already on the next-turn screen) sees the player AFTER that
    assert.equal(g.state.upNext.id, predicted, 'reviewer: next giver');
    for (const o of cs.filter((c) => c !== g)) {
      assert.equal(o.state.turn.giverId, predicted, 'others are looking at the next giver');
      assert.notEqual(o.state.upNext.id, predicted, 'others see the player after them');
      assert.equal(o.state.upNext.team, 1 - teamOf(predicted));
    }
    expectNextUp = cs.find((c) => c !== g).state.upNext.id; expectGiver = predicted;
    await g.act('confirmReview');
    assert.equal(cs[0].state.turn.giverId, predicted); assert.equal(cs[0].state.upNext.id, expectNextUp, 'same player right after confirming');
  }
  assert(seqOk >= 11, 'checked the whole rotation'); console.log('2 rotation (Ann..Flo):', order.join(' > '));
  // each team's members take turns in a fixed order (round-robin), alternating teams
  const t0 = order.filter((_, i) => i % 2 === 0), t1 = order.filter((_, i) => i % 2 === 1);
  for (const list of [t0, t1]) for (let i = 3; i < list.length; i++) assert.equal(list[i], list[i - 3], 'round-robin inside a team (3 players)');
  assert.notEqual(new Set(order.slice(0, 6)).size, 1);

  // last card of a round: nobody has a "next" while the round is wrapping up
  cs = await makeRoom(['Ann', 'Bob', 'Cy', 'Di']); await toTeams(cs); await cs[0].act('toRoundIntro'); await cs[0].act('startRound');
  const g = cs.find((c) => c.pid === cs[0].state.turn.giverId); await g.act('startTurn'); while (g.state.turn.status === 'active') await g.act('got');
  for (const c of cs) assert.equal(c.state.upNext, null, 'no up-next when the round is over');
  await g.act('confirmReview'); assert.equal(cs[0].state.phase, 'roundIntro'); for (const c of cs) assert.equal(c.state.upNext, null);

  // an offline player is skipped by the rotation (and "up next" follows that), exactly like the real next turn
  cs = await makeRoom(['Ann', 'Bob', 'Cy', 'Di', 'Eve', 'Flo']); await toTeams(cs); await cs[0].act('toRoundIntro'); await cs[0].act('startRound');
  const cur = cs.find((c) => c.pid === cs[0].state.turn.giverId); const firstNext = cs.find((c) => c.pid === cur.state.upNext.id);
  firstNext.ac.abort(); await sleep(250);
  const shown = cur.state.upNext; assert.notEqual(shown.id, firstNext.pid, 'offline player is skipped'); assert.equal(shown.connected, true);
  assert.equal(shown.team, 1 - cur.state.turn.team);
  await cur.act('startTurn'); await cur.act('endTurn'); await cur.act('confirmReview');
  assert.equal(cur.state.turn.giverId, shown.id, 'the player shown as up next really is the next giver');
  // if the whole next team is offline the bar still names the player (flagged offline) instead of going blank
  cs = await makeRoom(['Ann', 'Bob', 'Cy', 'Di']); await toTeams(cs); await cs[0].act('toRoundIntro'); await cs[0].act('startRound');
  const cur2 = cs.find((c) => c.pid === cs[0].state.turn.giverId); const other = cs.filter((c) => c.state.me.team !== cur2.state.me.team);
  for (const o of other) o.ac.abort(); await sleep(300);
  assert.equal(cur2.state.upNext.connected, false, 'flagged offline'); assert(other.some((o) => o.pid === cur2.state.upNext.id));
  console.log('UP-NEXT TESTS PASSED'); console.log('CARD + UP-NEXT TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
