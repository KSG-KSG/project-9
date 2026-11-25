import { C2S, S2C } from '@duel/shared/protocol';

const TOKEN_KEY = 'duel.token';
const PING_EVERY_MS = 3000;

export function gameServerUrl() {
  const env = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:8787`;
}

// 토큰은 탭 단위(sessionStorage)로 보관: 같은 브라우저의 두 탭이 서로의 자리를 뺏지 않게.
function store(op, value) {
  try {
    if (op === 'get') return sessionStorage.getItem(TOKEN_KEY);
    if (op === 'set') sessionStorage.setItem(TOKEN_KEY, value);
    if (op === 'del') sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* 사파리 프라이빗 모드 등 — 재접속만 못 할 뿐 게임은 동작 */ }
  return null;
}

/**
 * WebSocket 래퍼
 * - 끊기면 지수 백오프로 재연결 후 토큰으로 resume
 * - ping/pong 으로 RTT 와 서버 시계 오차(offset) 추정
 * - 상태 변화는 onStatus, 서버 메시지는 onMessage 로 전달
 */
export class GameClient {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.status = 'idle';     // idle | connecting | open | reconnecting
    this.retry = 0;
    this.closedByUser = false;
    this.pending = [];        // 연결 전 보낸 메시지
    this.samples = [];        // { rtt, offset }
    this.rtt = null;
    this.offset = 0;          // serverTime ≈ Date.now() + offset
    this.pingTimer = null;
    this.onVisible = () => {
      if (document.visibilityState === 'visible' && this.ws?.readyState !== WebSocket.OPEN) this.connect();
    };
    document.addEventListener('visibilitychange', this.onVisible);
  }

  get token() { return store('get'); }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.closedByUser = false;
    this.setStatus(this.retry > 0 ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(gameServerUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      const token = store('get');
      if (token) this.raw({ t: C2S.RESUME, token });
      for (const m of this.pending.splice(0)) this.raw(m);
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === S2C.PONG) return this.handlePong(msg);
      if (msg.t === S2C.ROOM) store('set', msg.token);
      if (msg.t === S2C.ERROR && msg.code === 'NO_SESSION') store('del');
      this.onMessage(msg);
    };

    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return this.setStatus('idle');
      // 0.5s, 1s, 2s, 4s, 5s, 5s ...
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      this.setStatus('reconnecting');
      setTimeout(() => this.connect(), delay);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.raw(msg);
    else { this.pending.push(msg); this.connect(); }
  }

  raw(msg) { this.ws.send(JSON.stringify(msg)); }

  ping() {
    if (this.ws?.readyState === WebSocket.OPEN) this.raw({ t: C2S.PING, ct: Date.now() });
  }

  handlePong({ ct, st }) {
    const now = Date.now();
    const rtt = now - ct;
    // 서버가 st 를 찍은 순간 ≈ 왕복의 중간 지점
    const offset = st - (ct + rtt / 2);
    this.samples = [...this.samples.slice(-4), { rtt, offset }];
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    // RTT 가 가장 짧았던 샘플의 오차가 가장 정확하다
    this.offset = sorted[0].offset;
    this.rtt = Math.round(this.samples.reduce((s, x) => s + x.rtt, 0) / this.samples.length);
    this.onStatus?.(this.status, this.rtt);
  }

  serverNow() { return Date.now() + this.offset; }

  leave() {
    this.send({ t: C2S.LEAVE });
    store('del');
  }

  setStatus(s) {
    this.status = s;
    this.onStatus?.(s, this.rtt);
  }

  destroy() {
    this.closedByUser = true;
    clearInterval(this.pingTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ws?.close();
  }
}
