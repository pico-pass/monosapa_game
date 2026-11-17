import type { AwardCategory, AwardPhase, VoteCategory } from '../rules.js';

/** 부문 하나의 상위 곡 한 줄 */
export class AwardRowDto {
  rank!: number;
  title!: string;
  artist!: string;
  /** 부문의 기준 값: 올해의 노래·신인상은 점수(합계 points), 롱런상·역주행상은 시간 수, 팬 투표상은 득표 수 */
  value!: number;
  /** 내 곡 */
  mine!: boolean;
  /** 이 순위의 보상(다이아). 중간 순위에서는 0 */
  reward!: number;
}

/** 집계 중·투표 중에 보여 주는 중간 순위: 부문마다 상위 곡과 내 곡 */
export class AwardStandingDto {
  category!: AwardCategory;
  top!: AwardRowDto[];
  /** 내 곡이 상위 밖에 있으면 그 줄(상위 안이면 top에 mine으로 들어 있어 null) */
  mine!: AwardRowDto | null;
}

export class AwardCandidateDto {
  key!: string;
  title!: string;
  artist!: string;
  /** 후보를 가릴 때의 누적 점수 */
  points!: number;
  mine!: boolean;
}

export class AwardBallotDto {
  category!: VoteCategory;
  candidates!: AwardCandidateDto[];
  /** 내가 투표한 곡 키. 아직이면 null */
  votedKey!: string | null;
}

export class AwardResultDto {
  category!: AwardCategory;
  rows!: AwardRowDto[];
}

export class AwardItemDto {
  id!: string;
  kind!: 'win' | 'vote';
  category!: AwardCategory;
  rank!: number | null;
  diamonds!: number;
  trophy!: string | null;
  claimed!: boolean;
}

/** GET /api/awards 응답. 단계(phase)에 따라 쓰는 칸이 다르다. */
export class AwardsDto {
  /** 해(`2026`) */
  period!: string;
  phase!: AwardPhase;
  now!: number;
  voteFrom!: number;
  announceAt!: number;
  claimUntil!: number;
  /** 신인상 기준: 첫 싱글이 이 시각 이후에 나온 계정 */
  rookieFrom!: number;
  /** 집계 중·투표 중: 부문마다 중간 순위 */
  standings!: AwardStandingDto[] | null;
  /** 투표 중: 팬 투표상 후보와 내 표 */
  ballot!: AwardBallotDto[] | null;
  /** 내가 지금 투표할 수 있나(투표 단계에서만 의미 있다) */
  canVote!: boolean;
  /** 투표할 수 없는 이유 문구(할 수 있으면 null) */
  voteBlocked!: string | null;
  /** 발표 뒤: 부문마다 시상대 */
  results!: AwardResultDto[] | null;
  /** 내가 받을 보상 전체(받았는지 포함)와 지금 받을 수 있는지 */
  items!: AwardItemDto[];
  canClaim!: boolean;
  /** 받은 보상으로 얻은 내 트로피 ID(게임 저장에서 빠졌다면 클라이언트가 다시 채운다) */
  trophies!: string[];
}

export class AwardVoteDto {
  category!: VoteCategory;
  key!: string;
}

export class AwardClaimDto {
  /** 이번에 받은 다이아 합계 */
  diamonds!: number;
  /** 이번에 받은 트로피 ID */
  trophies!: string[];
  /** 이번에 받은 보상 줄 */
  items!: { id: string; kind: 'win' | 'vote'; category: AwardCategory; rank: number | null; diamonds: number }[];
}
