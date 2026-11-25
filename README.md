# 한붓대결 (One-Stroke Duel)

휴대폰 두 대로 하는 실시간 한붓그리기 대결. 한 명이 경로를 그려 문제를 내면, 상대가 풀고, 출제자는 그 과정을 실시간으로 관전한다.
기획 문서: [docs/PRD.md](docs/PRD.md)

## 구조

```
apps/web       Next.js 클라이언트  → Vercel
apps/server    Node.js + ws 게임 서버 (권위 서버) → Railway
packages/shared  규칙(검증·판정·점수) + 메시지 프로토콜 (web/server 공용)
```

## 로컬 실행

```bash
npm install
npm run dev        # 게임 서버 :8787 + 웹 :3000 동시 실행
```

- 브라우저 탭 두 개로 http://localhost:3000 을 열고 한쪽에서 방 만들기 → 다른 쪽에서 코드로 입장
- **실제 휴대폰 두 대**: 같은 Wi-Fi에서 `http://<내 PC IP>:3000` 접속 (웹이 자동으로 `ws://<같은 IP>:8787` 에 연결)

## 테스트

```bash
npm test           # 규칙 단위 테스트 + 두 클라이언트 서버 통합 테스트
```

## 배포

### 게임 서버 → Railway
- 저장소 연결, Root Directory는 **비워둠** (워크스페이스 설치를 위해 저장소 루트 기준)
- Start Command: `npm start -w apps/server`
- 환경변수: `ALLOWED_ORIGINS=https://<vercel 도메인>` (쉼표로 여러 개)
- Railway가 주는 도메인을 확인 (예: `xxx.up.railway.app`) → 헬스체크 `/health`

### 웹 → Vercel
- Root Directory: `apps/web` (프레임워크: Next.js)
- 환경변수: `NEXT_PUBLIC_GAME_SERVER_URL=wss://xxx.up.railway.app`

### Supabase (M4 예정)
매치 결과 저장용. PRD 3.2 참고.
