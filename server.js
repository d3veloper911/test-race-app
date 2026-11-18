'use strict';
/* ============================================================================
   APEX RUSH server — static files + a tiny hand-rolled WebSocket room server.
   No dependencies.  node server.js [port]
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const MAX_PLAYERS = 8;
const LAPS = 3;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

/* --------------------------------------------------------------------------
   Minimal RFC 6455 server: text frames only, no extensions, no permessage
   deflate. Browsers never fragment messages this small, but fragments are
   handled anyway for safety.
   -------------------------------------------------------------------------- */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

class Peer {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.alive = true;
    this.player = null;
    this.room = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.receive(d));
    socket.on('close', () => this.die());
    socket.on('error', () => this.die());
  }

  receive(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.alive) {
      const buf = this.buf;
      if (buf.length < 2) break;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (masked) { if (buf.length < off + 4) break; off += 4; }
      if (buf.length < off + len) break;

      let payload = Buffer.from(buf.slice(off, off + len));
      if (masked) {
        const mask = buf.slice(off - 4, off);
        for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = buf.slice(off + len);

      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.write(0xA, payload); continue; }
      if (op === 0xA) continue;

      if (op === 0x0 && this.frag) {
        this.frag = Buffer.concat([this.frag, payload]);
        if (!fin) continue;
        payload = this.frag;
        this.frag = null;
        this.ontext(payload.toString('utf8'));
      } else if (op === 0x1) {
        if (!fin) { this.frag = payload; continue; }
        this.ontext(payload.toString('utf8'));
      }
    }
  }

  write(opcode, payload) {
    if (!this.alive) return;
    try { this.socket.write(encodeFrame(opcode, payload)); } catch (e) { this.die(); }
  }

  send(obj) { this.write(0x1, Buffer.from(JSON.stringify(obj))); }

  ontext(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg && typeof msg.t === 'string') handle(this, msg);
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    try { this.socket.end(encodeFrame(0x8, Buffer.alloc(0))); } catch (e) {}
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    try { this.socket.destroy(); } catch (e) {}
    leaveRoom(this);
  }
}

server.on('upgrade', (req, socket) => {
  if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  new Peer(socket);
});

/* --------------------------------------------------------------------------
   Rooms
   -------------------------------------------------------------------------- */
const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = [1, 2, 3, 4, 5, 6, 7, 8];
let idSeq = 0;

function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(n) {
  const s = String(n == null ? '' : n).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return s || 'RACER';
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    lap: p.lap,
    finished: p.finished,
    finishTime: p.finishTime,
  };
}

function roomInfo(room) {
  return {
    t: 'room',
    code: room.code,
    host: room.hostId,
    state: room.state,
    laps: LAPS,
    players: [...room.players.values()].map(publicPlayer),
  };
}

function broadcast(room, msg) {
  const raw = JSON.stringify(msg);
  const frame = encodeFrame(0x1, Buffer.from(raw));
  for (const p of room.players.values()) {
    if (p.peer && p.peer.alive) { try { p.peer.socket.write(frame); } catch (e) {} }
  }
}

function pushRoom(room) {
  broadcast(room, roomInfo(room));
}

function leaveRoom(peer) {
  const room = peer.room;
  const player = peer.player;
  peer.room = null;
  peer.player = null;
  if (!room || !player) return;
  room.players.delete(player.id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    console.log('[room ' + room.code + '] closed');
    return;
  }
  if (room.hostId === player.id) {
    room.hostId = room.players.keys().next().value;
  }
  pushRoom(room);
}

