/*
 * 정식 출시 규칙(순수). 출시 초기화 스크립트(`reset.ts`)와 출시 서비스(`launch.service.ts`)가 같이 쓴다.
 * 수치는 모두 사용자가 정한 값이다(2026-11 정식 출시 계획).
 */

const DAY_MS = 86_400_000;

export const LAUNCH = {
  /** 레벨 랭킹 상위 몇 명에게 순위 보상을 주는가 */
  topCount: 15,
  /** 1위는 고정 */
  first: { coins: 500_000_000, diamonds: 1000 },
  /** 2위가 기준: 3위 이하는 2위 보상 × (내 레벨 ÷ 2위 레벨) */
  second: { coins: 300_000_000, diamonds: 300 },
  /** 전원 스타트 패키지(출시 기념 보상) */
  starter: { coins: 100_000_000, diamonds: 150 },
  /** 출시 뒤 이 기간 안에 가입한 신규 계정도 첫 접속 때 스타트 패키지를 받는다 */
  newcomerDays: 7,
  /** 환영 팝업을 보여 주는 기간(출시 시각부터) */
  popupDays: 14,
  /** 출시 우편이 남아 있는 기간(보통 우편은 30일이다) */
  mailDays: 90,
  /** 순위 보상 코인을 맞추는 단위 */
  coinStep: 1_000_000,
} as const;

export interface RankEntry {
  uid: string;
  level: number;
  fans: number;
}

export interface RankReward extends RankEntry {
  rank: number;
  coins: number;
  diamonds: number;
}

const roundTo = (n: number, step: number): number => Math.round(n / step) * step;

/**
 * 레벨 랭킹(레벨 → 팬 수 → uid 순) 상위 `topCount`명의 순위 보상.
 * 1·2위는 고정이고 3위 이하는 2위의 보상에 레벨 비례(내 레벨 ÷ 2위 레벨)로 준다. 팬이 없는 계정은 순위에 넣지 않는다.
 */
export function planRankRewards(entries: readonly RankEntry[]): RankReward[] {
  const ranked = entries
    .filter((e) => Number.isFinite(e.level) && e.level >= 1 && e.fans > 0)
    .sort((a, b) => b.level - a.level || b.fans - a.fans || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
    .slice(0, LAUNCH.topCount);
  const baseLevel = ranked[1]?.level ?? 1;
  return ranked.map((e, i) => {
    const rank = i + 1;
    if (rank === 1) return { ...e, rank, ...LAUNCH.first };
    if (rank === 2) return { ...e, rank, ...LAUNCH.second };
    const ratio = Math.min(1, e.level / baseLevel);
    return {
      ...e,
      rank,
      coins: Math.max(LAUNCH.coinStep, roundTo(LAUNCH.second.coins * ratio, LAUNCH.coinStep)),
      diamonds: Math.max(1, Math.round(LAUNCH.second.diamonds * ratio)),
    };
  });
}

/** 출시 후 가입한 신규 계정인가: 계정을 만든 시각이 [출시, 출시 + newcomerDays) 안이다. */
export function newcomerEligible(createdAtMs: number, launchedAtMs: number): boolean {
  return createdAtMs >= launchedAtMs && createdAtMs < launchedAtMs + LAUNCH.newcomerDays * DAY_MS;
}

/** 환영 팝업을 보여 줄 기간인가 */
export function popupOpen(launchedAtMs: number, nowMs: number): boolean {
  return nowMs >= launchedAtMs && nowMs < launchedAtMs + LAUNCH.popupDays * DAY_MS;
}

/** 우편에 적는 코인 표기: 1,000,000 이상이면 M 단위 */
export function coinText(coins: number): string {
  return coins >= 1_000_000 ? `${Math.round((coins / 1_000_000) * 10) / 10}M` : String(coins);
}

/** 우편·장부 중복 지급을 막는 키 */
export const launchRef = (kind: 'rank' | 'starter', uid: string): string => `launch:${kind}:${uid}`;

export function rankMailText(r: Pick<RankReward, 'rank' | 'coins' | 'diamonds'>): { title: string; body: string } {
  return {
    title: `🏆 출시 기념 순위 보상 (${r.rank}위)`,
    body: `정식 출시 전 레벨 랭킹 ${r.rank}위였던 분께 드리는 보상이에요. 🪙 ${coinText(r.coins)} · 💎 ${r.diamonds}. 새로 시작하는 게임에서 받아 쓰세요. 함께해 주셔서 고마워요!`,
  };
}

export function starterMailText(): { title: string; body: string } {
  return {
    title: '🎁 정식 출시 스타트 패키지',
    body: `모노사파 키우기 정식 출시를 기념해 모두에게 드려요. 🪙 ${coinText(LAUNCH.starter.coins)} · 💎 ${LAUNCH.starter.diamonds}. 우편함에서 「받기」를 눌러 주세요.`,
  };
}
