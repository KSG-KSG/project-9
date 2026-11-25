import { randomUUID } from 'node:crypto';
import {
  validateSetterPath, cellsFromPath, applyMove, isComplete, solvePoints,
  isValidSize, SETTER_WIN_POINTS, NO_PUZZLE_PENALTY,
} from '@duel/shared/rules';
import { S2C, PHASE, EMOTES, DEFAULT_SETTINGS } from '@duel/shared/protocol';

const COUNTDOWN_MS = 3000;
const EMPTY_ROOM_TTL_MS = 5 * 60_000;

/**
 * 방 하나 = 대결 하나. 게임 상태의 유일한 진실(Single Source of Truth).
 * 상태 전이는 모두 이 클래스 안에서만 일어난다.
 */
export class Room {
  constructor(code, settings = {}, opts = {}) {
    this.code = code;
    this.settings = sanitizeSettings(settings);
    this.countdownMs = opts.countdownMs ?? COUNTDOWN_MS;
    this.solveMs = opts.solveMs ?? null; // 테스트용 덮어쓰기
    this.onEmpty = opts.onEmpty ?? (() => {});
    /** @type {Array<{id,name,token,ws,connected,ready,score}>} */
    this.players = [];
    this.phase = PHASE.LOBBY;
    this.turn = 0;            // 0부터. 출제자 = players[turn % 2]
    this.deadline = null;     // 서버 기준 epoch ms
    this.timer = null;
    this.emptyTimer = null;
    this.draftCount = 0;
    this.puzzle = null;       // { rows, cols, cells, start, solution }
    this.solve = null;        // { path, resets, startedAt, lastSeq }
    this.lastResult = null;
    this.history = [];
  }

  // ───────── 입장 / 연결 ─────────

  addPlayer(name, ws) {
    if (this.players.length >= 2) return null;
    const p = {
      id: randomUUID().slice(0, 8),
      name: cleanName(name, this.players.length),
      token: randomUUID(),
      ws, connected: true, ready: false, score: 0,
    };
    this.players.push(p);
    this.cancelEmptyTimer();
    this.sendTo(p, { t: S2C.ROOM, code: this.code, token: p.token, you: p.id });
    this.broadcastState();
    return p;
  }

  resume(token, ws) {
    const p = this.players.find((x) => x.token === token);
    if (!p) return null;
    if (p.ws && p.ws !== ws) p.ws.close(4000, 'replaced');
    p.ws = ws;
    p.connected = true;
    this.cancelEmptyTimer();
    this.sendTo(p, { t: S2C.ROOM, code: this.code, token: p.token, you: p.id });
    this.broadcastState();
    if (this.solve) this.sendTo(p, this.pathMsg());
    if (this.phase === PHASE.SETTING) this.sendTo(p, { t: S2C.DRAFT, count: this.draftCount });
    return p;
  }

  disconnect(p) {
    p.connected = false;
    p.ws = null;
    this.broadcastState();
    if (this.players.every((x) => !x.connected)) {
      this.emptyTimer = setTimeout(() => this.destroy(), EMPTY_ROOM_TTL_MS);
    }
  }

  leave(p) {
    this.players = this.players.filter((x) => x !== p);
    this.clearTimer();
    // 한 명이 나가면 대결은 처음부터 (남은 사람은 로비에서 새 상대 대기)
    this.resetMatch();
    if (this.players.length === 0) this.destroy();
    else this.broadcastState();
  }

  destroy() {
    this.clearTimer();
    this.cancelEmptyTimer();
    this.onEmpty(this);
  }

  // ───────── 메시지 처리 ─────────

  get setter() { return this.players[this.turn % 2]; }
  get solver() { return this.players[(this.turn + 1) % 2]; }

  handle(p, msg) {
    switch (msg.t) {
      case 'ready': return this.onReady(p);
      case 'draft': return this.onDraft(p, msg);
      case 'submit_puzzle': return this.onSubmit(p, msg);
      case 'move': return this.onMove(p, msg);
      case 'reset': return this.onReset(p, msg);
      case 'give_up': return this.onGiveUp(p);
      case 'emote': return this.onEmote(p, msg);
      case 'leave': return this.leave(p);
      default: return this.error(p, 'UNKNOWN', `알 수 없는 메시지: ${msg.t}`);
    }
  }

