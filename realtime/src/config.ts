import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// realtime/.env 가 있으면 읽는다(이미 설정된 환경 변수가 우선). dist 에서도 src 에서도 ../.env 는 realtime/.env 다.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** 소켓 서버 실행 설정. 환경 변수는 이 파일에서만 읽는다. */
export const config = {
  /** nginx 가 /rt 를 넘겨 주는 포트. 바깥에 열지 않도록 127.0.0.1 에만 묶는다. */
  port: Number(process.env.REALTIME_PORT ?? 3001),
  host: process.env.REALTIME_HOST ?? '127.0.0.1',
  /** 웹소켓을 여는 경로 */
  path: '/rt',
  /** 로그인 확인: 브라우저가 보낸 쿠키를 메인 서버에 그대로 넘겨 누구인지 묻는다. */
  authUrl: process.env.REALTIME_AUTH_URL ?? 'http://127.0.0.1:3000/api/auth/me',
  /** 보상 우편을 보내는 메인 서버의 내부 주소. 비밀 값이 없으면 보상은 꺼진다. */
  rewardUrl: process.env.REALTIME_REWARD_URL ?? 'http://127.0.0.1:3000/api/internal/live-reward',
  /** 가사 빈칸 속도전 판 기록을 쌓는 메인 서버의 내부 주소(같은 비밀 값을 쓴다) */
  recordUrl: process.env.REALTIME_RECORD_URL ?? 'http://127.0.0.1:3000/api/internal/live-record',
  secret: (process.env.REALTIME_SECRET ?? '').trim(),
  /** 동시 접속 상한 */
  maxConns: Number(process.env.REALTIME_MAX_CONNS ?? 400),
};
