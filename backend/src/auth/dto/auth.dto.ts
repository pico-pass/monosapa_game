/** POST /api/auth/google 요청. 구글 로그인 버튼이 돌려준 ID 토큰(JWT)이다. */
export class GoogleLoginDto {
  credential!: string;
}

export class UserDto {
  id!: string;
  email!: string | null;
  name!: string | null;
  picture!: string | null;
  /** 관리자 이메일 목록(ADMIN_EMAILS)에 든 계정이면 true */
  isAdmin!: boolean;
}

/** GET /api/auth/config 응답. 클라이언트 ID가 비어 있으면 로그인 버튼을 보여주지 않는다. */
export class AuthConfigDto {
  googleClientId!: string;
}

export class MeDto {
  user!: UserDto | null;
}
