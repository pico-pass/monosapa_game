import type { Avatar } from '../../users/profile.js';

/** 랭킹 줄에 공통으로 들어가는 사람 정보. 이메일은 내려주지 않는다. */
export class RankingWhoDto {
  rank!: number;
  /** 프로필을 열 때 쓰는 계정 ID */
  uid!: string;
  /** 닉네임이 있으면 닉네임, 없으면 구글 계정 이름(없으면 '익명') */
  name!: string;
  /** 구글 프로필 사진 주소(없으면 null) */
  picture!: string | null;
  /** 프로필 사진 종류: 구글 사진 또는 일반·어둠 모노사파 */
  avatar!: Avatar;
  /** 마지막 접속이 몇 ms 전인지(모르면 null). 프로필의 접속 상태에 쓴다. */
  seenAgoMs!: number | null;
  me!: boolean;
}

export class RankingEntryDto extends RankingWhoDto {
  level!: number;
  fans!: number;
}

/** GET /api/ranking 응답. entries 는 상위 순위, mine 은 내 순위(저장이 없으면 null). */
export class RankingDto {
  entries!: RankingEntryDto[];
  mine!: RankingEntryDto | null;
  /** 랭킹에 오른 전체 계정 수 */
  total!: number;
}

export class TowerRankingEntryDto extends RankingWhoDto {
  /** 무한의 계단 역대 최고 클리어 층 */
  floor!: number;
  level!: number;
}

/** GET /api/ranking/tower 응답. 한 층이라도 깬 계정만 오른다. */
export class TowerRankingDto {
  entries!: TowerRankingEntryDto[];
  /** 내 순위(아직 한 층도 못 깼으면 null) */
  mine!: TowerRankingEntryDto | null;
  /** 랭킹에 오른 전체 계정 수 */
  total!: number;
}

export class NurtureRankingEntryDto extends RankingWhoDto {
  /** 일반·어둠 육성 레벨과 그 합계(순위 기준) */
  normal!: number;
  dark!: number;
  total!: number;
}

/** GET /api/ranking/nurture 응답. 육성을 한 번이라도 한 계정만 오른다. */
export class NurtureRankingDto {
  entries!: NurtureRankingEntryDto[];
  /** 내 순위(아직 육성하지 않았으면 null) */
  mine!: NurtureRankingEntryDto | null;
  /** 랭킹에 오른 전체 계정 수 */
  total!: number;
}

export class VillageRankingEntryDto extends RankingWhoDto {
  /** 마을 명성(건물 레벨 합계) */
  fame!: number;
  level!: number;
}

export class VillageRankingDto {
  entries!: VillageRankingEntryDto[];
  /** 내 순위(아직 건물이 없으면 null) */
  mine!: VillageRankingEntryDto | null;
  /** 랭킹에 오른 전체 계정 수 */
  total!: number;
}
