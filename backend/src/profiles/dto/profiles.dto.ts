import { PersonDto } from '../../users/person.js';
import type { Relation } from '../../friends/dto/friends.dto.js';
import type { Avatar } from '../../users/profile.js';

/** 다른 사람(또는 나)의 프로필 화면에 필요한 정보 */
export class ProfileDto extends PersonDto {
  /** 계정 레벨·팬·무한의 계단 최고 층·육성 레벨 (저장이 아직 없으면 처음 값) */
  level!: number;
  fans!: number;
  towerBest!: number;
  nurtureNormal!: number;
  nurtureDark!: number;
  /** 가입 시각(ms) */
  joinedAt!: number;
  /** 나와의 관계 */
  relation!: Relation;
  /** 친구라면 오늘 내가 선물을 보냈는가 */
  giftedToday!: boolean;
  /** 내 프로필일 때만 채워진다 */
  friendCode!: string | null;
}

/** GET·PUT /api/profiles/me 응답: 설정 화면에 쓰는 내 프로필 */
export class MyProfileDto {
  uid!: string;
  /** 구글 계정 이름 */
  googleName!: string | null;
  nickname!: string | null;
  bio!: string | null;
  avatar!: Avatar;
  picture!: string | null;
  /** 다른 사람에게 보이는 이름 */
  name!: string;
  friendCode!: string | null;
  /** 이용 제한이 풀리는 시각(ms), 제한 중이 아니면 null */
  mutedUntil!: number | null;
}

/** PUT /api/profiles/me 요청. 빠진 항목은 그대로 두고, nickname·bio 를 빈 글자로 보내면 지운다. */
export class UpdateProfileDto {
  nickname?: string | null;
  bio?: string | null;
  avatar?: Avatar;
}
