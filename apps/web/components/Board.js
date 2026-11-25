'use client';

import { useRef } from 'react';

const GAP = 0.06;          // 칸 사이 간격 (칸 크기 대비)
const HIT_RADIUS = 0.42;   // 칸 중심에서 이 반경 안에 들어와야 그 칸으로 인식 (경계 오입력 방지)

/**
 * 격자 판
 * - mode 'draw'  : 출제. 모든 칸이 후보, 지나간 칸이 문제가 된다.
 * - mode 'solve' : 풀이. cells 의 활성 칸만 지날 수 있다.
 * - mode 'view'  : 읽기 전용 (관전·리플레이)
 * step(cell) 은 이동을 적용하고 새 경로(또는 무효면 null)를 동기적으로 돌려줘야 한다.
 */
export default function Board({ rows, cols, cells, path, mode, step, start = null, dim = false }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const live = useRef(path);
  live.current = path;

  const interactive = mode !== 'view' && !!step;
  const visited = new Set(path);
  const head = path[path.length - 1];

  function cellAt(e) {
    const rect = ref.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cols;
    const y = ((e.clientY - rect.top) / rect.height) * rows;
    const c = Math.floor(x), r = Math.floor(y);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    const dx = x - (c + 0.5), dy = y - (r + 0.5);
    if (Math.hypot(dx, dy) > HIT_RADIUS) return null;
    return r * cols + c;
  }

  // 손가락이 빨라서 칸을 건너뛰면 같은 행/열 방향으로 한 칸씩 채워준다
  function stepToward(target) {
    let p = live.current;
    for (let guard = 0; guard < rows * cols; guard++) {
      const h = p[p.length - 1];
      if (h === undefined || h === target) return;
      const hr = Math.floor(h / cols), hc = h % cols;
      const tr = Math.floor(target / cols), tc = target % cols;
      let next;
      if (hr === tr) next = h + Math.sign(tc - hc);
      else if (hc === tc) next = h + Math.sign(tr - hr) * cols;
      else return; // 대각선 방향은 무시
      const np = step(next);
      if (!np) return;
      live.current = p = np;
    }
  }

  function onDown(e) {
    if (!interactive) return;
    const cell = cellAt(e);
    if (cell == null) return;
    const p = live.current;
    if (p.length === 0) {
      const np = step(cell);
      if (!np) return;
      live.current = np;
    } else if (cell !== p[p.length - 1]) {
      return; // 이어 그리기는 현재 끝 칸에서만
    }
    dragging.current = true;
    ref.current.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!dragging.current) return;
    const cell = cellAt(e);
    if (cell != null) stepToward(cell);
  }

  function onUp() { dragging.current = false; }

  const pts = path.map((c) => `${(c % cols) + 0.5},${Math.floor(c / cols) + 0.5}`).join(' ');

  return (
    <div
      ref={ref}
      className={`board ${dim ? 'board-dim' : ''}`}
      style={{ aspectRatio: `${cols} / ${rows}` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg viewBox={`0 0 ${cols} ${rows}`} className="board-svg">
        {Array.from({ length: rows * cols }, (_, i) => {
          const active = mode === 'draw' ? true : !!cells?.[i];
          if (!active) return null;
          const on = visited.has(i);
          const cls = mode === 'draw' && !on ? 'cell cell-empty' : on ? 'cell cell-on' : 'cell cell-off';
          return (
            <rect
              key={i}
              className={cls}
              x={(i % cols) + GAP / 2}
              y={Math.floor(i / cols) + GAP / 2}
              width={1 - GAP}
              height={1 - GAP}
              rx={0.14}
            />
          );
        })}
        {start != null && path.length === 0 && (
          <circle className="start-mark" cx={(start % cols) + 0.5} cy={Math.floor(start / cols) + 0.5} r={0.2} />
        )}
        {path.length > 1 && <polyline className="path-line" points={pts} />}
        {head !== undefined && (
          <circle className="path-head" cx={(head % cols) + 0.5} cy={Math.floor(head / cols) + 0.5} r={0.17} />
        )}
      </svg>
    </div>
  );
}
