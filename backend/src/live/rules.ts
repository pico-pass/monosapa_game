/*
 * 라이브 미니게임(별도 소켓 서버 `realtime/`) 보상 규칙(순수).
 * 보상량은 소켓 서버가 정하고, 이 서버는 하루 한도와 같은 보상의 중복 지급만 책임진다.
 */

export const LIVE_GAMES = ['lyric', 'fandom'] as const;
export type LiveGame = (typeof LIVE_GAMES)[number];

/** 한국 시간 하루 동안 라이브 보상으로 받을 수 있는 다이아의 합계 */
export const LIVE_DAILY_CAP = 15;

/** 보상 요청 한 번의 상한(이상한 요청이 한도를 한꺼번에 채우지 못하게 한다) */
export const LIVE_MAX_REWARD = 10;

/** 보상 요청의 고유 값(방·사람)의 최대 길이 */
export const LIVE_REF_MAX = 80;

/** 우편 제목에 들어갈 말(게임 이름·순위)의 최대 길이 */
export const LIVE_LABEL_MAX = 20;

export const isLiveGame = (v: unknown): v is LiveGame => typeof v === 'string' && (LIVE_GAMES as readonly string[]).includes(v);

/** 오늘 이미 before 만큼 받았을 때, want 중 실제로 내줄 양 */
export function grantedOf(before: number, want: number, cap = LIVE_DAILY_CAP): number {
  return Math.max(0, Math.min(want, cap - before));
}

/** 우편 제목: 「라이브 보상 · 가사 빈칸 속도전 1위」 */
export const liveMailTitle = (label: string): string => `라이브 보상 · ${label}`;
