/** 서버 실행 설정. 환경 변수는 이 파일에서만 읽는다. */
export class AppConfig {
  /** 모든 라우트 앞에 붙는 접두사 */
  readonly globalPrefix = 'api';

  readonly port: number = Number(process.env.PORT ?? 3000);

  /** 개발 중 프런트엔드(Vite)가 직접 호출해도 되도록 로컬 오리진만 허용한다. */
  readonly corsOrigins: readonly RegExp[] = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
}
