'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, minCells } from '@duel/shared/rules';
import { EMOTES } from '@duel/shared/protocol';
import { useGame, useRemaining } from '@/lib/useGame';
import Board from './Board';

export default function Game() {
  const g = useGame();
  const { room, you } = g;

  useEffect(() => {
    if (!g.error) return;
    const id = setTimeout(g.clearError, 3000);
    return () => clearTimeout(id);
  }, [g.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = room?.players.find((p) => p.id === you);
  const opp = room?.players.find((p) => p.id !== you);

  let screen;
  if (!room || !me) screen = <Home g={g} />;
  else if (room.phase === 'LOBBY') screen = <Lobby g={g} me={me} opp={opp} />;
  else if (room.phase === 'SETTING') screen = room.setter === you ? <Setting g={g} /> : <WaitSetting g={g} opp={opp} />;
  else if (room.phase === 'COUNTDOWN') screen = <Countdown g={g} />;
  else if (room.phase === 'SOLVING') screen = room.solver === you ? <Solving g={g} /> : <Spectating g={g} opp={opp} />;
  else screen = <Result g={g} me={me} opp={opp} />;

  return (
    <main className="app">
      {room && me && <TopBar g={g} me={me} opp={opp} />}
      {screen}
      {g.error && <div className="toast" role="alert">{g.error.msg}</div>}
      <div className="emote-layer" aria-hidden>
        {g.emotes.map((x) => (
          <span key={x.id} className={`emote-float ${x.mine ? 'mine' : ''}`}>{x.e}</span>
        ))}
      </div>
    </main>
  );
}

// ───────── 상단 바: 점수, 라운드, 연결 상태 ─────────

function TopBar({ g, me, opp }) {
  const { room, conn } = g;
  const round = Math.floor(room.turn / 2) + 1;
  const connColor = conn.status !== 'open' ? 'red' : conn.rtt == null || conn.rtt < 150 ? 'green' : conn.rtt < 400 ? 'yellow' : 'red';
  return (
    <header className="topbar">
      <div className="score me">
        <span className="name">{me.name}</span>
        <b>{me.score}</b>
      </div>
      <div className="mid">
        <div className="round">{room.phase === 'LOBBY' ? `방 ${room.code}` : `라운드 ${round}/${room.settings.rounds}`}</div>
        <div className={`conn conn-${connColor}`} title="연결 상태">
          ● {conn.status === 'open' ? `${conn.rtt ?? '–'}ms` : '재연결 중…'}
        </div>
      </div>
      <div className="score opp">
        <span className="name">
          {opp ? opp.name : '대기 중'}
          {opp && !opp.connected && <em className="away"> (끊김)</em>}
        </span>
        <b>{opp?.score ?? '–'}</b>
      </div>
    </header>
  );
}

// ───────── 홈: 방 만들기 / 입장 ─────────

function Home({ g }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [size, setSize] = useState(5);
  const [rounds, setRounds] = useState(3);
  const [solveSeconds, setSolveSeconds] = useState(60);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setName(localStorage.getItem('duel.name') ?? ''); } catch {}
    const m = location.hash.match(/room=(\d{4})/);
    if (m) setCode(m[1]);
  }, []);

  useEffect(() => { if (g.error) setBusy(false); }, [g.error]);

  const saveName = () => { try { localStorage.setItem('duel.name', name.trim()); } catch {} };

  const create = () => {
    saveName(); setBusy(true);
    g.createRoom(name, { rows: size, cols: size, rounds, solveSeconds });
  };
  const join = () => {
    saveName(); setBusy(true);
    g.joinRoom(code, name);
  };

  return (
    <section className="screen home">
      <h1 className="logo">한붓<span>대결</span></h1>
      <p className="sub">내가 그린 길, 너는 찾을 수 있을까?</p>

      <label className="field">
        <span>닉네임</span>
        <input value={name} maxLength={12} placeholder="이름을 입력하세요" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="card">
        <h2>방 만들기</h2>
        <Choice label="판 크기" value={size} set={setSize} options={[4, 5, 6, 7].map((n) => [n, `${n}×${n}`])} />
        <Choice label="라운드" value={rounds} set={setRounds} options={[1, 3, 5].map((n) => [n, `${n}판`])} />
        <Choice label="풀이 시간" value={solveSeconds} set={setSolveSeconds} options={[30, 60, 120].map((n) => [n, `${n}초`])} />
        <button className="btn primary" disabled={busy} onClick={create}>방 만들기</button>
      </div>

      <div className="card">
        <h2>방 코드로 입장</h2>
        <div className="row">
          <input
            className="code-input"
            inputMode="numeric"
            maxLength={4}
            placeholder="0000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn" disabled={busy || code.length !== 4} onClick={join}>입장</button>
        </div>
      </div>
    </section>
  );
}

