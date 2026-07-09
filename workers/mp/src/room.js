// Room Durable Object — one instance per room code. Pure relay: binary state
// packets are prefixed with the sender's index and fanned out; JSON control
// messages (chat/lap/race) are validated minimally and relayed. Uses the
// WebSocket Hibernation API so an idle room costs nothing: sockets stay
// connected while the DO is evicted, and 'ping' keepalives are answered by
// setWebSocketAutoResponse without waking it. No alarms, no tick loops.
export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    // keepalive answered while hibernating (does not wake the DO)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    const url = new URL(req.url);

    // ---- meta: created once (PUT by /create), read by joining clients ------
    if (url.pathname.endsWith('/meta')) {
      if (req.method === 'PUT') {
        const existing = await this.ctx.storage.get('meta');
        if (!existing) {
          const b = await req.json().catch(() => ({}));
          await this.ctx.storage.put('meta', {
            track: String(b.track || 'practice').slice(0, 32),
            seed: (b.seed >>> 0) || 0,
          });
          return Response.json({ ok: true });
        }
        return Response.json({ ok: false, exists: true }, { status: 409 });
      }
      const meta = await this.ctx.storage.get('meta');
      return meta ? Response.json(meta) : new Response('no room', { status: 404 });
    }

    // ---- websocket join ----------------------------------------------------
    if (url.pathname.endsWith('/ws')) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const meta = await this.ctx.storage.get('meta');
      if (!meta) return new Response('no room', { status: 404 });
      const socks = this.ctx.getWebSockets();
      if (socks.length >= 12) return new Response('room full', { status: 409 });

      // smallest free player index (1..250) — survives hibernation via attachment
      const used = new Set(socks.map(w => (w.deserializeAttachment() || {}).i));
      let i = 1; while (used.has(i)) i++;
      const nick = String(url.searchParams.get('nick') || 'Driver').slice(0, 16);
      const car = String(url.searchParams.get('car') || 'gt3rs').slice(0, 16);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ i, nick, car });
      server.send(JSON.stringify({ t: 'hello', you: i, meta, roster: this._roster() }));
      this._broadcast(JSON.stringify({ t: 'join', p: { i, nick, car } }), server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('bad request', { status: 400 });
  }

  _roster() {
    return this.ctx.getWebSockets()
      .map(w => w.deserializeAttachment()).filter(Boolean)
      .map(({ i, nick, car, ready }) => ({ i, nick, car, ready: !!ready }));
  }

  _broadcast(msg, except) {
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      try { w.send(msg); } catch (e) { /* closing socket */ }
    }
  }

  webSocketMessage(ws, msg) {
    const att = ws.deserializeAttachment();
    if (!att) return;
    if (typeof msg === 'string') {                     // low-rate control (chat/lap/race)
      if (msg.length > 300) return;
      let m; try { m = JSON.parse(msg); } catch (e) { return; }
      if (m.t === 'chat' || m.t === 'lap' || m.t === 'best') {
        m.i = att.i;
        this._broadcast(JSON.stringify(m), ws);
        return;
      }
      if (m.t === 'ready') {                           // race: everyone ready -> countdown
        att.ready = !!m.v;
        ws.serializeAttachment(att);
        this._broadcast(JSON.stringify({ t: 'ready', i: att.i, v: att.ready }), null);
        const socks = this.ctx.getWebSockets();
        const atts = socks.map(w => w.deserializeAttachment()).filter(Boolean);
        if (atts.length >= 2 && atts.every(a => a.ready)) {
          for (const w of socks) {                     // consume ready flags for the next round
            const a = w.deserializeAttachment();
            if (a) { a.ready = false; w.serializeAttachment(a); }
          }
          this._broadcast(JSON.stringify({ t: 'race', n: atts.length }), null);
        }
      }
      return;
    }
    // binary car state: prefix sender index, relay to everyone else (outgoing is free)
    const src = new Uint8Array(msg);
    if (src.byteLength > 64) return;
    const out = new Uint8Array(src.byteLength + 1);
    out[0] = att.i; out.set(src, 1);
    this._broadcast(out, ws);
  }

  webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    if (att) this._broadcast(JSON.stringify({ t: 'leave', i: att.i }), ws);
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}
