import type { DiamondUpgradeKind, EquipmentKind, StageId } from './types';

/**
 * 모든 경제 수치는 이 파일 한 곳에서만 수정한다. (기획서 3~7, 11장)
 * 조정 이력은 README의 「밸런스 조정 기록」에 남긴다.
 */
export const SCHEMA_VERSION = 1;

/**
 * 어둠속성 장비 가격은 일반속성 장비에서 계산한다 (사용자 지정).
 *   최초 비용 = 일반의 12배, 가격이 늘어나는 폭(성장률 − 1) = 일반의 2.4배  → 성장률 = 1 + (일반 성장률 − 1) × 2.4
 * 효과(레벨당 증가량)는 일반 장비와 같다.
 */
const DARK_COST = { baseMult: 12, growthSpanMult: 2.4 };
const darkCost = (c: { base: number; growth: number }) => ({
  base: c.base * DARK_COST.baseMult,
  growth: Math.round((1 + (c.growth - 1) * DARK_COST.growthSpanMult) * 1e4) / 1e4,
});

const NORMAL_EQUIPMENT = {
  mic: { base: 50, growth: 1.6 }, // 원안 1.5
  studio: { base: 150, growth: 1.7 }, // 원안 1.6
  promotion: { base: 90, growth: 1.6 }, // 원안 1.5
};
const NORMAL_MUSIC_POWER = { base: 250, growth: 1.5 };