function Choice({ label, value, set, options }) {
  return (
    <div className="choice">
      <span>{label}</span>
      <div className="seg">
        {options.map(([v, text]) => (
          <button key={v} className={v === value ? 'on' : ''} onClick={() => set(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

// ───────── 로비 ─────────

function Lobby({ g, me, opp }) {
  const { room } = g;
  const [copied, setCopied] = useState(false);
  const link = typeof location !== 'undefined' ? `${location.origin}/#room=${room.code}` : '';

  const share = async () => {
    const text = `한붓대결 하자! 방 코드 ${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: '한붓대결', text, url: link });
      else { await navigator.clipboard.writeText(`${text}\n${link}`); setCopied(true); }
    } catch { /* 공유 취소 */ }
  };

  return (
    <section className="screen lobby">
      <p className="label">방 코드</p>
      <div className="big-code">{room.code}</div>
      <button className="btn ghost" onClick={share}>{copied ? '링크 복사됨 ✓' : '초대 링크 보내기'}</button>

      <ul className="players">
        {[me, opp].map((p, i) => (
          <li key={p?.id ?? i} className={p ? '' : 'empty'}>
            <span>{p ? p.name : '상대를 기다리는 중…'}{p?.id === me.id && ' (나)'}</span>
            {p && <span className={`badge ${p.ready ? 'ok' : ''}`}>{p.ready ? '준비 완료' : '대기'}</span>}
          </li>
        ))}
      </ul>
      <p className="hint">{room.settings.rows}×{room.settings.cols} · {room.settings.rounds}판 · 풀이 {room.settings.solveSeconds}초</p>

      <button className="btn primary" disabled={!opp} onClick={g.ready}>
        {me.ready ? '준비 취소' : '준비'}
      </button>
      <button className="btn text" onClick={g.leave}>나가기</button>
    </section>
  );
}

// ───────── 출제 ─────────

function Setting({ g }) {
  const { rows, cols } = g.room.settings;
  const [path, setPath] = useState([]);
  const [reveal, setReveal] = useState(false);
  const pathRef = useRef(path);
  const remaining = useRemaining(g.room.deadline, g.serverNow);
  const need = minCells(rows, cols);
  const free = useMemo(() => ({ cols, cells: new Array(rows * cols).fill(1), start: null }), [rows, cols]);

  const step = useCallback((cell) => {
    const next = applyMove(pathRef.current, cell, free);
    if (!next) return null;
    pathRef.current = next;
    setPath(next);
    return next;
  }, [free]);

  // 칸 수만 상대에게 중계 (모양은 비밀)
  useEffect(() => { g.draft(path.length); }, [path.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p) => { pathRef.current = p; setPath(p); };

  return (
    <section className="screen play">
      <div className="status">
        <h2>문제를 그려주세요</h2>
        <Timer ms={remaining} />
      </div>
      <p className="hint">
        한 번에 이어서 그린 칸이 문제가 돼요 · <b className={path.length >= need ? 'ok' : ''}>{path.length}</b> / 최소 {need}칸
      </p>
      <Board rows={rows} cols={cols} path={path} mode="draw" step={step} />
      <div className="controls">
        <button className="btn ghost" disabled={!path.length} onClick={() => set(path.slice(0, -1))}>한 칸 취소</button>
        <button className="btn ghost" disabled={!path.length} onClick={() => set([])}>지우기</button>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
        시작점 알려주기 (쉬워짐)
      </label>
      <button className="btn primary" disabled={path.length < need} onClick={() => g.submitPuzzle(path, reveal)}>
        출제하기
      </button>
    </section>
  );
}

function WaitSetting({ g, opp }) {
  const { rows, cols } = g.room.settings;
  const remaining = useRemaining(g.room.deadline, g.serverNow);
  return (
    <section className="screen wait">
      <div className="status">
        <h2>{opp?.name}님이 문제를 만드는 중</h2>
        <Timer ms={remaining} />
      </div>
      <div className="draft-count"><b>{g.draftCount}</b>칸째 그리는 중…</div>
      <div className="mystery" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows * cols }, (_, i) => (
          <span key={i} className={i < g.draftCount ? 'lit' : ''} />
        ))}
      </div>
      <p className="hint">문제가 오면 바로 3초 카운트다운이 시작돼요</p>
    </section>
  );
}

// ───────── 카운트다운 / 풀이 / 관전 ─────────

function Countdown({ g }) {
  const remaining = useRemaining(g.room.deadline, g.serverNow);
  const n = Math.max(1, Math.ceil((remaining ?? 0) / 1000));
  const { puzzle } = g.room;
  const iSolve = g.room.solver === g.you;
  return (
    <section className="screen play">
      <div className="status"><h2>{iSolve ? '곧 시작해요!' : '상대가 곧 풀기 시작해요'}</h2></div>
      <div className="board-wrap">
        <Board rows={puzzle.rows} cols={puzzle.cols} cells={puzzle.cells} start={puzzle.start} path={[]} mode="view" dim />
        <div className="countdown" key={n}>{n}</div>
      </div>
    </section>
  );
}

function Solving({ g }) {
  const { puzzle } = g.room;
  const remaining = useRemaining(g.room.deadline, g.serverNow);
  const total = puzzle.cells.filter(Boolean).length;
  return (
    <section className="screen play">
      <div className="status">
        <h2>남은 칸 {total - g.path.length}</h2>
        <Timer ms={remaining} warn />
      </div>
      <p className="hint">
        {puzzle.start != null ? '표시된 칸에서 시작하세요' : '아무 칸에서나 시작할 수 있어요'} · 뒤로 가면 한 칸 취소
      </p>
      <Board
        rows={puzzle.rows} cols={puzzle.cols} cells={puzzle.cells} start={puzzle.start}
        path={g.path} mode="solve" step={g.solveStep}
      />
      <div className="controls">
        <button className="btn ghost" disabled={!g.path.length} onClick={g.resetSolve}>처음부터 {g.resets > 0 && `(${g.resets})`}</button>
        <button className="btn ghost danger" onClick={g.giveUp}>포기</button>
      </div>
    </section>
  );
}

function Spectating({ g, opp }) {
  const { puzzle } = g.room;
  const remaining = useRemaining(g.room.deadline, g.serverNow);
  const total = puzzle.cells.filter(Boolean).length;
  return (
    <section className="screen play">
      <div className="status">
        <h2><span className="live">LIVE</span> {opp?.name}님이 푸는 중</h2>
        <Timer ms={remaining} />
      </div>
      <p className="hint">{g.path.length} / {total}칸 · 리셋 {g.resets}회</p>
      <Board rows={puzzle.rows} cols={puzzle.cols} cells={puzzle.cells} start={puzzle.start} path={g.path} mode="view" />
      <div className="emotes">
        {EMOTES.map((e) => <button key={e} onClick={() => g.emote(e)}>{e}</button>)}
      </div>
    </section>
  );
}

// ───────── 결과 ─────────

const RESULT_TEXT = {
  solved: '풀었다!',
  timeout: '시간 초과',
  gaveup: '포기',
  no_puzzle: '출제 시간 초과',
};

function Result({ g, me, opp }) {
  const { room, you } = g;
  const r = room.result;
  const end = room.phase === 'MATCH_END';
  const iSolved = r?.solver === you;
  const solution = r?.solution;
  const replay = useReplay(solution);
  const myPts = r?.points?.[you] ?? 0;

  let headline;
  if (r.result === 'solved') headline = iSolved ? '성공! 🎉' : '상대가 풀었어요';
  else if (r.result === 'no_puzzle') headline = r.setter === you ? '출제 시간이 지났어요' : '상대가 출제를 못 했어요';
  else headline = iSolved ? '아쉬워요…' : '못 풀었어요! 😏';

  const winner = end && (me.score === opp?.score ? null : me.score > opp?.score ? me : opp);

  return (
    <section className="screen result">
      {end ? (
        <>
          <h1 className="final">{winner ? (winner.id === you ? '승리! 🏆' : '패배') : '무승부'}</h1>
          <p className="final-score">{me.score} : {opp?.score}</p>
        </>
      ) : (
        <h1>{headline}</h1>
      )}
      <p className="hint">
        {RESULT_TEXT[r.result]}
        {r.timeMs != null && r.result === 'solved' && ` · ${(r.timeMs / 1000).toFixed(1)}초`}
        {r.resets > 0 && ` · 리셋 ${r.resets}회`}
        {myPts !== 0 && <b className={myPts > 0 ? 'ok' : 'bad'}> · {myPts > 0 ? '+' : ''}{myPts}점</b>}
      </p>

      {solution && room.puzzle && (
        <div className="replay">
          <p className="label">출제자의 정답</p>
          <Board rows={room.puzzle.rows} cols={room.puzzle.cols} cells={room.puzzle.cells} path={replay} mode="view" />
        </div>
      )}

      <button className="btn primary" onClick={g.ready}>
        {me.ready ? '상대를 기다리는 중…' : end ? '다시 하기' : '다음 라운드'}
      </button>
      {opp?.ready && !me.ready && <p className="hint">{opp.name}님은 준비됐어요</p>}
      {end && <button className="btn text" onClick={g.leave}>나가기</button>}
    </section>
  );
}

/** 정답 경로를 한 칸씩 그려 보여준다 */
function useReplay(solution) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!solution) return;
    setN(0);
    const id = setInterval(() => setN((x) => (x >= solution.length ? x : x + 1)), 110);
    return () => clearInterval(id);
  }, [solution]);
  return solution ? solution.slice(0, n) : [];
}

function Timer({ ms, warn }) {
  if (ms == null) return null;
  const s = Math.ceil(ms / 1000);
  return <div className={`timer ${warn && s <= 10 ? 'hot' : ''}`}>{s}s</div>;
}
