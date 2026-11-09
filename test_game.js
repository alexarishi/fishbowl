// Turn review: shown ONLY to the clue giver; tick/untick; scoring; round flow
const { server } = require('./server'); const assert = require('assert');
const { sleep, makeRoom, toTeams, PORT } = require('./test_helpers');
const giverOf = (cs) => cs.find((c) => c.pid === cs[0].state.turn.giverId);
async function start(names, opts) { const cs = await makeRoom(names); await toTeams(cs, opts); await cs[0].act('toRoundIntro'); await cs[0].act('startRound'); return cs; }
(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const four = ['Ann', 'Bob', 'Cy', 'Di'];

  /* 1. manual end turn -> review (giver only) -> tick / untick -> confirm */
  let cs = await start(four);
  let g = giverOf(cs); const team = cs[0].state.turn.team; const others = cs.filter((c) => c !== g);
  await g.act('startTurn'); await g.act('got'); await g.act('skip'); await g.act('got'); await g.act('endTurn');
  assert.equal(g.state.turn.status, 'review');
  const rv = g.state.turn.review; assert(rv.length >= 3); assert.equal(rv.filter((c) => c.ok).length, 2);
  const nextTeam = 1 - team; const baseScore = cs[0].state.scores[0].slice();
  for (const o of others) {
    assert.notEqual(o.state.turn.status, 'review', o.name + ' must not be sent a review state');
    assert.equal(o.state.turn.status, 'ready'); assert.equal(o.state.turn.holding, true);
    assert.equal(o.state.turn.team, nextTeam, o.name + ' sees the other team up next');
    assert.equal(o.state.turn.review, undefined); assert.equal(o.state.turn.reason, undefined);
    assert(!/review/i.test(JSON.stringify(o.state.turn)), o.name + ' turn payload mentions nothing about review');
    assert.equal(o.state.card, null); assert.equal(o.state.guessedThisTurn, undefined);
    const st = JSON.parse(o.raw); delete st.me.words; const rest = JSON.stringify(st);
    for (const c of rv) assert(!rest.includes(c.text), `${o.name} payload leaked "${c.text}"`);
  }
  const spectators = others.filter((c) => c !== cs[0]); const intruders = g === cs[0] ? spectators : [cs[0], ...spectators];
  for (const o of intruders) {
    assert(!(await o.act('toggleCard', { cardId: rv[0].id })).ok, o.name + ' cannot toggle');
    assert(!(await o.act('confirmReview')).ok, o.name + ' cannot confirm');
  }
  const nextG = cs.find((c) => c.pid === others[0].state.turn.giverId);
  assert(!(await nextG.act('startTurn')).ok, 'next giver must wait for the review to be confirmed');
  const missed = rv.find((c) => !c.ok);
  assert((await g.act('toggleCard', { cardId: missed.id })).ok);
  assert.equal(g.state.scores[0][team], 3); assert.equal(g.state.bowlLeft, 9);
  for (const o of others) { assert.deepEqual(o.state.scores[0], baseScore, o.name + ' must not see review edits in the score'); assert.equal(o.state.bowlLeft, 10); }
  const wrong = rv.find((c) => c.ok);
  assert((await g.act('toggleCard', { cardId: wrong.id })).ok);
  assert.equal(g.state.scores[0][team], 2); assert.equal(g.state.bowlLeft, 10);
  assert(!(await g.act('startTurn')).ok);
  assert((await g.act('confirmReview')).ok);
  assert.equal(cs[0].state.turn.status, 'ready'); assert.notEqual(cs[0].state.turn.team, team);
  for (const o of others) { assert.equal(o.state.turn.holding, undefined); assert.equal(o.state.scores[0][team], 2, 'scores update for everyone once confirmed'); }
  assert((await nextG.act('startTurn')).ok, 'next giver can start after confirm');
  assert.equal(cs[0].state.lastTurn.guessedCount, 2); assert.equal(cs[0].state.lastTurn.guessed, undefined);
  console.log('1 review is private to the clue giver; tick/untick/confirm ok');

  /* 2. timer runs out -> review; others go straight to the next turn; a late tap is rejected but can be ticked in review */
  cs = await start(four, { turnSeconds: 30 });
  g = giverOf(cs); await g.act('startTurn'); const hand = g.state.card;
  await sleep(30400);
  assert.equal(g.state.turn.status, 'review'); assert.equal(g.state.turn.reason, 'time');
  for (const o of cs.filter((c) => c !== g)) { assert.equal(o.state.turn.status, 'ready'); assert.equal(o.state.turn.holding, true); assert.equal(o.state.turn.endReason, 'time'); assert.equal(o.state.turn.review, undefined); }
  assert(!(await g.act('got')).ok);
  const late = g.state.turn.review.find((c) => c.text === hand); assert(late && !late.ok);
  assert((await g.act('toggleCard', { cardId: late.id })).ok);
  assert((await g.act('confirmReview')).ok);
  assert.equal(g.state.bowlLeft, 11);
  console.log('2 time-up lands on review ok');

  /* 3. host can only step in when the giver is offline */
  cs = await start(four);
  const host = cs[0]; let cur = giverOf(cs); let guard = 0;
  while (cur === host && guard++ < 5) { await cur.act('startTurn'); await cur.act('endTurn'); await cur.act('confirmReview'); cur = giverOf(cs); }
  assert.notEqual(cur, host);
  await cur.act('startTurn'); await cur.act('endTurn');
  assert(!(await host.act('confirmReview')).ok, 'host cannot skip review while giver is online');
  cur.ac.abort(); await sleep(250);
  assert.equal(host.state.turn.canForce, true, 'host is told the previous player is offline');
  assert(cs.filter((c) => c !== host && c !== cur).every((c) => !c.state.turn.canForce), 'only the host gets the fallback');
  assert((await host.act('confirmReview')).ok, 'host may continue if giver dropped'); assert.equal(host.state.turn.status, 'ready');
  console.log('3 host fallback only when giver offline ok');

  /* 4. bowl empties -> review; unticking keeps the round alive; then round ends */
  cs = await start(four);
  g = giverOf(cs); await g.act('startTurn'); while (g.state.turn.status === 'active') await g.act('got');
  assert.equal(g.state.turn.reason, 'bowlEmpty'); assert.equal(g.state.bowlLeft, 0);
  for (const o of cs.filter((c) => c !== g)) { assert.equal(o.state.turn.status, 'wrap'); assert.equal(o.state.turn.review, undefined); }
  const lastOne = g.state.turn.review[g.state.turn.review.length - 1];
  await g.act('toggleCard', { cardId: lastOne.id }); assert.equal(g.state.bowlLeft, 1);
  await g.act('confirmReview'); assert.equal(cs[0].state.phase, 'playing');
  g = giverOf(cs); await g.act('startTurn'); await g.act('got'); await g.act('confirmReview');
  assert.equal(cs[0].state.phase, 'roundIntro'); const r1 = cs[0].state.scores[0]; assert.equal(r1[0] + r1[1], 12);
  console.log('4 round end through review ok');

  /* 5. full 3-round game with a review on every turn */
  cs = await start(four);
  for (let round = 1; round <= 3; round++) {
    if (round > 1) await cs[0].act('startRound');
    let n = 0;
    while (cs[0].state.phase === 'playing' && n++ < 100) {
      g = giverOf(cs);
      if (cs[0].state.turn.status === 'ready') await g.act('startTurn');
      for (const c of cs) if (c !== g) assert.equal(c.state.card, null, 'secret card leaked');
      await g.act('skip'); for (let k = 0; k < 2 && g.state.turn.status === 'active'; k++) await g.act('got');
      if (g.state.turn.status === 'active') await g.act('endTurn');
      assert((await g.act('confirmReview')).ok);
    }
    const s = cs[0].state.scores[round - 1]; assert.equal(s[0] + s[1], 12, `round ${round}`);
  }
  assert.equal(cs[0].state.phase, 'gameOver'); assert.equal(cs[0].state.totals[0] + cs[0].state.totals[1], 36);
  console.log('5 full game ok'); console.log('REVIEW TESTS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
