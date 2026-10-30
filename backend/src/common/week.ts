/*
 * 한국 시간(UTC+9) 기준 날짜·주 계산. 주는 월요일 0시에 시작한다.
 * 1970-01-01(목)에서 월요일까지는 4일이라, (시각 + 9시간 − 4일) / 7일 의 몫이 곧 주 번호다.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const KST = 9 * HOUR;

/** 시각이 속한 주 번호 (월요일 0시 KST에 1 늘어난다) */
export const weekOf = (ms: number): number => Math.floor((ms + KST - 4 * DAY) / WEEK);

/** 주 번호가 시작되는 시각(ms) */
export const weekStart = (week: number): number => week * WEEK + 4 * DAY - KST;

/** 한국 시간 날짜 문자열 YYYY-MM-DD */
export const dayOf = (ms: number): string => new Date(ms + KST).toISOString().slice(0, 10);

/** 문자열을 32비트 정수로 섞는다 (FNV-1a). 같은 문자열이면 항상 같다. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 씨앗 하나에서 0~1 난수를 하나 뽑는다 (mulberry32의 한 걸음) */
export function unit(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
