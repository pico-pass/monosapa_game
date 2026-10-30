export class RankingEntryDto {
  rank!: number;
  /** 구글 계정 이름(없으면 '익명'). 이메일은 내려주지 않는다. */
  name!: string;
  /** 구글 프로필 사진 주소(없으면 null) */
  picture!: string | null;
  level!: number;
  fans!: number;
  me!: boolean;
}

/** GET /api/ranking 응답. entries 는 상위 순위, mine 은 내 순위(저장이 없으면 null). */
export class RankingDto {
  entries!: RankingEntryDto[];
  mine!: RankingEntryDto | null;
  /** 랭킹에 오른 전체 계정 수 */
  total!: number;
}

export class TowerRankingEntryDto {
  rank!: number;
  /** 구글 계정 이름(없으면 '익명'). 이메일은 내려주지 않는다. */
  name!: string;
  picture!: string | null;
  /** 무한의 계단 역대 최고 클리어 층 */
  floor!: number;
  level!: number;
  me!: boolean;
}

/** GET /api/ranking/tower 응답. 한 층이라도 깬 계정만 오른다. */
export class TowerRankingDto {
  entries!: TowerRankingEntryDto[];
  /** 내 순위(아직 한 층도 못 깼으면 null) */
  mine!: TowerRankingEntryDto | null;
  /** 랭킹에 오른 전체 계정 수 */
  total!: number;
}
