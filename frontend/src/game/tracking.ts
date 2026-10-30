import type { CounterKey, Counters, GameState } from './types';

/* 평생 누적 횟수. 업적과 일일·주간 미션이 읽고, 명령(commands/shop/…)이 상태를 바꿀 때 함께 올린다. */

export const COUNTER_KEYS: readonly CounterKey[] = [
  'works',
  'dawnWorks',
  'seizures',
  'buys',
  'concerts',
  'claims',
  'snacks',
  'campaigns',
  'posts',
  'virals',
  'mails',
  'antiMails',
  'missions',
  'attendances',
  'bestStreak',
  'arcades',
  'rhythms',
  'survivals',
  'lyrics',
  'ticketings',
  'towerClears',
  'pulls',
  'pets',
  'challenges',
  'chartTop10',
  'chartNo1',
  'trades',
];

export function zeroCounters(): Counters {
  const c = {} as Counters;
  for (const k of COUNTER_KEYS) c[k] = 0;
  return c;
}

/** key를 n만큼 올린 새 상태 */
export function track(s: GameState, key: CounterKey, n = 1): GameState {
  return { ...s, counters: { ...s.counters, [key]: (s.counters[key] ?? 0) + n } };
}

/** key가 value보다 작을 때만 value로 올린다 (최고 기록용) */
export function trackMax(s: GameState, key: CounterKey, value: number): GameState {
  return (s.counters[key] ?? 0) >= value ? s : { ...s, counters: { ...s.counters, [key]: value } };
}

/** 새벽 3시대(03:00~03:59, 기기 시간대)인가 */
export const isDawnHour = (ms: number): boolean => new Date(ms).getHours() === 3;
