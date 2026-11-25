import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from './server.js';

let game, url;

before(async () => {
  game = createGameServer({ roomOpts: { countdownMs: 50, solveMs: 400 } });
  const port = await game.listen(0);
  url = `ws://127.0.0.1:${port}`;
});
after(() => {
  for (const c of clients) c.ws.terminate();
  return game.close();
});

const clients = [];

/** 테스트용 클라이언트: 받은 메시지를 쌓아두고, 아직 꺼내지 않은 메시지 중 조건에 맞는 것을 기다린다 */
function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const consumed = new Set();
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (!consumed.has(msg) && w.pred(msg)) {
        consumed.add(msg);
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }
  });
  const c = {
    ws, inbox,
    open: new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    wait(pred, ms = 2000) {
      const hit = inbox.find((m) => !consumed.has(m) && pred(m));
      if (hit) { consumed.add(hit); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        w.timer = setTimeout(() => reject(new Error(`timeout waiting: ${pred}`)), ms);
        waiters.push(w);
      });
    },
    waitPhase: (phase) => c.wait((m) => m.t === 'state' && m.phase === phase),
  };
  clients.push(c);
  return c;
}

// 5x5 위쪽 세 줄 지그재그 (15칸)
const SOLUTION = [0, 1, 2, 3, 4, 9, 8, 7, 6, 5, 10, 11, 12, 13, 14];

async function setupRoom() {
  const a = client(); await a.open;
  a.send({ t: 'create_room', name: '에이' });
  const room = await a.wait((m) => m.t === 'room');
  const b = client(); await b.open;
  b.send({ t: 'join_room', code: room.code, name: '비' });
  const bRoom = await b.wait((m) => m.t === 'room');
  return { a, b, code: room.code, aId: room.you, bId: bRoom.you, bToken: bRoom.token };
}

async function startMatch({ a, b }) {
  const pa = a.waitPhase('SETTING');
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  return pa;
}

test('방 생성 → 입장 → 출제 → 풀이 성공 → 정답은 결과 때만 공개', async () => {
  const ctx = await setupRoom();
  const { a, b, aId, bId } = ctx;
  const setting = await startMatch(ctx);
  assert.equal(setting.setter, aId);
  assert.equal(setting.solver, bId);

  // 출제 중 칸 수 중계
  a.send({ t: 'draft', count: 7 });
  assert.equal((await b.wait((m) => m.t === 'draft')).count, 7);

  a.send({ t: 'submit_puzzle', path: SOLUTION, revealStart: false });
  const countdown = await b.waitPhase('COUNTDOWN');
  assert.ok(countdown.puzzle, '도전자에게 문제 전달');
  assert.equal(countdown.puzzle.cells.filter(Boolean).length, 15);
  assert.equal(countdown.result, null);
  assert.ok(!JSON.stringify(b.inbox).includes('solution":['), '풀이 전 정답 미노출');

  await b.waitPhase('SOLVING');

  // 출제자와 다른 경로(세로 지그재그)로 풀어본다
  const alt = [0, 5, 10, 11, 6, 1, 2, 7, 12, 13, 8, 3, 4, 9, 14];
  // 무효 이동(구멍 칸 20)은 거절되고 현재 경로로 교정됨
  b.send({ t: 'move', cell: 0, seq: 1 });
  b.send({ t: 'move', cell: 20, seq: 2 });
  const corrected = await b.wait((m) => m.t === 'path' && m.seq === 2);
  assert.deepEqual(corrected.path, [0]);

  // 관전: 출제자도 경로를 실시간으로 받는다
  const spectated = a.wait((m) => m.t === 'path' && m.path.length === 3);
  let seq = 2;
  for (const c of alt.slice(1)) b.send({ t: 'move', cell: c, seq: ++seq });
  assert.deepEqual((await spectated).path, [0, 5, 10]);

  const done = await a.waitPhase('ROUND_RESULT');
  assert.equal(done.result.result, 'solved');
  assert.deepEqual(done.result.solution, SOLUTION, '결과 때 정답 공개');
  assert.ok(done.result.points[bId] >= 50);
  assert.equal(done.players.find((p) => p.id === bId).score, done.result.points[bId]);

  // 다음 라운드: 역할 교대
  a.send({ t: 'ready' });
  b.send({ t: 'ready' });
  const next = await a.waitPhase('SETTING');
  assert.equal(next.setter, bId);
  a.ws.close(); b.ws.close();
});

