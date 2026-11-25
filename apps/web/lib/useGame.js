'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { C2S, S2C } from '@duel/shared/protocol';
import { applyMove } from '@duel/shared/rules';
import { GameClient } from './net';

/**
 * 게임 상태 훅. 서버 메시지를 React 상태로 바꾸고,
 * 풀이 입력은 클라이언트 예측(즉시 반영) + 서버 교정 방식으로 처리한다.
 */
export function useGame() {
  const clientRef = useRef(null);
  const [conn, setConn] = useState({ status: 'idle', rtt: null });
  const [you, setYou] = useState(null);
  const [room, setRoom] = useState(null);       // 서버 state 메시지
  const [path, setPath] = useState([]);         // 화면에 그릴 풀이 경로 (도전자는 예측 포함)
  const [resets, setResets] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [error, setError] = useState(null);
  const [emotes, setEmotes] = useState([]);     // { id, e, mine }

  const pathRef = useRef([]);
  const seqRef = useRef(0);                     // 내가 보낸 마지막 move/reset 번호
  const roomRef = useRef(null);

  const updatePath = (p) => { pathRef.current = p; setPath(p); };

  useEffect(() => {
    const client = new GameClient({
      onStatus: (status, rtt) => setConn({ status, rtt }),
      onMessage: (msg) => {
        switch (msg.t) {
          case S2C.ROOM:
            setYou(msg.you);
            break;
          case S2C.STATE: {
            const prev = roomRef.current;
            roomRef.current = msg;
            setRoom(msg);
            // 새 풀이가 시작되면 경로 초기화
            if (msg.phase === 'COUNTDOWN' || msg.phase === 'SETTING' || msg.phase === 'LOBBY') {
              if (prev?.phase !== msg.phase) { updatePath([]); setResets(0); seqRef.current = 0; }
            }
            if (msg.phase === 'SETTING' && prev?.phase !== 'SETTING') setDraftCount(0);
            break;
          }
          case S2C.PATH:
            // 내 입력이 아직 서버에 다 반영되지 않았으면(예측 중) 무시, 따라잡았으면 서버 값으로 확정
            if (msg.seq >= seqRef.current) updatePath(msg.path);
            setResets(msg.resets);
            break;
          case S2C.DRAFT:
            setDraftCount(msg.count);
            break;
          case S2C.EMOTE:
            pushEmote(msg.e, false);
            break;
          case S2C.ERROR:
            if (msg.code === 'NO_SESSION') { setRoom(null); roomRef.current = null; break; }
            setError({ ...msg, at: Date.now() });
            break;
        }
      },
    });
    clientRef.current = client;
    // 탭에 이전 게임 토큰이 있으면 바로 재접속
    if (client.token) client.connect();
    return () => client.destroy();
  }, []);

  const pushEmote = (e, mine) => {
    const id = Math.random().toString(36).slice(2);
    setEmotes((list) => [...list, { id, e, mine }]);
    setTimeout(() => setEmotes((list) => list.filter((x) => x.id !== id)), 2200);
  };

  const send = useCallback((msg) => clientRef.current?.send(msg), []);

  /** 도전자 한 칸 이동: 로컬 규칙으로 먼저 적용하고 서버에 보낸다 */
  const solveStep = useCallback((cell) => {
    const r = roomRef.current;
    if (!r?.puzzle) return null;
    const next = applyMove(pathRef.current, cell, r.puzzle);
    if (!next) return null;
    updatePath(next);
    send({ t: C2S.MOVE, cell, seq: ++seqRef.current });
    return next;
  }, [send]);

  const serverNow = useCallback(() => clientRef.current?.serverNow() ?? Date.now(), []);

  const resetSolve = useCallback(() => {
    updatePath([]);
    send({ t: C2S.RESET, seq: ++seqRef.current });
  }, [send]);

  return {
    conn, you, room, path, resets, draftCount, error, emotes,
    serverNow,
    createRoom: (name, settings) => send({ t: C2S.CREATE_ROOM, name, settings }),
    joinRoom: (code, name) => send({ t: C2S.JOIN_ROOM, code, name }),
    ready: () => send({ t: C2S.READY }),
    draft: (count) => send({ t: C2S.DRAFT, count }),
    submitPuzzle: (p, revealStart) => send({ t: C2S.SUBMIT_PUZZLE, path: p, revealStart }),
    solveStep,
    resetSolve,
    giveUp: () => send({ t: C2S.GIVE_UP }),
    emote: (e) => { pushEmote(e, true); send({ t: C2S.EMOTE, e }); },
    leave: () => {
      clientRef.current?.leave();
      setRoom(null); roomRef.current = null; setYou(null);
    },
    clearError: () => setError(null),
  };
}

/** deadline 까지 남은 ms 를 100ms 마다 갱신 */
export function useRemaining(deadline, serverNow) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(id);
  }, [deadline, serverNow]);
  return deadline ? Math.max(0, deadline - now) : null;
}
