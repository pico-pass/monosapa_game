export type ChartPersona = 'normal' | 'dark';

export class ChartEntryDto {
  rank!: number;
  /** 지난 시간 대비 순위 변화(양수가 상승). 지난 시간에 차트에 없었으면 null */
  change!: number | null;
  title!: string;
  artist!: string;
  /** 내 곡 */
  mine!: boolean;
  /** 이 시간에 역주행 중이거나 지난 시간보다 30계단 넘게 오른 곡 */
  revival!: boolean;
}

/** 한 속성의 곡 목록. total은 그 속성으로 발매된 곡 전체 수이고, entries는 순위 순서(너무 길면 앞쪽만)다. */
export class ChartListDto {
  total!: number;
  entries!: ChartEntryDto[];
}

export class ChartClaimStatusDto {
  /** 지금 보상을 받을 수 있다(10위 안에 내 곡이 있고 오늘 아직 안 받음) */
  available!: boolean;
  /** 내 곡 중 가장 높은 순위(두 목록을 통틀어). 없으면 null */
  bestRank!: number | null;
  bestPersona!: ChartPersona | null;
  bestTitle!: string | null;
  diamonds!: number;
  /** 오늘 이미 받았다 */
  claimedToday!: boolean;
}

/** GET /api/chart 응답: 일반속성 곡 전체와 어둠속성 곡 전체가 각각 순위를 겨룬다. */
export class ChartDto {
  /** 이 차트의 시간대(시각 ms, 정시) */
  hourAt!: number;
  normal!: ChartListDto;
  dark!: ChartListDto;
  claim!: ChartClaimStatusDto;
}

/** POST /api/chart/claim 응답. 클라이언트가 다이아와 카운터를 게임 저장에 반영한다. */
export class ChartClaimDto {
  rank!: number;
  persona!: ChartPersona;
  title!: string;
  diamonds!: number;
  /** 1위였다 */
  no1!: boolean;
}
