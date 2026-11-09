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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'; // e.g. https://play.yourdomain.com (comma-separated allowed)
const PUBLIC_DIR = path.join(__dirname, 'public');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const TEAM_NAMES = ['Team Coral', 'Team Seafoam'];
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
    settings: { wordsPerPlayer: 3, turnSeconds: 60, skips: 'unlimited', carryOver: true },
    players: [], // {id,name,team,words:[],submitted,conns:Set,connected,hostTimer}
    round: 0, // 1..3 once started
    scores: [[0, 0], [0, 0], [0, 0]], // [round][team]
    bowl: [],
    allCards: [],
    pos: [0, 0], // rotation pointer per team
    turn: null, // {team,giverId,status:'ready'|'active',durationMs,endsAt,current,guessed:[],skipsUsed}
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

/* ---------- view (personalised, so the secret card is only sent to the clue giver) ---------- */
function viewFor(room, p) {
  const t = room.turn;
  const isGiver = t && t.giverId === p.id;
  const giver = t ? byId(room, t.giverId) : null;
  return {
    serverTime: now(),
    code: room.code,
    minPlayers: MIN_PLAYERS,
    phase: room.phase,
    settings: room.settings,
    roundNames: ROUND_NAMES,
    teamNames: TEAM_NAMES,
    me: { id: p.id, name: p.name, team: p.team, isHost: room.hostId === p.id, words: p.words, submitted: p.submitted },
    players: room.players.map((q) => ({
      id: q.id, name: q.name, team: q.team, connected: q.connected, submitted: q.submitted, isHost: room.hostId === q.id,
    })),
    round: room.round,
    scores: room.scores,
    totals: totals(room),
    bowlLeft: room.bowl.length + (t && t.current != null ? 1 : 0),
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
          guessedCount: t.guessed.length,
          skipsLeft: skipsLeft(room, t),
        }
      : null,
    card: isGiver && t.status === 'active' ? t.current : null,
    guessedThisTurn: isGiver ? t.guessed : undefined,
  };
}
function skipsLeft(room, t) {
  const s = room.settings.skips;
  if (s === 'unlimited') return -1;
  if (s === 'none') return 0;
  return Math.max(0, 1 - t.skipsUsed);
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
  room.turn = { team, giverId: giver.id, status: 'ready', durationMs, endsAt: null, current: null, guessed: [], skipsUsed: 0 };
}

function nextTurn(room) {
  const prev = room.turn ? room.turn.team : 1;
  const team = 1 - prev;
  const giver = pickGiver(room, team) || pickGiver(room, prev);
  prepareTurn(room, team, giver, room.settings.turnSeconds * 1000);
}

function finishTurn(room, reason) {
  // reason: 'time' | 'done' | 'roundComplete'
  const t = room.turn;
  if (!t) return;
  clearTimer(room);
  const remaining = t.endsAt ? Math.max(0, t.endsAt - now()) : 0;
  if (t.current != null) {
    room.bowl.splice(crypto.randomInt(room.bowl.length + 1), 0, t.current);
    t.current = null;
  }
  const giver = byId(room, t.giverId);
  room.lastTurn = { giverName: giver ? giver.name : '?', team: t.team, guessed: t.guessed.slice(), reason, round: room.round };
  if (reason === 'roundComplete') {
    room.carryMs = room.settings.carryOver && remaining > 3000 ? remaining : 0;
    room.carryTeam = t.team;
    room.carryGiver = t.giverId;
    if (room.round >= 3) {
      room.phase = 'gameOver';
      room.turn = null;
    } else {
      room.phase = 'roundIntro';
      room.turn = null;
    }
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
    const giver = pickGiver(room, 0);
    prepareTurn(room, 0, giver, room.settings.turnSeconds * 1000);
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
      room.allCards = room.players.flatMap((q) => q.words);
      assignTeams(room);
      room.phase = 'teams';
      return {};
    }
    case 'forceStartTeams': { // host drops players who haven't submitted
      if (!isHost || room.phase !== 'writing') return fail('Only the host can do that.');
      room.players = room.players.filter((q) => q.submitted);
      if (room.players.length < MIN_PLAYERS) return fail(`Need at least ${MIN_PLAYERS} players who have submitted cards.`);
      room.allCards = room.players.flatMap((q) => q.words);
      assignTeams(room);
      room.phase = 'teams';
      return {};
    }
    case 'reshuffleTeams': {
      if (!isHost || room.phase !== 'teams') return fail('Only the host can do that.');
      assignTeams(room);
      return {};
    }
    case 'toRoundIntro': {
      if (!isHost || room.phase !== 'teams') return fail('Only the host can do that.');
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
      clearTimer(room);
      room.timer = setTimeout(() => { finishTurn(room, 'time'); broadcast(room); }, t.durationMs + 100);
      return {};
    }
    case 'got': {
      if (room.phase !== 'playing' || !t || t.status !== 'active' || t.giverId !== p.id) return fail('Not allowed.');
      if (t.current == null) return {};
      t.guessed.push(t.current);
      room.scores[room.round - 1][t.team] += 1;
      t.current = null;
      if (room.bowl.length === 0) {
        finishTurn(room, 'roundComplete');
      } else {
        t.current = room.bowl.shift();
      }
      return {};
    }
    case 'skip': {
      if (room.phase !== 'playing' || !t || t.status !== 'active' || t.giverId !== p.id) return fail('Not allowed.');
      if (skipsLeft(room, t) === 0) return fail('No skips left this turn.');
      if (room.bowl.length === 0) return fail('This is the last card – no other card to skip to.');
      room.bowl.push(t.current);
      t.current = room.bowl.shift();
      t.skipsUsed += 1;
      return {};
    }
    case 'endTurn': {
      if (room.phase !== 'playing' || !t || t.status !== 'active' || t.giverId !== p.id) return fail('Not allowed.');
      finishTurn(room, 'done');
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
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
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
  let rel = urlPath === '/' || /^\/r\/[A-Za-z0-9]{4}\/?$/.test(urlPath) ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, ...SECURITY });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  // CORS: lets the Netlify-hosted front end call this API from another domain
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
      // reconnect
      if (b.pid) {
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
