// 한붓그리기 규칙 — 클라이언트(예측)와 서버(판정)가 같은 코드를 쓴다.
// 칸은 index = row * cols + col 로 표현한다.

export const MIN_SIZE = 4;
export const MAX_SIZE = 7;
export const MIN_FILL_RATIO = 0.5;

export function isValidSize(rows, cols) {
  return (
    Number.isInteger(rows) && Number.isInteger(cols) &&
    rows >= MIN_SIZE && rows <= MAX_SIZE && cols >= MIN_SIZE && cols <= MAX_SIZE
  );
}

export function minCells(rows, cols) {
  return Math.ceil(rows * cols * MIN_FILL_RATIO);
}

export function isAdjacent(a, b, cols) {
  const ar = Math.floor(a / cols), ac = a % cols;
  const br = Math.floor(b / cols), bc = b % cols;
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

/** 출제자 경로 검증: 범위·중복·인접·최소 칸 수 */
export function validateSetterPath(path, rows, cols) {
  if (!isValidSize(rows, cols)) return { ok: false, error: 'BAD_SIZE' };
  if (!Array.isArray(path)) return { ok: false, error: 'BAD_PATH' };
  const total = rows * cols;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (!Number.isInteger(c) || c < 0 || c >= total) return { ok: false, error: 'OUT_OF_RANGE' };
    if (seen.has(c)) return { ok: false, error: 'REVISIT' };
    if (i > 0 && !isAdjacent(path[i - 1], c, cols)) return { ok: false, error: 'NOT_ADJACENT' };
    seen.add(c);
  }
  if (path.length < minCells(rows, cols)) return { ok: false, error: 'TOO_SHORT' };
  return { ok: true };
}

/** 출제 경로 → 활성 칸 배열 (1 = 지나가야 하는 칸, 0 = 구멍) */
export function cellsFromPath(path, rows, cols) {
  const cells = new Array(rows * cols).fill(0);
  for (const c of path) cells[c] = 1;
  return cells;
}

/**
 * 풀이 중 한 칸 이동을 적용한다.
 * - 직전 칸(path[len-2])을 가리키면 한 칸 되돌리기
 * - 그 외엔 현재 끝 칸과 인접 + 활성 + 미방문이어야 전진
 * @returns 새 path 배열, 무효한 이동이면 null
 */
export function applyMove(path, cell, puzzle) {
  const { cols, cells, start } = puzzle;
  if (!Number.isInteger(cell) || cell < 0 || cell >= cells.length) return null;
  if (path.length === 0) {
    if (!cells[cell]) return null;
    if (start != null && cell !== start) return null;
    return [cell];
  }
  const head = path[path.length - 1];
  if (cell === head) return null;
  if (path.length >= 2 && cell === path[path.length - 2]) return path.slice(0, -1);
  if (!cells[cell] || !isAdjacent(head, cell, cols) || path.includes(cell)) return null;
  return [...path, cell];
}

export function isComplete(path, cells) {
  let active = 0;
  for (const v of cells) if (v) active++;
  return path.length === active;
}

/** 도전자 성공 점수: 100 + 남은 초 × 2 − 리셋 × 5, 최소 50 */
export function solvePoints(remainingMs, resets) {
  const raw = 100 + Math.floor(Math.max(0, remainingMs) / 1000) * 2 - resets * 5;
  return Math.max(50, raw);
}

export const SETTER_WIN_POINTS = 100;
export const NO_PUZZLE_PENALTY = -50;
