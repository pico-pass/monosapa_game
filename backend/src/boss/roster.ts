/*
 * 월드 보스의 순수 규칙: 이번 주 보스와 약점, 판 하나의 데미지, 목표·단계·보상.
 * 보스는 매주 하나씩 돌아가고(주 번호는 common/week.ts), 모두의 데미지가 목표(target)를 5단계로 나눈 만큼 쌓일 때마다 전원이 보상을 받는다.
 * 서버는 게임 규칙을 검증하지 않으므로 점수 위조는 막지 못한다. 대신 하루 타수와 최소 간격으로 한 사람이 낼 수 있는 데미지를 묶는다.
 */

/**
 * 데미지가 되는 판의 종류: 공연(마이크 타이밍) · 직접 공연(런·블록 같은 미니게임) · 아케이드(피켓팅 빼고 전부).
 * 약점이 되는 종류는 아래 ROSTER의 다섯 가지뿐이고, 뒤의 넷(악플 베기·블랙홀 먹기·게이트 행진·음표 플링코)은 약점 보너스 없이 데미지만 들어간다.
 * (보스를 늘리면 주 번호 % 길이로 돌리는 이번 주 보스가 중간에 바뀌므로 ROSTER 길이는 함부로 바꾸지 않는다)
 */
export const BOSS_KINDS = ['concert', 'manual', 'rhythm', 'survival', 'lyric', 'slash', 'hole', 'gate', 'plinko'] as const;
export type BossKind = (typeof BOSS_KINDS)[number];
export const isBossKind = (v: unknown): v is BossKind => typeof v === 'string' && (BOSS_KINDS as readonly string[]).includes(v);

export interface BossDef {
  id: string;
  name: string;
  icon: string;
  line: string;
  /** 이 게임의 점수는 데미지가 2배 */
  weak: BossKind;
}

/** 창작자의 진짜 적 5종. 주 번호 % 5로 돌아간다. */
export const ROSTER: readonly BossDef[] = [
  { id: 'slump', name: '슬럼프', icon: '🌫️', line: '아무것도 쓰고 싶지 않은 안개가 마을을 덮었어요. 몸을 움직여 걷어 내요.', weak: 'manual' },
  { id: 'deadline', name: '마감 D-0', icon: '⏰', line: '째깍째깍, 마감이 코앞이에요. 박자를 놓치지 말고 시간을 되돌려요.', weak: 'rhythm' },
  { id: 'stagefright', name: '무대공포', icon: '🎭', line: '조명이 켜지자 다리가 떨려요. 무대 위에서 이겨 내요.', weak: 'concert' },
  { id: 'blank', name: '백지의 공포', icon: '📄', line: '한 줄도 써지지 않는 새하얀 종이예요. 가사로 가득 채워 버려요.', weak: 'lyric' },
  { id: 'insomnia', name: '불면의 새벽 3시', icon: '🌙', line: '눈이 말똥말똥한 새벽 3시. 끝까지 버텨서 아침을 불러와요.', weak: 'survival' },
];

export const bossOf = (week: number): BossDef => ROSTER[((week % ROSTER.length) + ROSTER.length) % ROSTER.length];

/** 단계 수와 단계별 전원 보상(다이아). 단계 i(1부터)는 총 데미지가 목표의 i/TIER_COUNT에 닿으면 열린다. */
export const TIER_REWARDS: readonly number[] = [10, 20, 30, 40, 50];
export const TIER_COUNT = TIER_REWARDS.length;

/** 한 사람이 하루에 인정받는 타수, 타 사이의 최소 간격 */
export const DAILY_HITS = 10;
export const MIN_GAP_MS = 15_000;

/** 목표의 하한·상한(활성 계정 한 명당)과 첫 주 기대치 */
export const MIN_TARGET = 10_000;
const PER_PLAYER_MIN = 800;
const PER_PLAYER_MAX = 8000;
const PER_PLAYER_FIRST = 1500;
const GROWTH = 1.15;

export interface HitDamage {
  damage: number;
  weak: boolean;
  crit: boolean;
}

/** 점수(0~1000) 한 판의 데미지: round(점수/10) × 약점 2배 × S등급(900 이상) 크리티컬 1.5배 */
export function hitDamage(kind: BossKind, score: number, weakKind: BossKind): HitDamage {
  const s = Math.max(0, Math.min(1000, Math.round(Number.isFinite(score) ? score : 0)));
  const weak = kind === weakKind;
  const crit = s >= 900;
  return { damage: Math.round(Math.round(s / 10) * (weak ? 2 : 1) * (crit ? 1.5 : 1)), weak, crit };
}

/** 이번 주 목표 데미지. 지난주 총합의 1.15배를 활성 계정 수에 맞춘 하한·상한 안으로 자른다. 지난주 기록이 없으면 활성 계정 수에 비례한다. */
export function targetOf(prevTotal: number, activePlayers: number): number {
  const active = Math.max(1, Math.floor(activePlayers));
  const raw = prevTotal > 0 ? Math.min(active * PER_PLAYER_MAX, Math.max(active * PER_PLAYER_MIN, prevTotal * GROWTH)) : active * PER_PLAYER_FIRST;
  return Math.max(MIN_TARGET, Math.round(raw / 100) * 100);
}

/** 총 데미지가 닿은 단계(0~TIER_COUNT) */
export function tierOf(total: number, target: number): number {
  if (!(target > 0) || !(total > 0)) return 0;
  return Math.min(TIER_COUNT, Math.floor((total / target) * TIER_COUNT));
}

/** 단계 from(받은 수)부터 to(닿은 수) 직전까지의 보상 합 */
export const tierRewardSum = (from: number, to: number): number => TIER_REWARDS.slice(Math.max(0, from), Math.max(0, Math.min(to, TIER_COUNT))).reduce((a, b) => a + b, 0);

/** 지난주 개인 순위 보상(다이아): 상위 1% 5 · 10% 3 · 50% 1. 순위는 데미지 순, 인원이 적어도 1등은 1%에 든다. */
export function rankReward(rank: number, players: number): number {
  if (rank < 1 || players < 1) return 0;
  if (rank <= Math.max(1, Math.ceil(players * 0.01))) return 5;
  if (rank <= Math.ceil(players * 0.1)) return 3;
  if (rank <= Math.ceil(players * 0.5)) return 1;
  return 0;
}
