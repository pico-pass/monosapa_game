export class ChartEntryDto {
  rank!: number;
  /** 지난 시간 대비 순위 변화(양수가 상승). 지난 시간에 차트에 없었으면 null */
  change!: number | null;
  title!: string;
  artist!: string;
  persona!: 'normal' | 'dark';
  /** 내 곡 */
  mine!: boolean;
  /** 지난 시간 순위가 100위 밖이었다가 크게 오른 역주행 곡 */
  revival!: boolean;
}

export class ChartClaimStatusDto {
  /** 지금 보상을 받을 수 있다(10위 안에 내 곡이 있고 오늘 아직 안 받음) */
  available!: boolean;
  /** 내 곡 중 가장 높은 순위. 100위 밖이면 null */
  bestRank!: number | null;
  bestTitle!: string | null;
  diamonds!: number;
  /** 오늘 이미 받았다 */
  claimedToday!: boolean;
}

/** GET /api/chart 응답 */
export class ChartDto {
  /** 이 차트의 시간대(시각 ms, 정시) */
  hourAt!: number;
  entries!: ChartEntryDto[];
  claim!: ChartClaimStatusDto;
}

/** POST /api/chart/claim 응답. 클라이언트가 다이아와 카운터를 게임 저장에 반영한다. */
export class ChartClaimDto {
  rank!: number;
  title!: string;
  diamonds!: number;
  /** 1위였다 */
  no1!: boolean;
}
