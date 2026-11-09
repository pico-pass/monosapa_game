import type { Avatar } from '../../users/profile.js';
import type { BossKind } from '../roster.js';

/** POST /api/boss/hit 요청: 끝난 판의 종류·점수(0~1000)·판 ID */
export class BossHitBodyDto {
  kind!: string;
  score!: number;
  runId!: string;
}

export class BossInfoDto {
  id!: string;
  name!: string;
  icon!: string;
  line!: string;
  weak!: BossKind;
}

/** POST /api/boss/hit 응답. counted가 false면 reason이 이유다(중복·간격·하루 상한·데미지 0). */
export class BossHitResultDto {
  counted!: boolean;
  damage!: number;
  weak!: boolean;
  crit!: boolean;
  bossName!: string;
  reason!: 'duplicate' | 'too_fast' | 'daily_cap' | 'no_damage' | null;
  total!: number;
  target!: number;
  tier!: number;
}

export class BossContributorDto {
  rank!: number;
  uid!: string;
  name!: string;
  picture!: string | null;
  avatar!: Avatar;
  damage!: number;
  me!: boolean;
}

export class BossFeedDto {
  name!: string;
  kind!: BossKind;
  damage!: number;
  at!: number;
}

export class BossLastDto {
  boss!: BossInfoDto;
  target!: number;
  total!: number;
  cleared!: boolean;
  myDamage!: number;
  myRank!: number | null;
  /** 받을 수 있는 순위 보상(다이아). 없거나 이미 받았으면 null */
  reward!: number | null;
  claimed!: boolean;
}

/** GET /api/boss 응답 */
export class BossDto {
  week!: number;
  /** 이번 주가 끝나는 시각(ms) */
  endsAt!: number;
  boss!: BossInfoDto;
  target!: number;
  total!: number;
  tier!: number;
  tierRewards!: number[];
  claimedTiers!: number;
  /** 지금 받을 수 있는 단계 보상 합(다이아) */
  claimable!: number;
  myDamage!: number;
  myHits!: number;
  todayHits!: number;
  dailyCap!: number;
  players!: number;
  top!: BossContributorDto[];
  /** 10위 밖이라 목록에 없는 내 기록 */
  mine!: BossContributorDto | null;
  feed!: BossFeedDto[];
  last!: BossLastDto | null;
}

/** POST /api/boss/claim·claim-last 응답. 클라이언트가 이 다이아를 게임 저장에 반영한다. */
export class BossClaimDto {
  diamonds!: number;
  label!: string;
}
