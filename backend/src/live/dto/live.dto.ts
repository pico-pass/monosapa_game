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

/** POST /api/internal/live-record 요청. 소켓 서버(realtime)만 부른다: 판이 끝났을 때 끝까지 남은 사람마다 하나. */
export class LiveRecordBodyDto {
  uid!: string;
  game!: string;
  /** 같은 판의 기록을 두 번 쌓지 않게 하는 고유 값(방·사람) */
  ref!: string;
  rank!: number;
  players!: number;
  score!: number;
  correct!: number;
  rounds!: number;
  multi!: boolean;
}

export class LiveRecordGameDto {
  at!: number;
  rank!: number;
  players!: number;
  score!: number;
  correct!: number;
  rounds!: number;
  multi!: boolean;
}

/** 가사 빈칸 속도전 내 기록(소켓 프로토콜의 `LyricRecord`와 같은 모양) */
export class LiveRecordDto {
  games!: number;
  multiGames!: number;
  wins!: number;
  totalCorrect!: number;
  bestScore!: number;
  bestCorrect!: number;
  /** 최근 판(오래된 것부터) */
  recent!: LiveRecordGameDto[];
}

export class LiveRecordResultDto {
  record!: LiveRecordDto;
  /** 이 판으로 최고 기록을 새로 세웠는가(첫 판은 제외) */
  best!: { score: boolean; correct: boolean };
}

/** GET /api/live/records/me */
export class MyLiveRecordsDto {
  lyric!: LiveRecordDto;
}
