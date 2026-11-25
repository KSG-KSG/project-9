import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { C2S, S2C } from '@duel/shared/protocol';

const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 30;
const HEARTBEAT_MS = 15_000;
const JOIN_FAIL_LIMIT_PER_MIN = 10;

/**
 * 게임 서버 생성. 테스트에서도 같은 함수를 쓴다.
 * @param {{ allowedOrigins?: string[], roomOpts?: object }} opts
 */
export function createGameServer(opts = {}) {
  const allowedOrigins = opts.allowedOrigins ?? [];
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  const joinFails = new Map(); // ip -> [timestamps]

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: MAX_MSG_BYTES,
    verifyClient: ({ origin }) => allowedOrigins.length === 0 || allowedOrigins.includes(origin),
  });

  function newCode() {
    for (let i = 0; i < 1000; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!rooms.has(code)) return code;
    }
    throw new Error('방이 너무 많아요');
  }

  function createRoom(settings) {
    const code = newCode();
    const room = new Room(code, settings, {
      ...opts.roomOpts,
      onEmpty: (r) => rooms.delete(r.code),
    });
    rooms.set(code, room);
    return room;
  }

  function tooManyJoinFails(ip) {
    const now = Date.now();
    const list = (joinFails.get(ip) ?? []).filter((t) => now - t < 60_000);
    joinFails.set(ip, list);
    return list.length >= JOIN_FAIL_LIMIT_PER_MIN;
  }

  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress;
    /** @type {{room: Room, player: any} | null} */
    let session = null;
    let msgTimes = [];
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
    const fail = (code, msg) => send({ t: S2C.ERROR, code, msg });

    ws.on('message', (raw) => {
      const now = Date.now();
      msgTimes = msgTimes.filter((t) => now - t < 1000);
      msgTimes.push(now);
      if (msgTimes.length > MAX_MSGS_PER_SEC) return ws.close(4008, 'rate limit');

      let msg;
      try { msg = JSON.parse(raw); } catch { return fail('BAD_JSON', '잘못된 메시지'); }
      if (!msg || typeof msg.t !== 'string') return fail('BAD_JSON', '잘못된 메시지');

      if (msg.t === C2S.PING) return send({ t: S2C.PONG, ct: msg.ct, st: Date.now() });

      if (!session) {
        if (msg.t === C2S.CREATE_ROOM) {
          const room = createRoom(msg.settings ?? {});
          session = { room, player: room.addPlayer(msg.name, ws) };
          return;
        }
        if (msg.t === C2S.JOIN_ROOM) {
          if (tooManyJoinFails(ip)) return fail('RATE_LIMIT', '잠시 후 다시 시도해주세요');
          const room = rooms.get(String(msg.code ?? ''));
          if (!room) {
            joinFails.get(ip).push(Date.now());
            return fail('NO_ROOM', '방을 찾을 수 없어요');
          }
          const player = room.addPlayer(msg.name, ws);
          if (!player) return fail('ROOM_FULL', '방이 가득 찼어요');
          session = { room, player };
          return;
        }
        if (msg.t === C2S.RESUME) {
          for (const room of rooms.values()) {
            const player = room.resume(msg.token, ws);
            if (player) { session = { room, player }; return; }
          }
          return fail('NO_SESSION', '이전 게임을 찾을 수 없어요');
        }
        return fail('NO_ROOM', '먼저 방에 들어가야 해요');
      }

      if (msg.t === C2S.LEAVE) {
        session.room.leave(session.player);
        session = null;
        return;
      }
      session.room.handle(session.player, msg);
    });

    ws.on('close', () => {
      if (session && session.player.ws === ws) session.room.disconnect(session.player);
    });
  });

  // 하트비트: 응답 없는 좀비 연결 정리
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));

  return {
    server,
    rooms,
    listen(port) {
      return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
    },
    close() {
      clearInterval(heartbeat);
      for (const room of rooms.values()) room.destroy();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
