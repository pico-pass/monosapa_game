/*
 * 라이브 미니게임 소켓 프로토콜. 서버(realtime)와 프런트가 같은 파일의 타입을 쓴다(프런트는 `import type`만 한다).
 * 메시지는 JSON 텍스트 한 덩어리이고 `t`가 종류다. 가사 빈칸 속도전은 `l.`, 팬덤 모으기는 `f.`로 시작한다.
 */

export type LiveGame = 'lyric' | 'fandom';
export const LIVE_GAMES: readonly LiveGame[] = ['lyric', 'fandom'];

/** 답 한 번의 최대 글자 수(이보다 길면 버린다) */
export const ANSWER_MAX = 60;

/** 클라이언트 → 서버 */
export type ClientMsg =
  | { t: 'join'; game: LiveGame }
  | { t: 'leave' }
  /** 가사 빈칸 속도전: 빈칸 답 */
  | { t: 'ans'; text: string }
  /** 팬덤 모으기: 가고 싶은 방향(라디안)과 부스트 여부 */
  | { t: 'steer'; a: number; b?: 0 | 1 };

export type ErrCode = 'bad' | 'rate' | 'busy' | 'full';

export interface PlayerRow {
  uid: string;
  name: string;
}

export interface BoardRow extends PlayerRow {
  score: number;
  /** 이번 라운드에 얻은 점수 */
  gain: number;
}

export interface EndRow extends PlayerRow {
  score: number;
  rank: number;
  /** 서버가 정한 순위 보상(다이아). 하루 한도는 우편을 보낼 때 적용되고 결과는 `reward` 메시지로 따로 온다. */
  reward: number;
}

export interface FandomRosterRow {
  id: number;
  name: string;
  bot: boolean;
}

/** 팬덤 모으기 스냅샷. 좌표는 모두 10배 한 정수다(0.1칸 단위). */
export interface FandomSnapshot {
  t: 'f.s';
  /** 남은 시간(ms) */
  left: number;
  /** 내 몸 */
  me: { x: number; y: number; fans: number; boost: 0 | 1; shield: 0 | 1 };
  /** 보이는 뱀: [id, 팬 수, 방패(0|1), x0, y0, x1, y1, …] (머리가 먼저) */
  sn: number[][];
  /** 보이는 팬 점: [x, y, 값, x, y, 값, …] */
  dots: number[];
  /** 상위 5명: [id, 팬 수] */
  lb: [number, number][];
  /** 내 순위(1부터)와 살아 있는 뱀 수 */
  rk: [number, number];
}

export type ServerMsg =
  | { t: 'hello'; uid: string; name: string }
  | { t: 'err'; code: ErrCode }
  /** 서버가 게임에서 내보냈다(방이 닫혔다 등) */
  | { t: 'left' }
  /** 보상 우편이 나갔다. diamonds가 0이면 하루 한도에 걸렸거나 보상이 꺼져 있다. */
  | { t: 'reward'; diamonds: number; capped: boolean }
  | { t: 'l.lobby'; players: PlayerRow[]; startsInMs: number; solo: boolean }
  /** round 는 지금까지 낸 문제 수(문제 수에 끝이 없다) */
  | { t: 'l.q'; round: number; before: string; after: string; len: number; endsInMs: number }
  | { t: 'l.hint'; first: string }
  | { t: 'l.ok'; uid: string; name: string; gain: number; place: number }
  | { t: 'l.me'; ok: boolean; gain: number }
  /** last 가 참이면 아무도 못 맞힌 문제라 이 공개 뒤에 게임이 끝난다 */
  | { t: 'l.reveal'; line: string; answer: string; board: BoardRow[]; nextInMs: number; last: boolean }
  /** rounds 는 이어진 문제 수 */
  | { t: 'l.end'; rows: EndRow[]; rewarded: boolean; rounds: number }
  | { t: 'f.go'; id: number; w: number; h: number; runMs: number }
  | { t: 'f.roster'; list: FandomRosterRow[] }
  | FandomSnapshot
  | { t: 'f.over'; why: 'dead' | 'time' | 'left'; fans: number; peak: number; kills: number; by: string | null; reward: number };

/** 받은 문자열을 클라이언트 메시지로 읽는다. 모양이 이상하면 null. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case 'join':
      return m.game === 'lyric' || m.game === 'fandom' ? { t: 'join', game: m.game } : null;
    case 'leave':
      return { t: 'leave' };
    case 'ans':
      return typeof m.text === 'string' && m.text.length <= ANSWER_MAX ? { t: 'ans', text: m.text } : null;
    case 'steer':
      return typeof m.a === 'number' && Number.isFinite(m.a) ? { t: 'steer', a: m.a, b: m.b === 1 ? 1 : 0 } : null;
    default:
      return null;
  }
}
