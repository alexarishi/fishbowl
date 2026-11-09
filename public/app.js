/* Fishbowl client – vanilla JS, no build step. */
(() => {
  'use strict';
  const API = (window.FISHBOWL_API || '').replace(/\/+$/, '');
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const RULES = [
    { icon: '🗣️', name: 'Describe', short: 'Use any words except the card itself. No gestures.',
      long: 'Say anything you like to get your team to guess the card – but never say any part of it, no rhyming, no “starts with”, and no gestures.' },
    { icon: '🎭', name: 'Act it out', short: 'No words, no sounds. Gestures only!',
      long: 'Charades time! No words, no sounds, no mouthing and no pointing at objects – act the card out.' },
    { icon: '☝️', name: 'One word', short: 'Say exactly ONE word. That’s it.',
      long: 'You may say exactly one word per card. Lean on what everyone remembers from the first two rounds!' },
  ];
  const TEAM_COLORS = ['#ff6b4a', '#14b8a6'];

  let S = null;            // latest personalised state from the server
  let session = loadSession();
  let es = null;
  let offset = 0;          // serverTime - localTime
  let viewKey = null;
  let muted = localStorage.getItem('fb_muted') === '1';
  let audioCtx = null;
  let lastBeepSec = null;
  let prevTurnSig = '';

  /* ---------- storage ---------- */
  function loadSession() { try { return JSON.parse(localStorage.getItem('fb_session') || 'null'); } catch { return null; } }
  function saveSession(s) { session = s; if (s) localStorage.setItem('fb_session', JSON.stringify(s)); else localStorage.removeItem('fb_session'); }
  const urlCode = () => { const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4})\/?$/); return m ? m[1].toUpperCase() : ''; };

  /* ---------- sound ---------- */
  function beep(freq = 660, dur = 0.12, type = 'sine', vol = 0.15) {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur); o.stop(audioCtx.currentTime + dur + 0.02);
    } catch { /* ignore */ }
  }
  const chime = () => { beep(660, .12); setTimeout(() => beep(880, .18), 130); };
  const buzzer = () => { beep(160, .6, 'sawtooth', .18); };
  function updateMuteBtn() { $('#muteBtn').textContent = muted ? '🔇' : '🔊'; }
  $('#muteBtn').onclick = () => { muted = !muted; localStorage.setItem('fb_muted', muted ? '1' : '0'); updateMuteBtn(); if (!muted) beep(); };
  $('#helpBtn').onclick = () => $('#helpDlg').showModal();
  updateMuteBtn();

  /* ---------- helpers ---------- */
  let toastT;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 2800);
  }
  async function post(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch { /* */ }
    if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  async function act(type, extra = {}) {
    try { await post('/api/action', { code: session.code, pid: session.pid, type, ...extra }); }
    catch (e) { toast(e.message, true); }
  }
  const initials = (n) => (n || '?').trim().slice(0, 1).toUpperCase();
  const teamName = (t) => (t == null ? '' : S.teamNames[t]);
  const joinUrl = () => `${location.origin}/r/${S.code}`;
  const colorFor = (t) => (t == null ? '#6b8aa0' : TEAM_COLORS[t]);
  const nowSrv = () => Date.now() + offset;

  /* ---------- connection ---------- */
  function connect() {
    if (es) es.close();
    es = new EventSource(`${API}/api/events?code=${session.code}&pid=${session.pid}`);
    es.addEventListener('state', (e) => {
      const st = JSON.parse(e.data);
      offset = st.serverTime - Date.now();
      S = st;
      onState();
    });
    es.addEventListener('kicked', () => { leaveLocal(); toast('You were removed from the game.', true); });
    es.onerror = () => {
      // if the room is gone the server answers 404 on reconnect; check once
      setTimeout(async () => {
        if (!es || es.readyState === 2) {
          try { await post('/api/join', { code: session.code, pid: session.pid }); connect(); }
          catch { leaveLocal(); toast('That game has ended.', true); }
        }
      }, 800);
    };
  }
  function leaveLocal() {
    if (es) es.close(); es = null; S = null; saveSession(null); viewKey = null;
    history.replaceState(null, '', '/'); renderLanding();
  }

  /* ---------- rendering core ---------- */
  function view(key, html, after) {
    if (key == null || key !== viewKey) { app.innerHTML = html; viewKey = key; }
    if (after) after();
  }

  function onState() {
    // personal alerts
    const t = S.turn;
    const sig = t ? `${S.round}:${t.giverId}:${t.status}:${t.endsAt}` : '';
    if (sig !== prevTurnSig) {
      if (t && t.status === 'ready' && t.giverId === S.me.id) { chime(); if (navigator.vibrate) navigator.vibrate(200); }
      prevTurnSig = sig; lastBeepSec = null;
    }
    if (location.pathname !== `/r/${S.code}`) history.replaceState(null, '', `/r/${S.code}`);
    switch (S.phase) {
      case 'lobby': return renderLobby();
      case 'writing': return renderWriting();
      case 'teams': return renderTeams();
      case 'roundIntro': return renderIntro();
      case 'playing': return renderPlaying();
      case 'gameOver': return renderGameOver();
    }
  }

  /* ---------- landing ---------- */
  function renderLanding(msg) {
    viewKey = null;
    const code = urlCode();
    const savedName = localStorage.getItem('fb_name') || '';
    app.innerHTML = `
      <section class="hero"><div class="bowl-art">🐟</div>
        <h1>Fishbowl</h1>
        <p>The classic party game of describing, acting and one-word clues – online, free, and ready in seconds. Start a game and share the link with your friends.</p>
      </section>
      ${code ? `
      <div class="card stack">
        <h2>Join game <span style="letter-spacing:4px">${esc(code)}</span></h2>
        <div><label class="field" for="jn">Your name</label><input id="jn" type="text" maxlength="20" autocomplete="nickname" value="${esc(savedName)}" placeholder="e.g. Alex"></div>
        <button class="btn block sea" data-act="join" data-code="${esc(code)}">Join game</button>
        <div class="err" id="err">${esc(msg || '')}</div>
        <div class="center"><button class="linkbtn" data-act="goHome">Host a new game instead</button></div>
      </div>` : `
      <div class="card stack">
        <h2>Host a game</h2>
        <p class="muted" style="margin:0">You’ll get a link to share with everyone.</p>
        <div><label class="field" for="hn">Your name</label><input id="hn" type="text" maxlength="20" autocomplete="nickname" value="${esc(savedName)}" placeholder="e.g. Alex"></div>
        <button class="btn block" data-act="create">Host game</button>
        <div class="err" id="err">${esc(msg || '')}</div>
      </div>
      <div class="card stack">
        <h2>Join a game</h2>
        <div><label class="field" for="jc">4-character code</label><input id="jc" class="code" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD"></div>
        <div><label class="field" for="jn">Your name</label><input id="jn" type="text" maxlength="20" autocomplete="nickname" value="${esc(savedName)}" placeholder="e.g. Sam"></div>
        <button class="btn block sea" data-act="join">Join game</button>
      </div>`}
      <div class="how">
        <div><b>🗣️ Round 1 · Describe</b><span>Use words – but never the card itself.</span></div>
        <div><b>🎭 Round 2 · Act it out</b><span>Charades. No words, no sounds.</span></div>
        <div><b>☝️ Round 3 · One word</b><span>Just one word per card. Good luck!</span></div>
      </div>
      <footer class="foot">4+ players · play on a video call · no sign-up needed</footer>`;
  }

  const WAKE = 'Connecting to the game server… if it was asleep this can take up to a minute. Please wait.';
  async function doCreate() {
    const name = $('#hn').value.trim(); if (!name) return setErr('Please enter your name.');
    localStorage.setItem('fb_name', name); setErr(WAKE);
    try { const r = await post('/api/create', { name }); saveSession({ code: r.code, pid: r.pid }); connect(); }
    catch (e) { setErr(e.message); }
  }
  async function doJoin(codeFromBtn) {
    const name = $('#jn').value.trim();
    const code = (codeFromBtn || ($('#jc') ? $('#jc').value : '')).trim().toUpperCase();
    if (code.length !== 4) return setErr('Enter the 4-character game code.');
    if (!name) return setErr('Please enter your name.');
    localStorage.setItem('fb_name', name); setErr(WAKE);
    try { const r = await post('/api/join', { code, name }); saveSession({ code: r.code, pid: r.pid }); connect(); }
    catch (e) { setErr(e.message); }
  }
  function setErr(m) { const e = $('#err'); if (e) e.textContent = m; else toast(m, true); }

  /* ---------- shared bits ---------- */
  const playersList = (withKick) => `<ul class="players">${S.players.map((p) => `
    <li><span class="avatar" style="background:${colorFor(p.team)}">${esc(initials(p.name))}</span>
      <span class="nm">${esc(p.name)}${p.id === S.me.id ? ' (you)' : ''}</span>
      ${p.isHost ? '<span class="tag">Host</span>' : ''}
      ${!p.connected ? '<span class="tag off">offline</span>' : ''}
      ${withKick && S.me.isHost && p.id !== S.me.id ? `<button class="linkbtn" data-act="kick" data-id="${esc(p.id)}" title="Remove">✕</button>` : ''}
    </li>`).join('')}</ul>`;

  function scorebar() {
    const t = S.turn; const [a, b] = S.totals;
    const act = t && S.phase === 'playing' ? t.team : -1;
    return `<div class="scorebar">
      <div class="sb t0 ${act === 0 ? 'active' : ''}"><span class="nm">${esc(teamName(0))}</span><span class="pts">${a}</span></div>
      <div class="roundpill"><span>ROUND</span><b>${Math.max(1, Math.min(3, S.phase === 'roundIntro' ? S.round + 1 : S.round))}/3</b></div>
      <div class="sb t1 ${act === 1 ? 'active' : ''}"><span class="nm">${esc(teamName(1))}</span><span class="pts">${b}</span></div>
    </div>`;
  }

  /* ---------- lobby ---------- */
  function renderLobby() {
    const host = S.me.isHost;
    const html = `
      <div class="card wide">
        <div class="center muted small" style="font-weight:700;letter-spacing:1px">GAME CODE</div>
        <div class="codebox"><span class="code">${esc(S.code)}</span></div>
        <div class="linkline"><input type="text" id="lnk" readonly value="${esc(joinUrl())}" aria-label="Invite link">
          <button class="btn small ghost" data-act="copy">Copy link</button>
          ${navigator.share ? '<button class="btn small sea" data-act="share">Share</button>' : ''}</div>
        <p class="muted small center" style="margin:10px 0 0">Send this link to your friends – they just open it and type their name.</p>
      </div>
      <div class="card wide">
        <div class="row between"><h2 style="margin:0">Players <span id="pc" class="muted"></span></h2></div>
        <div id="plist"></div>
        <h3>Game settings ${host ? '' : '<span class="muted small">(host controls these)</span>'}</h3>
        <div class="settings">
          <div><label class="field" for="s_w">Cards per player</label><select id="s_w" ${host ? '' : 'disabled'}>${[3, 4, 5, 6, 8, 10].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></div>
          <div><label class="field" for="s_t">Turn length</label><select id="s_t" ${host ? '' : 'disabled'}>${[30, 45, 60, 90, 120].map((n) => `<option value="${n}">${n} seconds</option>`).join('')}</select></div>
          <div><label class="field" for="s_s">Skips per turn</label><select id="s_s" ${host ? '' : 'disabled'}><option value="unlimited">Unlimited</option><option value="one">One</option><option value="none">None</option></select></div>
          <div style="display:flex;align-items:end"><label class="switch"><input type="checkbox" id="s_c" ${host ? '' : 'disabled'}> Carry over leftover time</label></div>
        </div>
        <div style="margin-top:18px" class="stack">
          ${host ? `<button class="btn block big" id="startBtn" data-act="start">Start game</button><div class="muted small center" id="need"></div>`
            : '<div class="center muted" style="font-weight:600">Waiting for the host to start the game…</div>'}
          <div class="center"><button class="linkbtn" data-act="leave">Leave game</button></div>
        </div>
      </div>`;
    view('lobby:' + host, html, () => {
      $('#plist').innerHTML = playersList(true);
      $('#pc').textContent = `(${S.players.length})`;
      const s = S.settings;
      const setv = (id, v, chk) => { const el = $(id); if (el && document.activeElement !== el) { chk ? (el.checked = v) : (el.value = String(v)); } };
      setv('#s_w', s.wordsPerPlayer); setv('#s_t', s.turnSeconds); setv('#s_s', s.skips); setv('#s_c', s.carryOver, true);
      if (host) {
        const on = S.players.filter((p) => p.connected).length;
        $('#startBtn').disabled = on < S.minPlayers;
        $('#need').textContent = on < S.minPlayers ? `You need at least ${S.minPlayers} players (${on} connected).` : '';
      }
    });
  }
  function pushSettings() {
    act('updateSettings', {
      wordsPerPlayer: $('#s_w').value, turnSeconds: $('#s_t').value, skips: $('#s_s').value, carryOver: $('#s_c').checked,
    });
  }

  /* ---------- writing ---------- */
  function renderWriting() {
    const n = S.settings.wordsPerPlayer; const me = S.me;
    const html = me.submitted ? `
      <div class="card wide center">
        <div style="font-size:54px">✅</div>
        <h2>Your cards are in the bowl!</h2>
        <p class="muted">Waiting for everyone else to finish…</p>
        <div class="chips" style="justify-content:center">${me.words.map((w) => `<span class="chip">${esc(w)}</span>`).join('')}</div>
        <p><button class="linkbtn" data-act="unsubmit">Edit my cards</button></p>
        <div id="wstatus"></div>
        <div id="whost" class="stack"></div>
      </div>` : `
      <div class="card wide">
        <h2>Write your cards</h2>
        <p class="muted" style="margin-top:0">Add ${n} famous people, characters, places, movies, things or phrases that most of the group would know. Keep them short!</p>
        <div class="words">${Array.from({ length: n }, (_, i) => `
          <div class="w"><span class="n">${i + 1}</span><input type="text" class="wi" maxlength="60" placeholder="${['e.g. Eiffel Tower', 'e.g. Harry Potter', 'e.g. Pizza night', 'e.g. Taylor Swift', 'e.g. Roller coaster', 'e.g. Mount Everest'][i % 6]}" value="${esc(me.words[i] || '')}"></div>`).join('')}</div>
        <div class="tips">💡 Avoid cards only you would know – and don’t overthink it. Everyone will have to guess them!</div>
        <button class="btn block big" data-act="submitWords">Add to the bowl</button>
        <div id="wstatus" style="margin-top:14px"></div>
      </div>`;
    view('writing:' + me.submitted + ':' + n, html, () => {
      const done = S.players.filter((p) => p.submitted).length;
      const ws = $('#wstatus');
      if (ws) ws.innerHTML = `<div class="muted small" style="font-weight:700">${done} of ${S.players.length} players ready</div>` + playersList(false).replace(/<li>/g, '<li>').replace(/(<span class="nm">[^<]*<\/span>)/g, '$1');
      if (ws) {
        // add ready/writing tags
        const items = ws.querySelectorAll('li');
        S.players.forEach((p, i) => { if (items[i]) items[i].insertAdjacentHTML('beforeend', p.submitted ? '<span class="tag ok">ready</span>' : '<span class="tag">writing…</span>'); });
      }
      const wh = $('#whost');
      if (wh) {
        if (S.me.isHost) {
          const all = done === S.players.length;
          wh.innerHTML = `<button class="btn block sea" data-act="teams" ${all ? '' : 'disabled'}>Draw teams</button>` +
            (!all ? `<button class="btn block ghost small" data-act="forceTeams">Don’t wait – continue without the ${S.players.length - done} still writing</button>` : '');
        } else wh.innerHTML = '<div class="muted small">The host will draw teams when everyone is ready.</div>';
      }
    });
  }
  function submitWords() {
    const words = [...document.querySelectorAll('.wi')].map((i) => i.value.trim());
    if (words.some((w) => !w)) return toast(`Please fill in all ${words.length} cards.`, true);
    act('submitWords', { words });
  }

  /* ---------- teams ---------- */
  function renderTeams() {
    const mine = S.me.team;
    const col = (t) => `<div class="team t${t}"><h3>${esc(teamName(t))} (${S.players.filter((p) => p.team === t).length})</h3><ul>${
      S.players.filter((p) => p.team === t).map((p) => `<li class="${p.id === S.me.id ? 'me' : ''}">${esc(p.name)}${p.id === S.me.id ? ' (you)' : ''}</li>`).join('')}</ul></div>`;
    view(null, `
      <div class="card wide">
        <h2 class="center">Meet the teams!</h2>
        <p class="center muted" style="margin-top:0">${S.totalCards} cards are in the bowl. You’re on <b style="color:${colorFor(mine)}">${esc(teamName(mine))}</b>.</p>
        <div class="teams">${col(0)}${col(1)}</div>
        <div class="stack" style="margin-top:18px">
          ${S.me.isHost ? `<button class="btn block big" data-act="continue">Looks good – let’s go!</button>
            <button class="btn block ghost" data-act="reshuffle">🔀 Shuffle teams</button>` : '<div class="center muted" style="font-weight:600">Waiting for the host to continue…</div>'}
        </div>
      </div>`);
  }

  /* ---------- round intro ---------- */
  function renderIntro() {
    const next = S.round + 1; const r = RULES[next - 1];
    let recap = '';
    if (S.round >= 1) {
      const rs = S.scores[S.round - 1];
      recap = `<div class="card wide center">
        <h3 style="margin-top:0">Round ${S.round} complete – all cards guessed!</h3>
        <div class="row" style="justify-content:center;gap:28px;font-size:20px;font-weight:800">
          <span style="color:${TEAM_COLORS[0]}">${esc(teamName(0))}: ${rs[0]}</span><span style="color:${TEAM_COLORS[1]}">${esc(teamName(1))}: ${rs[1]}</span></div>
        ${S.lastTurn && S.lastTurn.guessed.length ? `<p class="muted small" style="margin-bottom:0">Final turn: ${esc(S.lastTurn.giverName)} got ${S.lastTurn.guessed.length} card${S.lastTurn.guessed.length > 1 ? 's' : ''}.</p>` : ''}
      </div>`;
    }
    view(null, `${S.round >= 1 ? scorebar() : ''}${recap}
      <div class="card wide center">
        <div class="badge-round">${r.icon}</div>
        <div class="muted small" style="font-weight:800;letter-spacing:1px">ROUND ${next} OF 3</div>
        <h2 style="font-size:32px;margin:4px 0 8px">${esc(r.name)}</h2>
        <p style="font-size:18px;line-height:1.5;max-width:520px;margin:0 auto 12px">${esc(r.long)}</p>
        <p class="muted">All ${S.totalCards} cards go back in the bowl.${S.carryMs > 0 ? ` The last clue giver keeps their remaining ${Math.round(S.carryMs / 1000)} seconds.` : ''}</p>
        ${S.me.isHost ? `<button class="btn big" data-act="startRound">Start round ${next}</button>` : '<div class="muted" style="font-weight:600">Waiting for the host to start the round…</div>'}
      </div>`);
  }

  /* ---------- playing ---------- */
  function renderPlaying() {
    const t = S.turn; const r = RULES[S.round - 1]; const me = S.me;
    const isGiver = t.giverId === me.id;
    const sameTeam = me.team === t.team;
    let body = '';
    const lt = S.lastTurn && S.lastTurn.round === S.round ? S.lastTurn : null;
    const lastLine = lt ? `<p class="muted small center" style="margin:10px 0 0">Last turn: <b>${esc(lt.giverName)}</b> (${esc(teamName(lt.team))}) guessed ${lt.guessed.length} card${lt.guessed.length === 1 ? '' : 's'}${lt.reason === 'time' ? ' – time’s up!' : '.'}</p>` : '';
    if (t.status === 'ready') {
      const secs = Math.round(t.durationMs / 1000);
      if (isGiver) {
        body = `<div class="card wide center">
          <div class="muted small" style="font-weight:800;letter-spacing:1px">YOU’RE UP!</div>
          <div class="big-name" style="color:${colorFor(t.team)}">${esc(teamName(t.team))}</div>
          <p style="margin:10px 0"><span class="ruleflag">${r.icon} ${esc(r.name)}</span></p>
          <p class="muted" style="margin:0 0 16px">${esc(r.short)}<br>You have ${secs} seconds – ${S.bowlLeft} card${S.bowlLeft === 1 ? '' : 's'} left in the bowl.</p>
          <button class="btn big block" data-act="startTurn">Start my turn</button>${lastLine}</div>`;
      } else {
        body = `<div class="card wide center">
          <div class="muted small" style="font-weight:800;letter-spacing:1px">UP NEXT</div>
          <div class="big-name">${esc(t.giverName)}</div>
          <div style="color:${colorFor(t.team)};font-weight:800">${esc(teamName(t.team))}</div>
          <p style="margin:10px 0"><span class="ruleflag">${r.icon} ${esc(r.name)}</span></p>
          <p class="muted" style="margin:0">${sameTeam ? 'Get ready to guess!' : 'Watch closely – make sure they follow the rules!'}<br>${secs} seconds · ${S.bowlLeft} card${S.bowlLeft === 1 ? '' : 's'} left in the bowl.</p>
          ${!t.giverConnected ? '<p class="err">This player appears to be offline.</p>' : ''}
          ${me.isHost ? `<p style="margin:14px 0 0"><button class="btn ghost small" data-act="skipGiver">Skip ${esc(t.giverName)}’s turn</button></p>` : ''}
          ${lastLine}</div>`;
      }
    } else {
      const common = `<div class="timer" id="timer">--</div><div class="bar" id="bar"><i></i></div>`;
      if (isGiver) {
        const skipLabel = t.skipsLeft === -1 ? 'Skip' : `Skip (${t.skipsLeft} left)`;
        body = `<div class="card wide">
          ${common}
          <div class="center"><span class="ruleflag">${r.icon} ${esc(r.name)}</span> <span class="muted small">· ${esc(r.short)}</span></div>
          <div class="secret" id="secret">${esc(S.card)}</div>
          <div class="actions">
            <button class="btn big sea" data-act="got">✓ Got it!</button>
            <button class="btn big ghost" data-act="skip" ${t.skipsLeft === 0 ? 'disabled' : ''}>${skipLabel}</button>
          </div>
          <div class="row between" style="margin-top:14px">
            <span class="muted small">${S.bowlLeft - 1} more in the bowl · ${t.guessedCount} guessed this turn</span>
            <button class="linkbtn" data-act="endTurn">End my turn</button></div>
          ${S.guessedThisTurn && S.guessedThisTurn.length ? `<div class="chips">${S.guessedThisTurn.map((w) => `<span class="chip">${esc(w)}</span>`).join('')}</div>` : ''}
        </div>`;
      } else {
        body = `<div class="card wide center">
          ${common}
          <div class="big-name">${esc(t.giverName)}</div>
          <div style="color:${colorFor(t.team)};font-weight:800;margin-bottom:8px">${esc(teamName(t.team))} is playing</div>
          <p style="margin:6px 0"><span class="ruleflag">${r.icon} ${esc(r.name)}</span></p>
          <p class="muted" style="margin:0">${sameTeam ? 'Shout out your guesses!' : 'Watch for rule-breakers.'}<br>${t.guessedCount} guessed this turn · ${S.bowlLeft} left in the bowl</p>
        </div>`;
      }
    }
    view(null, scorebar() + body, tick);
  }

  /* ---------- game over ---------- */
  function renderGameOver() {
    const [a, b] = S.totals;
    const mineWon = (a > b && S.me.team === 0) || (b > a && S.me.team === 1);
    const head = a === b ? 'It’s a tie!' : `${esc(teamName(a > b ? 0 : 1))} wins!`;
    view(null, `
      <div class="card wide">
        <div class="trophy">${a === b ? '🤝' : '🏆'}</div>
        <div class="winner" style="color:${a === b ? 'inherit' : colorFor(a > b ? 0 : 1)}">${head}</div>
        ${a !== b ? `<p class="center muted" style="margin:0">${mineWon ? 'Nice work, your team crushed it! 🎉' : 'Great game – rematch?'}</p>` : ''}
        <table class="res"><thead><tr><th></th><th style="color:${TEAM_COLORS[0]}">${esc(teamName(0))}</th><th style="color:${TEAM_COLORS[1]}">${esc(teamName(1))}</th></tr></thead><tbody>
          ${S.scores.map((r, i) => `<tr><td>${RULES[i].icon} Round ${i + 1} · ${esc(RULES[i].name)}</td><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}
          <tr class="total"><td>Total</td><td>${a}</td><td>${b}</td></tr></tbody></table>
        <div class="stack" style="margin-top:18px">
          ${S.me.isHost ? '<button class="btn block big" data-act="playAgain">Play again with the same group</button>' : '<div class="center muted" style="font-weight:600">Waiting for the host to start a new game…</div>'}
          <div class="center"><button class="linkbtn" data-act="leaveGame">Leave game</button></div>
        </div>
      </div>`);
  }

  /* ---------- timer ---------- */
  function tick() {
    const el = $('#timer'); if (!el || !S || !S.turn || S.turn.status !== 'active') return;
    const rem = Math.max(0, S.turn.endsAt - nowSrv());
    const sec = Math.ceil(rem / 1000);
    el.textContent = sec;
    const low = sec <= 10;
    el.classList.toggle('low', low);
    const bar = $('#bar'); if (bar) { bar.classList.toggle('low', low); bar.firstElementChild.style.width = Math.min(100, (rem / S.turn.durationMs) * 100) + '%'; }
    if (sec !== lastBeepSec) {
      lastBeepSec = sec;
      if (sec > 0 && sec <= 5) beep(520, .08);
      if (sec === 0) buzzer();
    }
  }
  setInterval(tick, 150);

  /* ---------- events ---------- */
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case 'create': return doCreate();
      case 'join': return doJoin(b.dataset.code);
      case 'goHome': history.replaceState(null, '', '/'); return renderLanding();
      case 'copy': navigator.clipboard.writeText(joinUrl()).then(() => toast('Link copied! Send it to your friends.'), () => { $('#lnk').select(); toast('Press Ctrl/Cmd+C to copy.'); }); return;
      case 'share': return navigator.share({ title: 'Join my Fishbowl game', text: `Join my Fishbowl game! Code: ${S.code}`, url: joinUrl() }).catch(() => {});
      case 'kick': return act('kick', { playerId: b.dataset.id });
      case 'leave': act('leave').then(leaveLocal); return;
      case 'leaveGame': return leaveLocal();
      case 'start': return act('startWriting');
      case 'submitWords': return submitWords();
      case 'unsubmit': return act('unsubmit');
      case 'teams': return act('assignTeams');
      case 'forceTeams': return act('forceStartTeams');
      case 'reshuffle': return act('reshuffleTeams');
      case 'continue': return act('toRoundIntro');
      case 'startRound': return act('startRound');
      case 'startTurn': return act('startTurn');
      case 'got': chime(); return act('got');
      case 'skip': return act('skip');
      case 'endTurn': return act('endTurn');
      case 'skipGiver': return act('skipGiver');
      case 'playAgain': return act('playAgain');
    }
  });
  app.addEventListener('change', (e) => { if (/^s_[wtsc]$/.test(e.target.id)) pushSettings(); });
  app.addEventListener('input', (e) => { if (e.target.id === 'jc') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t.id === 'hn') doCreate();
    else if (t.id === 'jn' || t.id === 'jc') doJoin(urlCode());
    else if (t.classList.contains('wi')) {
      const all = [...document.querySelectorAll('.wi')]; const i = all.indexOf(t);
      if (i < all.length - 1) all[i + 1].focus(); else submitWords();
    }
  });

  /* ---------- boot ---------- */
  (async function boot() {
    const code = urlCode();
    if (session && (!code || code === session.code)) {
      try { await post('/api/join', { code: session.code, pid: session.pid }); connect(); return; }
      catch { saveSession(null); }
    }
    renderLanding();
    if (API) fetch(API + '/healthz').catch(() => {}); // wake a sleeping free-tier backend while the user types
  })();
})();
