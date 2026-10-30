# AGENTS.md

모노사파 키우기 — 두 자아의 믹스테이프. npm workspaces 모노레포. `frontend/`는 React + TypeScript + Vite 웹게임(게임 규칙 전부), `backend/`는 NestJS + TypeScript 서버(상태 확인 `GET /api/health`, 구글 로그인 `/api/auth/*`, 공개 챗방 `/api/chat`, 문의함 `/api/inquiries`, 해시태그 챌린지 `/api/challenge`, 음원 차트 `/api/chart`, 카드 교환소 `/api/trades`, MongoDB에 계정·세션 저장). 게임 규칙은 서버에 없고(서버는 저장 JSON을 그대로 보관만 한다) 유저끼리 만나는 기능(챗·문의·챌린지·차트·교환소)만 서버 로직이 있다. 진행 데이터는 계정별로 MongoDB에 자동 저장되고, 계정 레벨 랭킹(`GET /api/ranking`)이 있다.

## 명령 (루트에서)

```bash
npm install
npm run dev           # frontend 개발 서버 (http://localhost:5173, /api 는 backend 3000 으로 프록시)
npm run dev:backend   # backend 개발 서버 (http://localhost:3000/api)
npm test              # frontend vitest (엔진·저장·미니게임 규칙)
npm run typecheck     # frontend + backend 타입체크
npm run build         # frontend + backend 빌드
npm run sim           # 성장 속도 시뮬레이션 (frontend/scripts/simulate.ts)
./deploy.sh            # 테스트·빌드 후 nginx 웹 루트 교체 + 필요하면 pm2 백엔드 재시작 + 검증 (--dry-run, rollback 지원)
```

## 구조 원칙 (backend)

- NestJS 권장 구조: 기능마다 `src/<기능>/` 폴더에 `*.module.ts`(모듈) · `*.controller.ts`(HTTP 입출력만) · `*.service.ts`(로직, `@Injectable`, 생성자 주입) · `dto/`(요청·응답 클래스)를 둔다. 컨트롤러에 로직을 넣지 않는다.
- `src/app.module.ts` 루트 모듈이 기능 모듈을 `imports`로 모은다. `src/config/app.config.ts`가 포트·접두사·CORS 설정을 담고 환경 변수는 여기서만 읽는다. `src/main.ts`는 부트스트랩만 한다.
- 기능 모듈: `health`(GET /api/health), `users`(Mongo `users` 스키마·서비스), `auth`(구글 ID 토큰 검증 → 세션 쿠키, `AdminGuard`). `saves`(계정당 게임 저장 `GET/PUT /api/saves/me`, 세션 가드 필요), `ranking`(저장의 `level`·`fans`로 상위 20명과 내 순위 `GET /api/ranking`, 무한의 계단 최고 층 `towerBest`로 `GET /api/ranking/tower`), `chat`(공개 챗방 `GET/POST /api/chat`, `DELETE /api/chat/:id`), `inquiries`(문의함 `POST /api/inquiries`, `GET /api/inquiries/mine`, 관리자 `GET /api/inquiries/admin`·`POST /api/inquiries/:id/reply`), `challenge`(주간 해시태그 챌린지: 한국 시간 월요일 기준 주 번호 `common/week.ts`, 주에 한 줄, 좋아요 토글·신고 3회 숨김·`POST /claim`이 지난주 보상을 한 번만 계산), `chart`(저장의 싱글 + NPC 곡으로 TOP100, 같은 시각이면 같은 결과인 시드 점수, 하루 한 번 순위 보상 `POST /api/chart/claim`), `trades`(포토카드 교환 에스크로: 상태 전이 open→taken→done/cancelled만 보증, 카드 ID 형태 `p{1-6}-{1-6}`는 프런트 `PHOTO_SETS`·`PHOTO_GRADES`와 맞춘다), `config`(전역 `AppConfig` 주입)·`database`(Mongoose 연결)는 공용 모듈이다. 서버가 계산한 보상(챌린지·차트)은 클라이언트가 `game/serverRewards.ts`로 저장에 반영한다. 사용자가 쓴 글은 `common/text.ts`(`cleanLine`·`cleanMultiline`)로 정리하고 정규식에 유니코드 이스케이프를 직접 쓰지 않는다(코드 포인트 범위 표를 쓴다). 스키마는 `*.schema.ts`(@nestjs/mongoose).
- 인증: 프런트가 구글 로그인 버튼(GSI)으로 받은 ID 토큰을 `POST /api/auth/google`로 보내면 서버가 `google-auth-library`로 검증(서명·만료·aud)하고 `users`를 upsert(구글 `sub`로 식별)한 뒤 `sessions`에 SHA-256 해시만 저장하고 HttpOnly·SameSite=Lax 쿠키(`monosapa_session`, 30일)를 내려준다. `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/auth/config`(공개 클라이언트 ID).
- 저장: `saves` 컬렉션에 계정당 문서 하나(`state` 원본 JSON, `version`, `lastWriter`, 시간당 하나의 `backup`). PUT은 `baseVersion`이 서버 버전과 다르면(다른 기기가 먼저 저장) 서버 저장을 담아 409로 거절하고, 같은 `writerId`의 재시도는 허용한다. 서버는 게임 규칙을 검증하지 않고 형태·크기(키에 `$`·`.` 금지, 1MB)만 본다.
- 랭킹: 저장할 때 서버가 `state.fans`에서 `fans`·`level`(= 1+floor(√(fans/20)), 프런트 `playerLevel`과 같은 식)을, `state.arcade.tower.best`에서 `towerBest`(무한의 계단 최고 층)를 뽑아 `saves`에 같이 저장하고 `{level, fans}`·`{towerBest}` 인덱스로 정렬한다. 새 랭킹 필드를 만들면 `rankFieldsOf`와 `RankingService.onModuleInit`의 채우기 조건도 같이 맞춘다. 이름·프로필 사진은 구글 계정 것을 그대로 보여 주고 이메일은 내려주지 않는다. 서버가 게임 규칙을 검증하지 않으므로 조작된 저장은 막지 못한다. `BALANCE.level.fansPerStep`을 바꾸면 `saves.service.ts`의 `FANS_PER_LEVEL_STEP`도 맞춘다.
- 환경 변수(`app.config.ts`에서만 읽는다): `MONGODB_URI`(기본 `mongodb://127.0.0.1:27017/monosapa`), `GOOGLE_CLIENT_ID`(비면 구글 로그인 꺼짐·프런트에 버튼 안 나옴), `SESSION_TTL_DAYS`, `PORT`, `ADMIN_EMAILS`(관리자 이메일, 쉼표 구분. `UserDto.isAdmin`이 이걸로 정해진다). MongoDB에 5초 안에 못 붙으면 서버가 시작 실패한다.

