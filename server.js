/* Fishbowl – multiplayer party game server.
 * Zero dependencies. Node 18+.  Realtime via Server-Sent Events + JSON POST actions.
 * State is held in memory (rooms vanish if the server restarts).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '4', 10);
const MAX_PLAYERS = 30;
const MAX_ROOMS = 500;
// Only needed if the website is hosted on a different domain than this server (comma-separated list).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PUBLIC_DIR = path.join(__dirname, 'public');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const DEFAULT_TEAM_NAMES = ['Team Coral', 'Team Seafoam'];
const MAX_TEAM_NAME = 20;
const ROUND_NAMES = ['Describe', 'Act it out', 'One word'];

const rooms = new Map();

/* ---------- helpers ---------- */
const now = () => Date.now();
const rid = () => crypto.randomBytes(12).toString('hex');
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function newCode() {
  for (let n = 0; n < 1000; n++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

/* ---------- room model ---------- */
function createRoom() {
  const code = newCode();
  if (!code) return null;
  const room = {
    code,
    created: now(),
    touched: now(),
    hostId: null,
    phase: 'lobby', // lobby | writing | teams | roundIntro | playing | gameOver
    teamNames: DEFAULT_TEAM_NAMES.slice(),
    settings: { wordsPerPlayer: 3, turnSeconds: 60, skips: 'unlimited', carryOver: true },
    players: [], // {id,name,team,words:[],submitted,conns:Set,connected,hostTimer}
    round: 0, // 1..3 once started
    scores: [[0, 0], [0, 0], [0, 0]], // [round][team]
    bowl: [], // cards still to be guessed this round: {id,text}
    allCards: [], // every card in the game: {id,text}
    pos: [0, 0], // rotation pointer per team
    // turn: {team,giverId,status:'ready'|'active'|'review',durationMs,endsAt,current,seen:[{id,text,ok}],skipsUsed,remainingMs,reason}
    turn: null,
    carryMs: 0,
    lastTurn: null,
    timer: null,
  };
  rooms.set(code, room);
  return room;
}

const byId = (room, id) => room.players.find((p) => p.id === id);
const teamPlayers = (room, t) => room.players.filter((p) => p.team === t);
const totals = (room) => [0, 1].map((t) => room.scores.reduce((s, r) => s + r[t], 0));

function addPlayer(room, name) {
  const p = { id: rid(), name, team: null, words: [], submitted: false, conns: new Set(), connected: false, hostTimer: null };
  room.players.push(p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

function ensureHost(room) {
  const h = byId(room, room.hostId);
  if (h && h.connected) return;
  const next = room.players.find((p) => p.connected) || room.players[0];
  if (next) room.hostId = next.id;
}

/* ---------- team naming ----------
 * Who picks a team's name:
 *   - the host, for the team the host is on
 *   - for the other team: one person (the first connected member), so there is exactly one namer per team
 *   - if a team has nobody who can do it (empty / all offline) the host can name it
 */
function namerOf(room, team) {
  const host = byId(room, room.hostId);
  if (host && host.team === team) return host;
  return room.players.find((q) => q.team === team && q.connected) || null;
}
function canRename(room, p, team) {
  if (room.phase !== 'teams') return false;
  const namer = namerOf(room, team);
  return namer ? namer.id === p.id : room.hostId === p.id;
}

/* ---------- view (personalised, so the secret card is only sent to the clue giver) ---------- */
function skipsLeft(room, t) {
  const s = room.settings.skips;
  if (s === 'unlimited') return -1;
  if (s === 'none') return 0;
  return Math.max(0, 1 - t.skipsUsed);
}

function viewFor(room, p) {
  const t = room.turn;
  const isGiver = !!t && t.giverId === p.id;
  const giver = t ? byId(room, t.giverId) : null;
  return {
    serverTime: now(),
    code: room.code,
    minPlayers: MIN_PLAYERS,
    phase: room.phase,
    settings: room.settings,
    roundNames: ROUND_NAMES,
    teamNames: room.teamNames,
    canRename: [canRename(room, p, 0), canRename(room, p, 1)],
    namers: [namerOf(room, 0), namerOf(room, 1)].map((q) => (q ? q.name : null)),
    me: { id: p.id, name: p.name, team: p.team, isHost: room.hostId === p.id, words: p.words, submitted: p.submitted },
    players: room.players.map((q) => ({
      id: q.id, name: q.name, team: q.team, connected: q.connected, submitted: q.submitted, isHost: room.hostId === q.id,
    })),
    round: room.round,
    scores: room.scores,
    totals: totals(room),
    bowlLeft: room.bowl.length + (t && t.current ? 1 : 0),
    totalCards: room.allCards.length,
    carryMs: room.carryMs,
    lastTurn: room.lastTurn,
    turn: t
      ? {
          team: t.team,
          giverId: t.giverId,
          giverName: giver ? giver.name : '?',
          giverConnected: giver ? giver.connected : false,
          status: t.status,
          durationMs: t.durationMs,
          endsAt: t.endsAt,
          guessedCount: t.seen.filter((c) => c.ok).length,
          skipsLeft: skipsLeft(room, t),
          reason: t.reason,
          // review screen: every card that came up this turn, ticked if it counts as guessed
          review: t.status === 'review' ? t.seen.map((c) => ({ id: c.id, text: c.text, ok: c.ok })) : undefined,
        }
      : null,
    card: isGiver && t.status === 'active' && t.current ? t.current.text : null,
    guessedThisTurn: isGiver ? t.seen.filter((c) => c.ok).map((c) => c.text) : undefined,
  };
}

function broadcast(room) {
  room.touched = now();
  for (const p of room.players) {
    if (!p.conns.size) continue;
    const data = `event: state\ndata: ${JSON.stringify(viewFor(room, p))}\n\n`;
    for (const res of p.conns) res.write(data);
  }
}

/* ---------- game logic ---------- */
function clearTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function pickGiver(room, team) {
  const list = teamPlayers(room, team);
  if (!list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const cand = list[(room.pos[team] + i) % list.length];
    if (cand.connected) {
      room.pos[team] = (room.pos[team] + i + 1) % list.length;
      return cand;
    }
  }
  const cand = list[room.pos[team] % list.length];
  room.pos[team] = (room.pos[team] + 1) % list.length;
  return cand;
}

function prepareTurn(room, team, giver, durationMs) {
  room.turn = {
    team, giverId: giver.id, status: 'ready', durationMs, endsAt: null,
    current: null, seen: [], skipsUsed: 0, remainingMs: 0, reason: null,
  };
}

function nextTurn(room) {
  const prev = room.turn ? room.turn.team : 1;
  const team = 1 - prev;
  const giver = pickGiver(room, team) || pickGiver(room, prev);
  prepareTurn(room, team, giver, room.settings.turnSeconds * 1000);
}

function noteSeen(t, card) {
  if (!t.seen.some((c) => c.id === card.id)) t.seen.push({ id: card.id, text: card.text, ok: false });
}

/* Step 1: the turn is over (time ran out, giver ended it, or the bowl is empty).
 * Cards that were not guessed go back into the bowl and everyone sees the review screen. */
function endTurnToReview(room, reason) {
  const t = room.turn;
  if (!t || t.status !== 'active') return;
  clearTimer(room);
  t.remainingMs = t.endsAt ? Math.max(0, t.endsAt - now()) : 0;
  if (t.current) {
    room.bowl.splice(crypto.randomInt(room.bowl.length + 1), 0, t.current);
    t.current = null;
  }
  t.reason = reason; // 'time' | 'done' | 'bowlEmpty'
  t.status = 'review';
}

/* Step 2: the clue giver (or host) confirms the reviewed list -> next turn, or the round is over. */
function confirmReview(room) {
  const t = room.turn;
  if (!t || t.status !== 'review') return;
  const giver = byId(room, t.giverId);
  const guessed = t.seen.filter((c) => c.ok).map((c) => c.text);
  room.lastTurn = { giverName: giver ? giver.name : '?', team: t.team, guessed, reason: t.reason, round: room.round };
  if (room.bowl.length === 0) {
    room.carryMs = room.settings.carryOver && t.remainingMs > 3000 ? t.remainingMs : 0;
    room.carryTeam = t.team;
    room.carryGiver = t.giverId;
    room.turn = null;
    room.phase = room.round >= 3 ? 'gameOver' : 'roundIntro';
  } else {
    nextTurn(room);
  }
}

function startRound(room) {
  room.round += 1;
  room.bowl = shuffle(room.allCards);
  room.phase = 'playing';
  const carry = room.carryMs > 0 && room.round > 1;
  if (carry) {
    prepareTurn(room, room.carryTeam, byId(room, room.carryGiver), room.carryMs);
  } else if (room.round === 1) {
    prepareTurn(room, 0, pickGiver(room, 0), room.settings.turnSeconds * 1000);
  } else {
    const prevTeam = room.lastTurn ? room.lastTurn.team : 1;
    const team = 1 - prevTeam;
    prepareTurn(room, team, pickGiver(room, team), room.settings.turnSeconds * 1000);
  }
  room.carryMs = 0;
}

function assignTeams(room) {
  const ps = shuffle(room.players);
  ps.forEach((p, i) => (p.team = i % 2));
  room.pos = [0, 0];
}

function buildBowl(room) {
  room.allCards = room.players.flatMap((q) => q.words).map((text, id) => ({ id, text }));
}

function resetToLobby(room) {
  clearTimer(room);
  room.phase = 'lobby';
  room.round = 0;
  room.scores = [[0, 0], [0, 0], [0, 0]];
  room.bowl = [];
  room.allCards = [];
  room.turn = null;
  room.lastTurn = null;
  room.carryMs = 0;
  room.pos = [0, 0];
  room.teamNames = DEFAULT_TEAM_NAMES.slice();
  room.players = room.players.filter((p) => p.connected || room.hostId === p.id);
  for (const p of room.players) { p.words = []; p.submitted = false; p.team = null; }
}

const fail = (msg) => ({ error: msg });

function handleAction(room, p, a) {
  const isHost = room.hostId === p.id;
  const t = room.turn;
  switch (a.type) {
    case 'updateSettings': {
      if (!isHost || room.phase !== 'lobby') return fail('Only the host can change settings in the lobby.');
      const s = room.settings;
      const w = parseInt(a.wordsPerPlayer, 10);
      if ([3, 4, 5, 6, 8, 10].includes(w)) s.wordsPerPlayer = w;
      const sec = parseInt(a.turnSeconds, 10);
      if ([30, 45, 60, 90, 120].includes(sec)) s.turnSeconds = sec;
      if (['unlimited', 'one', 'none'].includes(a.skips)) s.skips = a.skips;
      if (typeof a.carryOver === 'boolean') s.carryOver = a.carryOver;
      return {};
    }
    case 'kick': {
      if (!isHost || room.phase !== 'lobby') return fail('Not allowed.');
      const q = byId(room, a.playerId);
      if (!q || q.id === p.id) return fail('Not allowed.');
      for (const res of q.conns) { res.write('event: kicked\ndata: {}\n\n'); res.end(); }
      room.players = room.players.filter((x) => x.id !== q.id);
      return {};
    }
    case 'leave': {
      if (room.phase === 'lobby') {
        for (const res of p.conns) res.end();
        room.players = room.players.filter((x) => x.id !== p.id);
        if (room.hostId === p.id) { room.hostId = null; ensureHost(room); }
      }
      return {};
    }
    case 'startWriting': {
      if (!isHost || room.phase !== 'lobby') return fail('Only the host can start.');
      const n = room.players.filter((q) => q.connected).length;
      if (n < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players to start.`);
      room.players = room.players.filter((q) => q.connected);
      for (const q of room.players) { q.words = []; q.submitted = false; }
      room.phase = 'writing';
      return {};
    }
    case 'submitWords': {
      if (room.phase !== 'writing') return fail('Not accepting words right now.');
      const n = room.settings.wordsPerPlayer;
      const words = (Array.isArray(a.words) ? a.words : []).map((w) => clean(w, 60)).filter(Boolean);
      if (words.length !== n) return fail(`Please write exactly ${n} cards.`);
      p.words = words;
      p.submitted = true;
      return {};
    }
    case 'unsubmit': {
      if (room.phase !== 'writing') return fail('Too late to edit.');
      p.submitted = false;
      return {};
    }
    case 'assignTeams': {
      if (!isHost || room.phase !== 'writing') return fail('Only the host can do that.');
      if (room.players.some((q) => !q.submitted)) return fail('Waiting for everyone to submit.');
      if (room.players.length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players.`);
      buildBowl(room);
      assignTeams(room);
      room.phase = 'teams';
      return {};
    }
    case 'forceStartTeams': { // host drops players who haven't submitted
      if (!isHost || room.phase !== 'writing') return fail('Only the host can do that.');
      room.players = room.players.filter((q) => q.submitted);
      if (room.players.length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players who have submitted cards.`);
      buildBowl(room);
      assignTeams(room);
      room.phase = 'teams';
      return {};
    }
    case 'reshuffleTeams': {
      if (!isHost || room.phase !== 'teams') return fail('Only the host can do that.');
      assignTeams(room);
      return {};
    }
    case 'setTeam': {
      // Manual team selection: host moves one player to team 0 / team 1, or back to "unassigned" (null).
      if (!isHost || room.phase !== 'teams') return fail('Only the host can do that.');
      const q = byId(room, a.playerId);
      if (!q) return fail('Unknown player.');
      const team = a.team === null || a.team === 'none' ? null : parseInt(a.team, 10);
      if (team !== null && team !== 0 && team !== 1) return fail('Unknown team.');
      q.team = team;
      return {};
    }
    case 'renameTeam': {
      const team = parseInt(a.team, 10);
      if (team !== 0 && team !== 1) return fail('Unknown team.');
      if (room.phase !== 'teams') return fail('Team names can only be changed while teams are being set up.');
      if (!canRename(room, p, team)) {
        const nm = namerOf(room, team);
        return fail(nm ? `Only ${nm.name} can name this team.` : 'Only the host can name this team.');
      }
      const name = clean(a.name, MAX_TEAM_NAME);
      const final = name || DEFAULT_TEAM_NAMES[team]; // empty = back to default
      if (room.teamNames[1 - team].toLowerCase() === final.toLowerCase()) return fail('The other team already uses that name.');
      room.teamNames[team] = final;
      return {};
    }
    case 'clearTeams': {
      // Start from a blank slate so the host can pick every player by hand.
      if (!isHost || room.phase !== 'teams') return fail('Only the host can do that.');
      for (const q of room.players) q.team = null;
      return {};
    }
    case 'toRoundIntro': {
      if (!isHost || room.phase !== 'teams') return fail('Only the host can do that.');
      const unassigned = room.players.filter((q) => q.team !== 0 && q.team !== 1);
      if (unassigned.length) return fail(`Assign ${unassigned.length === 1 ? unassigned[0].name : unassigned.length + ' players'} to a team first.`);
      if (!teamPlayers(room, 0).length || !teamPlayers(room, 1).length) return fail('Each team needs at least one player.');
      room.pos = [0, 0];
      room.phase = 'roundIntro';
      room.round = 0;
      return {};
    }
    case 'startRound': {
      if (!isHost || room.phase !== 'roundIntro') return fail('Only the host can start the round.');
      startRound(room);
      return {};
    }
    case 'startTurn': {
      if (room.phase !== 'playing' || !t || t.status !== 'ready') return fail('Not ready.');
      if (t.giverId !== p.id) return fail("It's not your turn.");
      t.status = 'active';
      t.endsAt = now() + t.durationMs;
      t.current = room.bowl.shift();
      noteSeen(t, t.current);
      clearTimer(room);
      room.timer = setTimeout(() => { endTurnToReview(room, 'time'); broadcast(room); }, t.durationMs + 100);
      return {};
    }
    case 'got': {
      if (room.phase !== 'playing' || !t || t.status !== 'active' || t.giverId !== p.id) return fail('Not allowed.');
      if (!t.current) return {};
      const e = t.seen.find((c) => c.id === t.current.id);
      if (e) e.ok = true;
      room.scores[room.round - 1][t.team] += 1;
      t.current = null;
      if (room.bowl.length === 0) {
        endTurnToReview(room, 'bowlEmpty');
      } else {
        t.current = room.bowl.shift();
        noteSeen(t, t.current);
      }
      return {};
    }
    case 'skip': {
      if (room.phase !== 'playing' || !t || t.status !== 'active' || t.giverId !== p.id) return fail('Not allowed.');
      if (skipsLeft(room, t) === 0) return fail('No skips left this turn.');
      if (room.bowl.length === 0) return fail('This is the last card – no other card to skip to.');
      room.bowl.push(t.current);
      t.current = room.bowl.shift();
      noteSeen(t, t.current);
      t.skipsUsed += 1;
      return {};
    }
    case 'endTurn': {
      if (room.phase !== 'playing' || !t || t.status !== 'active' || t.giverId !== p.id) return fail('Not allowed.');
      endTurnToReview(room, 'done');
      return {};
    }
    case 'toggleCard': {
      // Review screen: tick a card that was guessed but missed, or untick one counted by mistake.
      if (room.phase !== 'playing' || !t || t.status !== 'review') return fail('Nothing to review.');
      if (t.giverId !== p.id && !isHost) return fail('Only the clue giver can edit the review.');
      const e = t.seen.find((c) => c.id === a.cardId);
      if (!e) return fail('Unknown card.');
      const sc = room.scores[room.round - 1];
      if (e.ok) {
        e.ok = false;
        sc[t.team] -= 1;
        room.bowl.splice(crypto.randomInt(room.bowl.length + 1), 0, { id: e.id, text: e.text });
      } else {
        const i = room.bowl.findIndex((c) => c.id === e.id);
        if (i < 0) return fail('That card is no longer available.');
        room.bowl.splice(i, 1);
        e.ok = true;
        sc[t.team] += 1;
      }
      return {};
    }
    case 'confirmReview': {
      if (room.phase !== 'playing' || !t || t.status !== 'review') return fail('Nothing to confirm.');
      if (t.giverId !== p.id && !isHost) return fail('Only the clue giver can confirm.');
      confirmReview(room);
      return {};
    }
    case 'skipGiver': {
      if (!isHost || room.phase !== 'playing' || !t || t.status !== 'ready') return fail('Not allowed.');
      // give the turn to another connected teammate, otherwise to the other team
      const list = teamPlayers(room, t.team).filter((q) => q.id !== t.giverId && q.connected);
      if (list.length) {
        prepareTurn(room, t.team, list[0], t.durationMs);
      } else {
        const team = 1 - t.team;
        prepareTurn(room, team, pickGiver(room, team), room.settings.turnSeconds * 1000);
      }
      return {};
    }
    case 'playAgain': {
      if (!isHost || room.phase !== 'gameOver') return fail('Only the host can do that.');
      resetToLobby(room);
      return {};
    }
    default:
      return fail('Unknown action.');
  }
}

/* ---------- HTTP ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
};
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 20000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' || /^\/r\/[A-Za-z0-9]{4}\/?$/.test(urlPath) ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    const cache = ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, ...SECURITY });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  // CORS (only matters if the website is served from a different domain than this server)
  const origin = req.headers.origin;
  if (origin) {
    const ok = ALLOWED_ORIGIN === '*' || ALLOWED_ORIGIN.split(',').map((x) => x.trim().replace(/\/$/, '')).includes(origin);
    if (ok) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (p === '/healthz') return sendJSON(res, 200, { ok: true, rooms: rooms.size });

    if (p === '/api/create' && req.method === 'POST') {
      const b = await readBody(req);
      const name = clean(b.name, 20);
      if (!name) return sendJSON(res, 400, fail('Please enter your name.'));
      if (rooms.size >= MAX_ROOMS) return sendJSON(res, 503, fail('Server is busy, try again later.'));
      const room = createRoom();
      if (!room) return sendJSON(res, 503, fail('Could not create a room.'));
      const pl = addPlayer(room, name);
      return sendJSON(res, 200, { code: room.code, pid: pl.id });
    }

    if (p === '/api/join' && req.method === 'POST') {
      const b = await readBody(req);
      const code = clean(b.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return sendJSON(res, 404, fail("We couldn't find that game. Check the code and try again."));
      if (b.pid) { // reconnect
        const ex = byId(room, String(b.pid));
        if (ex) return sendJSON(res, 200, { code, pid: ex.id });
      }
      const name = clean(b.name, 20);
      if (!name) return sendJSON(res, 400, fail('Please enter your name.'));
      if (room.phase !== 'lobby') return sendJSON(res, 409, fail('That game has already started.'));
      if (room.players.length >= MAX_PLAYERS) return sendJSON(res, 409, fail('That game is full.'));
      if (room.players.some((q) => q.name.toLowerCase() === name.toLowerCase())) return sendJSON(res, 409, fail('Someone already has that name. Pick another one.'));
      const pl = addPlayer(room, name);
      broadcast(room);
      return sendJSON(res, 200, { code, pid: pl.id });
    }

    if (p === '/api/events' && req.method === 'GET') {
      const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
      const pl = room && byId(room, String(url.searchParams.get('pid') || ''));
      if (!pl) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('gone'); }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...SECURITY,
      });
      res.write('retry: 1500\n\n');
      pl.conns.add(res);
      pl.connected = true;
      if (pl.hostTimer) { clearTimeout(pl.hostTimer); pl.hostTimer = null; }
      const hb = setInterval(() => res.write(': hb\n\n'), 15000);
      req.on('close', () => {
        clearInterval(hb);
        pl.conns.delete(res);
        if (!pl.conns.size) {
          pl.connected = false;
          if (room.hostId === pl.id) {
            pl.hostTimer = setTimeout(() => { if (!pl.connected) { ensureHost(room); broadcast(room); } }, 20000);
          }
          broadcast(room);
        }
      });
      broadcast(room);
      return;
    }

    if (p === '/api/action' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.code || '').toUpperCase());
      const pl = room && byId(room, String(b.pid || ''));
      if (!pl) return sendJSON(res, 404, fail('Game not found.'));
      const r = handleAction(room, pl, b);
      broadcast(room);
      return sendJSON(res, r.error ? 400 : 200, r);
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, decodeURIComponent(p));
    res.writeHead(405); res.end();
  } catch (e) {
    if (!res.headersSent) sendJSON(res, 400, fail('Bad request.'));
  }
});

// housekeeping: delete idle rooms
setInterval(() => {
  const cutoff = now() - 3 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    const anyone = room.players.some((p) => p.connected);
    if (!anyone && room.touched < now() - 15 * 60 * 1000) { clearTimer(room); rooms.delete(code); }
    else if (room.touched < cutoff) { clearTimer(room); rooms.delete(code); }
  }
}, 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Fishbowl running on http://localhost:${PORT}`));
}
module.exports = { server };
