import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// backend/.env 가 있으면 읽는다(이미 설정된 환경 변수가 우선). dist/config 에서도 src/config 에서도 ../../.env 는 backend/.env 다.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** 서버 실행 설정. 환경 변수는 이 파일에서만 읽는다. */
export class AppConfig {
  /** 모든 라우트 앞에 붙는 접두사 */
  readonly globalPrefix = 'api';

  readonly port: number = Number(process.env.PORT ?? 3000);

  /** 개발 중 프런트엔드(Vite)가 직접 호출해도 되도록 로컬 오리진만 허용한다. */
  readonly corsOrigins: readonly RegExp[] = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

  /** MongoDB 접속 문자열. 계정과 로그인 세션이 여기에 저장된다. */
  readonly mongoUri: string = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/monosapa';

  /** 구글 OAuth 웹 클라이언트 ID. 비어 있으면 구글 로그인은 꺼진 상태로 동작한다. (공개 값이라 프런트에도 내려준다) */
  readonly googleClientId: string = (process.env.GOOGLE_CLIENT_ID ?? '').trim();

  /** 로그인 세션 유지 기간(일) */
  readonly sessionTtlDays: number = Number(process.env.SESSION_TTL_DAYS ?? 30);

  readonly sessionCookieName = 'monosapa_session';

  /** 관리자 이메일(쉼표로 구분, 구글에서 확인된 이메일만 비교). 문의 답변과 챗방 메시지 삭제를 할 수 있다. 비어 있으면 관리자가 없다. */
  readonly adminEmails: readonly string[] = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