backend는 Nest CLI가 TypeScript 6 API를 쓰므로 backend 안에 typescript@6을 따로 둔다(frontend는 7). ESM 패키지라 상대 import에 `.js` 확장자를 붙인다.

## 구조 원칙 (frontend)

- `frontend/src/game/` — 게임 규칙. React·DOM에 의존하지 않는 순수 TypeScript. 테스트는 `frontend/src/game/__tests__/`.
  - `balance.ts` 모든 경제 수치(이 파일만 수정). 원안과 달라진 값은 주석과 README에 기록.
  - `simulation.ts` `advance(state, ms, ctx)` 순수 시간 전진. 온라인 틱·오프라인 정산이 같은 엔진을 쓴다.
  - `commands.ts` 발매·구매·전환·앨범·공연 명령. 이미 정산된 상태를 받아 조건 재검사 + 단일 상태 변경.
  - `minigame.ts`(마이크 타이밍) · `runner.ts`(모노사파런) 직접 공연 규칙. 공연장별 종류는 `balance.ts`의 `manualGameOf`.
  - `shop.ts`(간식·홍보 캠페인·테마) · `achievements.ts`(업적·칭호) · `missions.ts`(일일/주간 미션·출석) · `fanmail.ts`(팬 DM) · `monogram.ts`(가상 SNS) · `tracking.ts`(평생 누적 횟수 `counters`) · `alerts.ts`(더보기 알림 점). 콘텐츠 팩 2(설계 `docs/pack2-design.md`): `packdata.ts`(곡 카드 파생·포토 ID·마스코트 기분·**영구 보너스 합산 `bonuses`**, 다른 game 모듈을 가져오지 않는다) · `songcards.ts` · `photocards.ts` · `featuring.ts` · `mascot.ts` · `arcade.ts`(아케이드 공통: 시작 때 쿨다운 확정, 끝나면 등급·보상, 같은 실행 한 번만) · `rhythm.ts` · `survival.ts`(고정 시간 단계 시뮬레이션) · `lyricdeck.ts` · `tower.ts` · `ticketing.ts` · `wrapped.ts` · `pack-state.ts`+`parse.ts`(저장 검증 도우미). 영구 보너스는 `bonuses`로만 읽고(곱하는 쪽은 ×1이 기본), 새 보너스 갈래를 만들면 `selectors.ts`·`simulation.ts`의 적용 지점도 같이 본다. 모두 `commands.ts`와 같은 규칙: 이미 정산된 상태를 받아 조건 재검사 + 단일 상태 변경. 무작위는 씨앗과 번호로 정하는 시드 난수만 쓴다. 업적·미션 표의 수치는 `balance.ts`(`ACHIEVEMENTS`·`MISSIONS`), 문구는 `content.ts`.
  - `persistence.ts` 저장 검증·백업. (파일 내보내기·불러오기·초기화는 없다. 진행 데이터는 계정 DB로만 오간다.) 손상 저장은 자동으로 덮어쓰지 않는다.
- `frontend/src/store/gameStore.ts` — 엔진과 UI를 잇는 외부 스토어(tick, 저장, 말풍선, 모달 상태). 로그인 전에는 게임을 시작하지 않고, 로컬 저장 키는 계정 ID 접두사로 나뉜다.
- `frontend/src/platform/cloudSave.ts` — 계정 저장 동기화. 로컬(localStorage)에 먼저 저장하고 10초 간격으로(탭 숨김·닫힘은 즉시) 서버에 올린다. 시작할 때 서버 저장과 맞추고, 서버가 더 새로우면(버전 불일치) 서버 저장을 따른다.
- `frontend/src/screens/`, `frontend/src/components/` — UI. 규칙 계산은 `game/selectors.ts`를 통해서만.
- `frontend/src/assets/index.ts` — 이미지·효과음 교체 매니페스트. `frontend/src/audio/` — 합성 효과음.
- 화면 렌더 횟수로 재화를 더하지 않는다. 항상 실제 경과 시간을 엔진에 넣는다.