export const BALANCE = {
  persona: {
    normalRate: 1.0,
    darkRate: 1.7,
    darkHotRate: 2.1,
    normalRoyaltyMult: 1.25,
    darkRoyaltyMult: 1,
    heatDownPerSec: 1,
    heatUpPerSec: 0.6,
    /** 이 값 이상이면 어둠 생산이 darkHotRate가 된다. */
    hotThreshold: 80,
    maxHeat: 100,
    /** 일반→어둠 수동 전환 허용 상한 */
    manualDarkMaxHeat: 80,
    /** 마이크 압수 후 어둠 재진입 허용 상한 */
    reentryMaxHeat: 60,
    switchLockMs: 3000,
    recoveryMs: 20000,
    recoveryPenalty: 0.5,
  },
  production: { micPerLevel: 0.15, studioPerLevel: 0.05 }, // 작업실 레벨당 0.10 → 0.05 (사용자 지정, 일반·어둠 공통)
  /** perAlbum[i] = i번째 앨범을 낼 때 인세 배율에 더해지는 값 (누적 합산) */
  royalty: { perFan: 0.02, promotionPerLevel: 0.2, perAlbum: [0.08, 0.1, 0.12] },
  level: { fansPerStep: 20 },
  click: { value: 1, maxPerSec: 3, holdPerSec: 2 },
  /**
   * 순수 음악력 업그레이드(사용자 요청으로 추가, 원안에 없음). 코인으로 올리고 최대 레벨은 없다.
   *   작업하기 한 번의 기본 라임 = click.value + clickPerLevel × 레벨 (여기에 생산배율이 곱해진다)
   *   비용(코인) = ceil(base × growth^레벨)  → 250, 375, 563, 844, 1266 …
   */
  musicPower: { ...NORMAL_MUSIC_POWER, clickPerLevel: 1 },
  /** 음지 드립력: 어둠속성 전용 클릭 업그레이드. 효과는 같고 가격만 darkCost로 비싸다. */
  dripPower: { ...darkCost(NORMAL_MUSIC_POWER), clickPerLevel: 1 },
  /**
   * 싱글 발매 비용·효과는 자아별로 따로 센다. n은 그 자아로 이미 낸 싱글 수다.
   *   필요 라임 = ceil(rhymeBase × rhymeGrowth^n), 코인 = floor(coinBase × coinGrowth^n), 팬 = ceil(fanBase × fanGrowth^n)
   * 기본값은 두 자아가 같다(사용자 지정 공식). 자아마다 다르게 하려면 아래 값만 바꾸면 된다.
   */
  single: {
    normal: {
      rhymeBase: 130, // 원안 60
      rhymeGrowth: 3.3, // 원안 1.18
      coinBase: 50, // 원안 100
      coinGrowth: 1.44, // 원안 1.20
      fanBase: 5, // 원안 10
      fanGrowth: 1.8, // 원안 1.18
    },
    dark: {
      rhymeBase: 130,
      rhymeGrowth: 3.3,
      coinBase: 50,
      coinGrowth: 1.44,
      fanBase: 5,
      fanGrowth: 1.8,
    },
  },
  /** 앨범은 ALBUM_CATALOG 순서대로 낸다. i번째 앨범의 비용(코인)·획득 팬은 사용자 지정 값이다. */
  album: {
    costs: [10_000, 350_000, 20_000_000],
    fans: [100, 200, 300],
  },
  /**
   * 다이아 재화(사용자 요청으로 추가, 원안에 없음). 수량은 모두 제안값이라 여기서 조정한다.
   *   획득: 공연장 첫 클리어(STAGES[].firstClearDiamonds), 앨범 발매(album[i]), 플레이어 레벨이 오를 때마다(levelUp × 오른 레벨 수)
   *   사용: 공연 쿨다운 즉시 초기화(skipCooldown), 마이크 압수 즉시 해제 + 과열 0(clearSeizure), 다이아 전용 영구 업그레이드
   * 영구 업그레이드: 생산(자동+작업하기 라임)·인세에 (1 + perLevel × 레벨)이 곱해진다. 일반·어둠 모두에 적용된다.
   *   비용(다이아) = ceil(base × growth^레벨)
   */
  diamond: {
    album: [30, 60, 120],
    levelUp: 2,
    skipCooldown: 5,
    clearSeizure: 10,
    upgrade: {
      maxLevel: 20,
      production: { base: 5, growth: 1.25, perLevel: 0.05 },
      royalty: { base: 5, growth: 1.25, perLevel: 0.05 },
    },
  },
  /** 일반속성 장비. 일반속성에서만 효과가 난다. */
  equipment: { maxLevel: 20, ...NORMAL_EQUIPMENT },
  /** 어둠속성 장비(마이크·작업실·홍보). 어둠속성에서만 효과가 나고 레벨당 효과는 일반과 같다. */
  darkEquipment: {
    maxLevel: 20,
    mic: darkCost(NORMAL_EQUIPMENT.mic),
    studio: darkCost(NORMAL_EQUIPMENT.studio),
    promotion: darkCost(NORMAL_EQUIPMENT.promotion),
  },
  concert: {
    cooldownMs: 120_000,
    clearScore: 600,
    failRewardRate: 0.5,
    personaRewardMult: { normal: 1, dark: 1.5 }, // 원안 1.15
    taskCount: 10,
    /** 첫 목표 1초, 첫 간격 2초 */
    firstTargetMs: 1000,
    taskIntervalMs: 2000,
    /** 과제 간격이 다음 과제마다 이 값으로 나뉘어 점점 빨라진다 (2.0초 → 1.08초). 입력 구간이 겹치지 않게 아래 windowMs는 간격의 절반으로 줄어든다. */
    paceGrowth: 1.08,
    /** 마지막 과제 뒤 여유 시간. 공연 길이 = 마지막 목표 + 이 값 */
    tailMs: 1000,
    /** 한 과제의 입력 구간(±ms) 최대치 */
    windowMs: 500,
    /** 난이도 1일 때의 판정 폭(±ms). 실제 판정 폭은 이 값을 난이도로 나눈다. */
    perfectMs: 120,
    goodMs: { normal: 300, dark: 220 },
    /** 첫 공연장(방구석)의 난이도. 1이면 기획서 원안 판정 폭. */
    baseDifficulty: 1.3,
    /** 다음 공연장으로 갈 때마다 난이도가 곱해지는 배수 */
    stageDifficultyGrowth: 1.1,
    /** 한 공연 안에서 과제를 하나 넘길 때마다 난이도가 곱해지는 배수 (10번째 과제는 1.25^9 ≈ 7.5배) */
    taskDifficultyGrowth: 1.25,
    /** 공연장별로 다른 과제 난이도 배수. 적혀 있지 않은 공연장은 taskDifficultyGrowth를 쓴다. */
    stageTaskGrowth: { room: 1.33 } as Partial<Record<StageId, number>>,
    perfectScore: 100,
    goodScore: 70,
  },
  /**
   * 모노사파런 (지하 클럽의 직접 공연). 달리면서 점점 빨라지고, 목표 거리를 완주하면 성공, 점수는 젤리를 먹은 비율(0~1000)이다.
   * 스크롤 단위(u)로 게임을 돌리고, 화면에 보이는 거리(m)는 코스 길이에 비례해 환산한다. 시작→끝 속도는 u/s.
   * 어둠은 더 길고 더 빠른 대신 보상이 일반의 4배다(rewardMult). 실패 시 보상 비율은 concert.failRewardRate를 쓴다.
   */
  run: {
    viewUnits: 32,
    gravity: 40,
    jumpV: 13,
    doubleJumpV: 12,
    maxJumps: 2,
    playerW: 0.8,
    playerH: 1.6,
    hearts: 3,
    invincibleMs: 1200,
    /** 장애물에 걸린 직후 무적 시간 동안의 속도 배율 */
    stumbleSpeedMult: 0.7,
    /** 출발 직후 장애물이 없는 구간(u) */
    leadInU: 26,
    /** 결승선 앞 장애물이 없는 구간(u) */
    finishClearU: 24,
    /** 장애물 사이 간격(초 단위, 속도를 곱해 u로 환산): 진행할수록 [시작, 끝]으로 줄어든다 */
    gapSec: { min: [1.15, 0.85], max: [1.9, 1.35] },
    jellyPerGapChance: 0.8,
    persona: {
      normal: { goalM: 2600, lengthU: 1500, startSpeed: 8, endSpeed: 16, rewardMult: 1 },
      dark: { goalM: 6900, lengthU: 2400, startSpeed: 11, endSpeed: 22, rewardMult: 4 },
    },
  },
  offline: {
    capMs: 2 * 3600 * 1000,
    efficiency: 0.7,
    /** 한 번의 온라인 틱으로 인정하는 최대 간격. 넘으면 오프라인 정산으로 처리한다. */
    onlineMaxGapMs: 5000,
    /** 이보다 짧은 복귀에는 결과창을 띄우지 않는다. (보상은 항상 반영) */
    reportMinMs: 30_000,
  },
  save: {
    autosaveMs: 5000,
    backupMinIntervalMs: 60_000,
  },
  /** Number 안전 범위 이전에 건다. 이 값을 넘는 재화는 잘라낸다. */
  maxResource: 1e15,
  maxSingles: 2000,
} as const;

