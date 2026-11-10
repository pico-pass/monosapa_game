/** POST /api/internal/live-reward 요청. 소켓 서버(realtime)만 부른다. */
export class LiveRewardBodyDto {
  /** 받을 사람의 계정 ID */
  uid!: string;
  game!: string;
  diamonds!: number;
  /** 같은 보상의 중복 지급을 막는 고유 값 */
  ref!: string;
  /** 우편 제목에 들어갈 말 */
  label!: string;
}

export class LiveRewardResultDto {
  /** 실제로 우편에 붙인 다이아(하루 한도 적용, 한도가 찼으면 0) */
  granted!: number;
  /** 요청한 양보다 적게 나갔다(하루 한도) */
  capped!: boolean;
}
