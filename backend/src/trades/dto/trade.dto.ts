/** POST /api/trades 요청 */
export class PostTradeDto {
  give!: string;
  want!: string;
}

export class TradeDto {
  id!: string;
  give!: string;
  want!: string;
  /** open 열림 · taken 누가 가져감(내가 올린 것이면 수령 대기) */
  status!: 'open' | 'taken';
  owner!: string;
  mine!: boolean;
}

/** GET /api/trades 응답 */
export class TradesDto {
  /** 다른 사람이 올린 열린 교환 */
  open!: TradeDto[];
  /** 내가 올린 교환(열림·수령 대기) */
  mine!: TradeDto[];
}

/** 카드 한 장을 주고받는 응답. 클라이언트가 이 카드를 게임 저장에 더한다. */
export class TradeCardDto {
  card!: string;
}

/** 교환소에서 가져가기 응답: 내가 받을 카드(give)와 내가 내야 하는 카드(want) */
export class TradeAcceptDto {
  give!: string;
  want!: string;
}
