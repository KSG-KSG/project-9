// 클라이언트 ↔ 게임 서버 메시지 타입. 형식: { t: <type>, ...payload }

export const C2S = {
  CREATE_ROOM: 'create_room', // { name, settings? }
  JOIN_ROOM: 'join_room',     // { code, name }
  RESUME: 'resume',           // { token }
  LEAVE: 'leave',             // {}
  READY: 'ready',             // {}  로비·라운드 결과·매치 종료(리매치)에서 사용
  DRAFT: 'draft',             // { count }  출제 중 칸 수 (모양은 비공개)
  SUBMIT_PUZZLE: 'submit_puzzle', // { path, revealStart }
  MOVE: 'move',               // { cell, seq }
  RESET: 'reset',             // { seq }
  GIVE_UP: 'give_up',         // {}
  EMOTE: 'emote',             // { e }
  PING: 'ping',               // { ct }
};

export const S2C = {
  ROOM: 'room',             // { code, token, you }
  STATE: 'state',           // 방 전체 상태 (정답 제외)
  DRAFT: 'draft',           // { count }
  PATH: 'path',             // { path, seq, resets }
  EMOTE: 'emote',           // { e, from }
  ERROR: 'error',           // { code, msg }
  PONG: 'pong',             // { ct, st }
};

export const PHASE = {
  LOBBY: 'LOBBY',               // 상대 대기 / 준비
  SETTING: 'SETTING',           // 출제 중
  COUNTDOWN: 'COUNTDOWN',       // 3·2·1
  SOLVING: 'SOLVING',           // 풀이 중
  ROUND_RESULT: 'ROUND_RESULT', // 라운드 결과
  MATCH_END: 'MATCH_END',       // 최종 결과
};

export const EMOTES = ['😏', '🔥', '😱', '👏', '🤔', '😂'];

export const DEFAULT_SETTINGS = {
  rows: 5,
  cols: 5,
  rounds: 3,          // 각자 출제 횟수
  solveSeconds: 60,
  setSeconds: 60,
};
