import { PersonDto } from '../../users/person.js';

export class FriendDto extends PersonDto {
  /** 계정 레벨 */
  level!: number;
  /** 오늘 내가 이 친구에게 선물을 보냈는가 */
  giftedToday!: boolean;
  /** 오늘 이 친구가 나에게 선물을 보냈는가 */
  giftedMeToday!: boolean;
  /** 이 친구가 보낸, 내가 아직 안 읽은 메시지 수 */
  unread!: number;
  /** 마지막 메시지(없으면 null) */
  last!: { text: string; at: number; mine: boolean } | null;
}

/** GET /api/friends 응답 */
export class FriendsDto {
  friends!: FriendDto[];
  /** 나에게 온 요청 */
  incoming!: PersonDto[];
  /** 내가 보낸 요청 */
  outgoing!: PersonDto[];
  /** 친구 수 상한 */
  limit!: number;
  /** 선물 한 번에 가는 다이아 */
  giftDiamonds!: number;
}

export class RequestFriendDto {
  uid!: string;
}

export class RequestResultDto {
  /** requested: 요청을 보냈다 · accepted: 상대가 먼저 보낸 요청이 있어 바로 친구가 됐다 */
  status!: 'requested' | 'accepted';
}

export class GiftResultDto {
  diamonds!: number;
}

/** 프로필에 붙는, 나와 그 사람의 관계 */
export type Relation = 'self' | 'none' | 'friend' | 'outgoing' | 'incoming';