  onReady(p) {
    const ok = [PHASE.LOBBY, PHASE.ROUND_RESULT, PHASE.MATCH_END].includes(this.phase);
    if (!ok) return this.error(p, 'BAD_PHASE', '지금은 준비할 수 없어요');
    p.ready = !p.ready;
    if (this.players.length === 2 && this.players.every((x) => x.ready)) {
      this.players.forEach((x) => { x.ready = false; });
      if (this.phase === PHASE.LOBBY) this.startSetting();
      else if (this.phase === PHASE.ROUND_RESULT) this.nextTurn();
      else { this.resetMatch(); this.startSetting(); }
      return;
    }
    this.broadcastState();
  }

  onDraft(p, { count }) {
    if (this.phase !== PHASE.SETTING || p !== this.setter) return;
    if (!Number.isInteger(count) || count < 0 || count > 49) return;
    this.draftCount = count;
    this.sendTo(this.solver, { t: S2C.DRAFT, count });
  }

  onSubmit(p, { path, revealStart }) {
    if (this.phase !== PHASE.SETTING || p !== this.setter) {
      return this.error(p, 'BAD_PHASE', '지금은 출제할 수 없어요');
    }
    const { rows, cols } = this.settings;
    const v = validateSetterPath(path, rows, cols);
    if (!v.ok) return this.error(p, v.error, setterErrorText(v.error));
    this.puzzle = {
      rows, cols,
      cells: cellsFromPath(path, rows, cols),
      start: revealStart ? path[0] : null,
      solution: [...path], // ← 라운드가 끝나기 전엔 절대 내보내지 않는다
    };
    this.startCountdown();
  }

  onMove(p, { cell, seq }) {
    if (this.phase !== PHASE.SOLVING || p !== this.solver) return;
    const next = applyMove(this.solve.path, cell, this.puzzle);
    if (next) this.solve.path = next;
    if (Number.isInteger(seq)) this.solve.lastSeq = seq;
    // 무효 이동이어도 현재 경로를 돌려줘서 클라이언트 예측을 교정한다
    this.broadcast(this.pathMsg());
    if (next && isComplete(next, this.puzzle.cells)) this.endRound('solved');
  }

  onReset(p, { seq }) {
    if (this.phase !== PHASE.SOLVING || p !== this.solver) return;
    if (this.solve.path.length > 0) this.solve.resets++;
    this.solve.path = [];
    if (Number.isInteger(seq)) this.solve.lastSeq = seq;
    this.broadcast(this.pathMsg());
  }

  onGiveUp(p) {
    if (this.phase !== PHASE.SOLVING || p !== this.solver) return;
    this.endRound('gaveup');
  }

  onEmote(p, { e }) {
    if (!EMOTES.includes(e)) return;
    const now = Date.now();
    p.emoteTimes = (p.emoteTimes ?? []).filter((t) => now - t < 1000);
    if (p.emoteTimes.length >= 2) return; // 초당 2회 제한
    p.emoteTimes.push(now);
    const other = this.players.find((x) => x !== p);
    if (other) this.sendTo(other, { t: S2C.EMOTE, e, from: p.id });
  }

  // ───────── 상태 전이 ─────────

  startSetting() {
    this.phase = PHASE.SETTING;
    this.puzzle = null;
    this.solve = null;
    this.lastResult = null;
    this.draftCount = 0;
    this.setTimer(this.settings.setSeconds * 1000, () => this.endRound('no_puzzle'));
    this.broadcastState();
  }

  startCountdown() {
    this.phase = PHASE.COUNTDOWN;
    this.solve = { path: [], resets: 0, startedAt: null, lastSeq: 0 };
    this.setTimer(this.countdownMs, () => this.startSolving());
    this.broadcastState();
  }

  startSolving() {
    this.phase = PHASE.SOLVING;
    this.solve.startedAt = Date.now();
    this.setTimer(this.solveMs ?? this.settings.solveSeconds * 1000, () => this.endRound('timeout'));
    this.broadcastState();
  }

