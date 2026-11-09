const PORT = parseInt(process.env.TPORT || '4567', 10), BASE = `http://127.0.0.1:${PORT}`;
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { ok: r.ok, ...(await r.json()) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(name) {
  const c = { name, state: null, raw: '' };
  c.connect = async () => {
    const ac = new AbortController(); c.ac = ac;
    const r = await fetch(`${BASE}/api/events?code=${c.code}&pid=${c.pid}`, { signal: ac.signal });
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = ev.match(/^event: state\ndata: (.*)$/m); if (m) { c.raw = m[1]; c.state = JSON.parse(m[1]); } } } } catch {} })();
  };
  c.act = async (type, extra = {}) => { const r = await post('/api/action', { code: c.code, pid: c.pid, type, ...extra }); await sleep(25); return r; };
  return c;
}
async function makeRoom(names) {
  const cs = names.map(client);
  const cr = await post('/api/create', { name: names[0] }); cs[0].code = cr.code; cs[0].pid = cr.pid;
  for (const c of cs.slice(1)) { const r = await post('/api/join', { code: cr.code, name: c.name }); c.code = r.code; c.pid = r.pid; }
  for (const c of cs) await c.connect(); await sleep(150);
  return cs;
}
async function toTeams(cs, extra = {}) {
  await cs[0].act('updateSettings', { wordsPerPlayer: 3, turnSeconds: extra.turnSeconds || 30, skips: 'unlimited', carryOver: true });
  await cs[0].act('startWriting');
  for (const c of cs) await c.act('submitWords', { words: ['Pizza', `${c.name}-1`, `${c.name}-2`] }); // "Pizza" is duplicated on purpose
  await cs[0].act('assignTeams');
}
module.exports = { post, sleep, client, makeRoom, toTeams, BASE, PORT };
