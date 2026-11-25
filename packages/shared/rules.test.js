import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSetterPath, cellsFromPath, applyMove, isComplete, solvePoints, isAdjacent,
} from './rules.js';

// 4x4 격자에서 위 두 줄을 지그재그로 채우는 경로 (8칸 = 50%)
const ZIGZAG = [0, 1, 2, 3, 7, 6, 5, 4];

test('isAdjacent는 행이 바뀌는 경계를 인접으로 보지 않는다', () => {
  assert.equal(isAdjacent(3, 4, 4), false);
  assert.equal(isAdjacent(3, 7, 4), true);
});

test('출제 경로 검증', () => {
  assert.deepEqual(validateSetterPath(ZIGZAG, 4, 4), { ok: true });
  assert.equal(validateSetterPath([0, 1, 2], 4, 4).error, 'TOO_SHORT');
  assert.equal(validateSetterPath([0, 1, 2, 3, 4, 5, 6, 7], 4, 4).error, 'NOT_ADJACENT');
  assert.equal(validateSetterPath([0, 1, 0, 1, 2, 3, 7, 6], 4, 4).error, 'REVISIT');
  assert.equal(validateSetterPath([0, 99], 4, 4).error, 'OUT_OF_RANGE');
  assert.equal(validateSetterPath(ZIGZAG, 3, 4).error, 'BAD_SIZE');
});

test('applyMove: 전진·되돌리기·무효 이동', () => {
  const puzzle = { cols: 4, cells: cellsFromPath(ZIGZAG, 4, 4), start: null };
  let p = applyMove([], 5, puzzle);
  assert.deepEqual(p, [5]);
  assert.equal(applyMove([], 12, puzzle), null, '구멍에서 시작 불가');
  p = applyMove(p, 6, puzzle);
  assert.deepEqual(p, [5, 6]);
  assert.deepEqual(applyMove(p, 5, puzzle), [5], '직전 칸 = 되돌리기');
  assert.equal(applyMove(p, 9, puzzle), null, '구멍으로 이동 불가');
  assert.equal(applyMove(p, 0, puzzle), null, '비인접 이동 불가');
  assert.equal(applyMove(p, 6, puzzle), null, '제자리 이동 불가');
});

test('시작점 공개 시 다른 칸에서 시작 불가', () => {
  const puzzle = { cols: 4, cells: cellsFromPath(ZIGZAG, 4, 4), start: 0 };
  assert.equal(applyMove([], 4, puzzle), null);
  assert.deepEqual(applyMove([], 0, puzzle), [0]);
});

test('출제자와 다른 경로로도 완료 판정', () => {
  const cells = cellsFromPath(ZIGZAG, 4, 4);
  const puzzle = { cols: 4, cells, start: null };
  let p = [];
  for (const c of [4, 0, 1, 5, 6, 2, 3, 7]) p = applyMove(p, c, puzzle);
  assert.ok(p);
  assert.equal(isComplete(p, cells), true);
});

test('점수 계산', () => {
  assert.equal(solvePoints(30_500, 0), 160);
  assert.equal(solvePoints(0, 20), 50);
});