test('시간 초과 시 출제자 승리', async () => {
  const ctx = await setupRoom();
  await startMatch(ctx);
  ctx.a.send({ t: 'submit_puzzle', path: SOLUTION, revealStart: true });
  const res = await ctx.a.waitPhase('ROUND_RESULT');
  assert.equal(res.result.result, 'timeout');
  assert.equal(res.result.points[ctx.aId], 100);
  ctx.a.ws.close(); ctx.b.ws.close();
});

test('시작점 공개 문제는 다른 칸에서 시작할 수 없다', async () => {
  const ctx = await setupRoom();
  await startMatch(ctx);
  ctx.a.send({ t: 'submit_puzzle', path: SOLUTION, revealStart: true });
  const cd = await ctx.b.waitPhase('COUNTDOWN');
  assert.equal(cd.puzzle.start, 0);
  await ctx.b.waitPhase('SOLVING');
  ctx.b.send({ t: 'move', cell: 14, seq: 1 });
  assert.deepEqual((await ctx.b.wait((m) => m.t === 'path')).path, []);
  ctx.a.ws.close(); ctx.b.ws.close();
});

test('잘못된 출제·권한 없는 행동은 거절', async () => {
  const ctx = await setupRoom();
  await startMatch(ctx);
  ctx.a.send({ t: 'submit_puzzle', path: [0, 1, 2], revealStart: false });
  assert.equal((await ctx.a.wait((m) => m.t === 'error')).code, 'TOO_SHORT');
  ctx.b.send({ t: 'submit_puzzle', path: SOLUTION, revealStart: false });
  assert.equal((await ctx.b.wait((m) => m.t === 'error')).code, 'BAD_PHASE');
  ctx.a.ws.close(); ctx.b.ws.close();
});

test('방 정원 2명, 없는 방 코드', async () => {
  const ctx = await setupRoom();
  const c = client(); await c.open;
  c.send({ t: 'join_room', code: ctx.code, name: '씨' });
  assert.equal((await c.wait((m) => m.t === 'error')).code, 'ROOM_FULL');
  c.send({ t: 'join_room', code: '0000', name: '씨' });
  assert.equal((await c.wait((m) => m.t === 'error')).code, 'NO_ROOM');
  ctx.a.ws.close(); ctx.b.ws.close(); c.ws.close();
});

test('끊겼다가 토큰으로 재접속하면 상태 복원', async () => {
  const ctx = await setupRoom();
  await startMatch(ctx);
  ctx.a.send({ t: 'submit_puzzle', path: SOLUTION, revealStart: false });
  await ctx.b.waitPhase('COUNTDOWN');

  const away = ctx.a.wait((m) => m.t === 'state' && m.players.some((p) => !p.connected));
  ctx.b.ws.close();
  await away;

  const b2 = client(); await b2.open;
  b2.send({ t: 'resume', token: ctx.bToken });
  const room = await b2.wait((m) => m.t === 'room');
  assert.equal(room.you, ctx.bId);
  const st = await b2.wait((m) => m.t === 'state');
  assert.ok(st.puzzle, '문제 복원');
  assert.ok(st.players.every((p) => p.connected));
  ctx.a.ws.close(); b2.ws.close();
});

test('ping → pong (시계 보정용 서버 시각)', async () => {
  const c = client(); await c.open;
  c.send({ t: 'ping', ct: 123 });
  const pong = await c.wait((m) => m.t === 'pong');
  assert.equal(pong.ct, 123);
  assert.ok(Math.abs(pong.st - Date.now()) < 1000);
  c.ws.close();
});