function handle(peer, msg) {
  switch (msg.t) {
    case 'time':
      peer.send({ t: 'time', c: msg.c, s: Date.now() });
      break;

    case 'join':
      joinRoom(peer, msg);
      break;

    case 'start':
      if (peer.room && peer.player && peer.room.hostId === peer.player.id) startRace(peer.room);
      break;

    case 'pos': {
      const p = peer.player;
      if (!p || !peer.room || peer.room.state !== 'racing') break;
      const z = Number(msg.z);
      if (!isFinite(z)) break;
      p.z = z;
      p.off = Math.max(-2.5, Math.min(2.5, Number(msg.off) || 0));
      p.lap = Math.max(1, Math.min(LAPS + 1, Number(msg.lap) || 1));
      p.spd = Math.max(0, Number(msg.spd) || 0);
      p.boost = !!msg.b;
      break;
    }

    case 'finish': {
      const p = peer.player;
      if (!p || !peer.room) break;
      if (!p.finished) {
        p.finished = true;
        p.finishTime = Math.max(0, Number(msg.time) || 0);
        pushRoom(peer.room);
      }
      break;
    }

    case 'lobby':
      if (peer.room && peer.player && peer.room.hostId === peer.player.id) {
        peer.room.state = 'lobby';
        for (const p of peer.room.players.values()) {
          p.lap = 1; p.z = 0; p.finished = false; p.finishTime = null;
        }
        pushRoom(peer.room);
      }
      break;

    case 'leave':
      leaveRoom(peer);
      peer.close();
      break;
  }
}

function joinRoom(peer, msg) {
  if (peer.room) leaveRoom(peer);

  let room = null;
  const code = String(msg.code || '').toUpperCase().trim();
  if (code) {
    room = rooms.get(code);
    if (!room) return peer.send({ t: 'error', msg: 'Room ' + code + ' not found.' });
    if (room.state !== 'lobby') return peer.send({ t: 'error', msg: 'That race is already running.' });
    if (room.players.size >= MAX_PLAYERS) return peer.send({ t: 'error', msg: 'That room is full.' });
  } else {
    room = {
      code: makeCode(),
      hostId: null,
      players: new Map(),
      state: 'lobby',
      seed: 0,
      startAt: 0,
    };
    rooms.set(room.code, room);
    console.log('[room ' + room.code + '] created');
  }

  const id = 'p' + (++idSeq);
  const used = new Set([...room.players.values()].map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || 1;

  const player = {
    id,
    name: cleanName(msg.name),
    color,
    peer,
    lap: 1,
    z: 0,
    off: 0,
    spd: 0,
    boost: false,
    finished: false,
    finishTime: null,
  };

  room.players.set(id, player);
  if (!room.hostId) room.hostId = id;
  peer.player = player;
  peer.room = room;

  peer.send({ ...roomInfo(room), you: id });
  for (const p of room.players.values()) {
    if (p.id !== id && p.peer && p.peer.alive) p.peer.send(roomInfo(room));
  }
}

function startRace(room) {
  if (room.state === 'racing') return;
  room.seed = crypto.randomInt(1, 2147483000);
  room.startAt = Date.now() + 3400;
  room.state = 'racing';
  for (const p of room.players.values()) {
    p.lap = 1; p.z = 0; p.off = 0; p.spd = 0; p.boost = false;
    p.finished = false; p.finishTime = null;
  }
  broadcast(room, { t: 'race', seed: room.seed, startAt: room.startAt, laps: LAPS });
  console.log('[room ' + room.code + '] race started, seed ' + room.seed);
}

/* 15 Hz position snapshots for every live room */
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.state !== 'racing') continue;
    const players = [];
    for (const p of room.players.values()) {
      players.push({
        id: p.id,
        z: Math.round(p.z),
        off: +p.off.toFixed(3),
        lap: p.lap,
        spd: Math.round(p.spd),
        b: p.boost ? 1 : 0,
        fin: p.finished ? 1 : 0,
      });
    }
    broadcast(room, { t: 'snap', players });
  }
}, 66);

server.listen(PORT, () => {
  console.log('APEX RUSH running at http://localhost:' + PORT);
  console.log('Multiplayer rooms share this link — open it in another browser to test.');
});
