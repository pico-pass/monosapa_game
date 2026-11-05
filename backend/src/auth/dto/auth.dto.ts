import type { Avatar } from '../../users/profile.js';

/** POST /api/auth/google 요청. 구글 로그인 버튼이 돌려준 ID 토큰(JWT)이다. */
export class GoogleLoginDto {
  credential!: string;
}

export class UserDto {
  id!: string;
  email!: string | null;
  /** 구글 계정 이름 */
  name!: string | null;
  picture!: string | null;
  /** 프로필 설정 */
  nickname!: string | null;
  bio!: string | null;
  avatar!: Avatar;
  /** 다른 사람에게 보이는 이름: 닉네임이 있으면 닉네임, 없으면 구글 이름 */
  displayName!: string;
  /** 친구 코드(아직 없으면 null) */
  friendCode!: string | null;
  /** 이용 제한(관리자 제재)이 풀리는 시각(ms). 제한 중이 아니면 null. */
  mutedUntil!: number | null;
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
