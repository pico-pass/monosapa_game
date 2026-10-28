# AGENTS.md

모노사파 키우기 — 두 자아의 믹스테이프. npm workspaces 모노레포. `frontend/`는 React + TypeScript + Vite 웹게임(게임 규칙 전부), `backend/`는 NestJS + TypeScript 서버 골격(상태 확인 API `GET /api/health`만). 게임 저장·규칙은 아직 서버에 없고 회원가입·DB·랭킹도 없다.

## 명령 (루트에서)

```bash
npm install
npm run dev           # frontend 개발 서버 (http://localhost:5173, /api 는 backend 3000 으로 프록시)
npm run dev:backend   # backend 개발 서버 (http://localhost:3000/api)
npm test              # frontend vitest (엔진·저장·미니게임 규칙)
npm run typecheck     # frontend + backend 타입체크
npm run build         # frontend + backend 빌드
npm run sim           # 성장 속도 시뮬레이션 (frontend/scripts/simulate.ts)
```

## 구조 원칙 (backend)

- NestJS 권장 구조: 기능마다 `src/<기능>/` 폴더에 `*.module.ts`(모듈) · `*.controller.ts`(HTTP 입출력만) · `*.service.ts`(로직, `@Injectable`, 생성자 주입) · `dto/`(요청·응답 클래스)를 둔다. 컨트롤러에 로직을 넣지 않는다.
- `src/app.module.ts` 루트 모듈이 기능 모듈을 `imports`로 모은다. `src/config/app.config.ts`가 포트·접두사·CORS 설정을 담고 환경 변수는 여기서만 읽는다. `src/main.ts`는 부트스트랩만 한다.
- 현재 기능 모듈은 `health`(GET /api/health) 하나다.

backend는 Nest CLI가 TypeScript 6 API를 쓰므로 backend 안에 typescript@6을 따로 둔다(frontend는 7). ESM 패키지라 상대 import에 `.js` 확장자를 붙인다.

## 구조 원칙 (frontend)

- `frontend/src/game/` — 게임 규칙. React·DOM에 의존하지 않는 순수 TypeScript. 테스트는 `frontend/src/game/__tests__/`.
  - `balance.ts` 모든 경제 수치(이 파일만 수정). 원안과 달라진 값은 주석과 README에 기록.
  - `simulation.ts` `advance(state, ms, ctx)` 순수 시간 전진. 온라인 틱·오프라인 정산이 같은 엔진을 쓴다.
  - `commands.ts` 발매·구매·전환·앨범·공연 명령. 이미 정산된 상태를 받아 조건 재검사 + 단일 상태 변경.
  - `minigame.ts`(마이크 타이밍) · `runner.ts`(모노사파런) 직접 공연 규칙. 공연장별 종류는 `balance.ts`의 `manualGameOf`.
  - `persistence.ts` 저장 검증·백업·가져오기. 손상 저장은 자동으로 덮어쓰지 않는다.
- `frontend/src/store/gameStore.ts` — 엔진과 UI를 잇는 외부 스토어(tick, 저장, 말풍선, 모달 상태).
- `frontend/src/screens/`, `frontend/src/components/` — UI. 규칙 계산은 `game/selectors.ts`를 통해서만.
- `frontend/src/assets/index.ts` — 이미지·효과음 교체 매니페스트. `frontend/src/audio/` — 합성 효과음.
- 화면 렌더 횟수로 재화를 더하지 않는다. 항상 실제 경과 시간을 엔진에 넣는다.