export interface StageDef {
  id: StageId;
  fans: number;
  firstClearCoins: number;
  /** 처음 클리어할 때 한 번 받는 다이아 */
  firstClearDiamonds: number;
  baseCoins: number;
}

export const STAGES: readonly StageDef[] = [
  { id: 'room', fans: 100, firstClearCoins: 200, firstClearDiamonds: 5, baseCoins: 40 },
  { id: 'club', fans: 400, firstClearCoins: 500, firstClearDiamonds: 10, baseCoins: 80 },
  { id: 'hall', fans: 1200, firstClearCoins: 1200, firstClearDiamonds: 15, baseCoins: 150 },
  // 첫 투어(소형 공연장) 이후의 공연장. 앞 공연장 클리어 + 팬 조건으로 차례로 열린다.
  { id: 'solo', fans: 3000, firstClearCoins: 3000, firstClearDiamonds: 20, baseCoins: 300 },
  { id: 'medium', fans: 8000, firstClearCoins: 7500, firstClearDiamonds: 30, baseCoins: 600 },
  { id: 'large', fans: 20000, firstClearCoins: 18000, firstClearDiamonds: 40, baseCoins: 1200 },
  { id: 'arena', fans: 50000, firstClearCoins: 45000, firstClearDiamonds: 50, baseCoins: 2500 },
  { id: 'world', fans: 150000, firstClearCoins: 120000, firstClearDiamonds: 80, baseCoins: 6000 },
];

export const STAGE_IDS: readonly StageId[] = STAGES.map((s) => s.id);

/** 직접 공연 종류. 적혀 있지 않은 공연장은 마이크 타이밍이다. */
export type ManualGame = 'timing' | 'run';
const STAGE_GAMES: Partial<Record<StageId, ManualGame>> = { club: 'run' };
export const manualGameOf = (id: StageId): ManualGame => STAGE_GAMES[id] ?? 'timing';
export const LAST_STAGE: StageId = STAGES[STAGES.length - 1].id;
/** 이 공연장을 처음 클리어하면 「첫 투어 완료」 카드가 뜬다. 이후 공연장은 그 너머의 확장 콘텐츠다. */
export const TOUR_STAGE: StageId = 'hall';

export const EQUIPMENT_KINDS: readonly EquipmentKind[] = ['mic', 'studio', 'promotion'];
export const DIAMOND_UPGRADE_KINDS: readonly DiamondUpgradeKind[] = ['production', 'royalty'];
