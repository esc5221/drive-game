// drive-mp Worker — routes room create/meta/ws to the Room Durable Object.
import { Room } from './room.js';
export { Room };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';       // no 0/O/1/I/L
const genCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // create a room snapshotting the host's track+seed; retry on code collision
    if (url.pathname === '/create' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      for (let tries = 0; tries < 5; tries++) {
        const code = genCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await stub.fetch('https://do/room/' + code + '/meta', {
          method: 'PUT', body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        });
        if (r.ok) return new Response(JSON.stringify({ code }), { headers: { 'content-type': 'application/json', ...CORS } });
      }
      return new Response('busy', { status: 503, headers: CORS });
    }

    const m = url.pathname.match(/^\/room\/([A-Z2-9]{4,8})\/(ws|meta)$/);
    if (m) {
      const stub = env.ROOM.get(env.ROOM.idFromName(m[1]));
      const res = await stub.fetch(req);
      if (m[2] === 'meta') {
        const h = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS)) h.set(k, v);
        return new Response(res.body, { status: res.status, headers: h });
      }
      return res;                                       // websocket upgrade passthrough
    }

    if (url.pathname === '/') return new Response('drive-mp ok', { headers: CORS });
    return new Response('not found', { status: 404, headers: CORS });
  },
};
