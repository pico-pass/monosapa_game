import type { Avatar } from '../../users/profile.js';
import type { TileDto } from '../rules.js';

/** GET /api/village/:uid 응답: 친구(또는 나)의 마을. ❤️ 같은 재화는 내려주지 않는다. */
export class VillageViewDto {
  uid!: string;
  name!: string;
  picture!: string | null;
  avatar!: Avatar;
  /** 열린 땅의 한 변 */
  side!: number;
  /** 건물 레벨 합계 */
  fame!: number;
  /** 64칸. 빈 칸은 null */
  tiles!: (TileDto | null)[];
  /** 오늘 내가 이 마을에 깃발을 꽂았다 */
  flaggedToday!: boolean;
}

/** POST /api/village/:uid/flag 응답: 내가 받는 ❤️ (클라이언트가 게임 저장에 반영한다) */
export class FlagSentDto {
  hearts!: number;
}

/** GET /api/village/flags 응답 */
export class FlagPendingDto {
  pending!: number;
}

/** POST /api/village/flags/claim 응답 */
export class FlagClaimDto {
  count!: number;
  hearts!: number;
}