  endRound(result) {
    const now = Date.now();
    const remaining = this.deadline ? this.deadline - now : 0;
    this.clearTimer();
    const setter = this.setter, solver = this.solver;
    let setterPts = 0, solverPts = 0;
    if (result === 'solved') solverPts = solvePoints(remaining, this.solve.resets);
    else if (result === 'no_puzzle') setterPts = NO_PUZZLE_PENALTY;
    else setterPts = SETTER_WIN_POINTS;
    setter.score += setterPts;
    solver.score += solverPts;

    this.lastResult = {
      result,
      setter: setter.id,
      solver: solver.id,
      timeMs: this.solve?.startedAt ? now - this.solve.startedAt : null,
      resets: this.solve?.resets ?? 0,
      points: { [setter.id]: setterPts, [solver.id]: solverPts },
      solution: this.puzzle?.solution ?? null, // 이제 정답 공개
      solverPath: this.solve?.path ?? [],
    };
    this.history.push({ turn: this.turn, ...this.lastResult });
    const lastTurn = this.turn >= this.settings.rounds * 2 - 1;
    this.phase = lastTurn ? PHASE.MATCH_END : PHASE.ROUND_RESULT;
    this.broadcastState();
  }

  nextTurn() {
    this.turn++;
    this.startSetting();
  }

  resetMatch() {
    this.clearTimer();
    this.phase = PHASE.LOBBY;
    this.turn = 0;
    this.puzzle = null;
    this.solve = null;
    this.lastResult = null;
    this.history = [];
    this.players.forEach((x) => { x.score = 0; x.ready = false; });
    // 리매치 때는 이전 매치 2번째 출제자가 먼저 출제하도록 순서를 바꾼다
    if (this.players.length === 2) this.players.reverse();
  }

  // ───────── 타이머 ─────────

  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  cancelEmptyTimer() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  // ───────── 전송 ─────────

  /** 클라이언트에 보내는 방 상태. 정답(solution)은 라운드 종료 전엔 포함하지 않는다. */
  publicState() {
    const pz = this.puzzle;
    return {
      t: S2C.STATE,
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      turn: this.turn,
      totalTurns: this.settings.rounds * 2,
      setter: this.players.length === 2 ? this.setter.id : null,
      solver: this.players.length === 2 ? this.solver.id : null,
      deadline: this.deadline,
      players: this.players.map((x) => ({
        id: x.id, name: x.name, connected: x.connected, ready: x.ready, score: x.score,
      })),
      puzzle: pz && this.phase !== PHASE.SETTING
        ? { rows: pz.rows, cols: pz.cols, cells: pz.cells, start: pz.start }
        : null,
      result: this.lastResult,
      history: this.phase === PHASE.MATCH_END ? this.history.map(stripHistory) : null,
    };
  }

  pathMsg() {
    return {
      t: S2C.PATH,
      path: this.solve.path,
      seq: this.solve.lastSeq,
      resets: this.solve.resets,
    };
  }

  broadcastState() { this.broadcast(this.publicState()); }

  broadcast(msg) { for (const p of this.players) this.sendTo(p, msg); }

  sendTo(p, msg) {
    if (p?.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  error(p, code, msg) { this.sendTo(p, { t: S2C.ERROR, code, msg }); }
}

function stripHistory(h) {
  return { turn: h.turn, result: h.result, setter: h.setter, solver: h.solver, timeMs: h.timeMs, points: h.points };
}

function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (isValidSize(s.rows, s.cols)) { out.rows = s.rows; out.cols = s.cols; }
  if ([1, 2, 3, 5].includes(s.rounds)) out.rounds = s.rounds;
  if ([30, 60, 120].includes(s.solveSeconds)) out.solveSeconds = s.solveSeconds;
  if (Number.isInteger(s.setSeconds) && s.setSeconds >= 1 && s.setSeconds <= 300) out.setSeconds = s.setSeconds;
  return out;
}

function cleanName(name, i) {
  const n = typeof name === 'string' ? name.trim().slice(0, 12) : '';
  return n || `플레이어${i + 1}`;
}

function setterErrorText(code) {
  return {
    TOO_SHORT: '칸을 더 많이 지나가야 해요 (전체의 절반 이상)',
    NOT_ADJACENT: '경로가 끊겼어요',
    REVISIT: '같은 칸을 두 번 지날 수 없어요',
    OUT_OF_RANGE: '판 밖의 칸이에요',
    BAD_SIZE: '판 크기가 잘못됐어요',
    BAD_PATH: '경로 형식이 잘못됐어요',
  }[code] ?? '출제할 수 없는 경로예요';
}
