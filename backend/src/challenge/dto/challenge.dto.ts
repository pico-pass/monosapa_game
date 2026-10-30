/** POST /api/challenge 요청 */
export class PostChallengeDto {
  text!: string;
}

export class ChallengeEntryDto {
  id!: string;
  rank!: number;
  name!: string;
  picture!: string | null;
  text!: string;
  likes!: number;
  /** 내가 좋아요를 눌렀다 */
  liked!: boolean;
  mine!: boolean;
  /** 내가 지울 수 있는 글(내 것이거나 내가 관리자) */
  canDelete!: boolean;
}

/** 지난주 결과. reward가 있으면 아직 받지 않은 보상(다이아)이다. */
export class ChallengeLastDto {
  week!: number;
  theme!: string;
  myRank!: number | null;
  myLikes!: number;
  reward!: number | null;
  claimed!: boolean;
  top!: ChallengeEntryDto[];
}

export class ChallengeHallDto {
  week!: number;
  theme!: string;
  name!: string;
  text!: string;
  likes!: number;
}

/** GET /api/challenge 응답 */
export class ChallengeDto {
  week!: number;
  theme!: string;
  /** 이번 주가 끝나는 시각(ms) */
  endsAt!: number;
  entries!: ChallengeEntryDto[];
  /** 순위권 밖이라 목록에 없는 내 글 */
  mine!: ChallengeEntryDto | null;
  last!: ChallengeLastDto | null;
  hall!: ChallengeHallDto[];
}

export class ChallengeLikeDto {
  likes!: number;
  liked!: boolean;
}

/** POST /api/challenge/claim 응답. 클라이언트가 이 다이아와 문구를 게임 저장에 반영한다. */
export class ChallengeClaimDto {
  week!: number;
  rank!: number;
  diamonds!: number;
  text!: string;
}
