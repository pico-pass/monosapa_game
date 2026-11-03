import type { CampaignId, CardRarity, CostumeId, CounterKey, DarkCostumeId, DiamondUpgradeKind, EquipmentKind, Persona, PostKind, SnackId, StageId, StreamPlatform, ThemeId, Vibe } from './types';

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
  /**
   * perAlbum[속성][i] = 그 속성의 i번째 앨범을 낼 때 인세 배율에 더해지는 값 (누적 합산).
   * 어느 속성의 앨범이든 일반·어둠 두 자아의 인세에 모두 곱해진다.
   */
  royalty: {
    perFan: 0.02,
    promotionPerLevel: 0.2,
    perAlbum: { normal: [0.08, 0.1, 0.12, 0.14, 0.16, 0.18], dark: [0.12, 0.24, 0.4] },
  },
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
  /**
   * 앨범은 속성마다 ALBUM_CATALOG 순서대로 낸다. 속성별로 i번째 앨범의 비용(코인)·획득 팬이다.
   * 일반 1~3번째와 어둠 1~3번째는 사용자 지정 값이다. 일반 4~6번째(사용자가 앨범 구성만 줬다)는 같은 흐름으로 이은 제안값이다
   * (비용은 앞 앨범의 50배씩 10억 · 500억 · 2.5조, 팬은 +100씩). 일반 4~6번째의 인세 배율(royalty.perAlbum)과 발매 다이아(diamond.album)도 제안값이다.
   * 어둠 앨범 비용 100,000 · 6,900,000 · 740,000,000코인, 팬 +124 · +300 · +740, 인세 +12% · +24% · +40%, 발매 다이아 💎100 · 200 · 400.
   * 일반 6장을 모두 내면 인세 ×1.78, 어둠 3장까지 모두 내면 ×2.54.
   */
  album: {
    normal: {
      costs: [10_000, 350_000, 20_000_000, 1_000_000_000, 50_000_000_000, 2_500_000_000_000],
      fans: [100, 200, 300, 400, 500, 600],
    },
    dark: {
      costs: [100_000, 6_900_000, 740_000_000],
      fans: [124, 300, 740],
    },
  },
  /**
   * 다이아 재화(사용자 요청으로 추가, 원안에 없음). 수량은 모두 제안값이라 여기서 조정한다.
   *   획득: 공연장 첫 클리어(STAGES[].firstClearDiamonds), 앨범 발매(album[속성][i]), 플레이어 레벨이 오를 때마다(levelUp × 오른 레벨 수)
   *   사용: 공연 쿨다운 즉시 초기화(skipCooldown), 마이크 압수 즉시 해제 + 과열 0(clearSeizure), 다이아 전용 영구 업그레이드
   * 영구 업그레이드: 생산(자동+작업하기 라임)·인세에 (1 + perLevel × 레벨)이 곱해진다. 일반·어둠 모두에 적용된다.
   *   비용(다이아) = ceil(base × growth^레벨)
   */
  diamond: {
    album: { normal: [30, 60, 120, 200, 300, 400], dark: [100, 200, 400] },
    levelUp: 2,
    skipCooldown: 5,
    clearSeizure: 10,
    upgrade: {
      maxLevel: 20,
      production: { base: 5, growth: 1.25, perLevel: 0.05 },
      royalty: { base: 5, growth: 1.25, perLevel: 0.05 },
      /** 오프라인 정산 시간 확장: 레벨당 상한이 perLevelMs만큼 늘어난다 (기본 2시간 → 최대 6시간). 최대 레벨이 따로 있다. */
      offline: { base: 8, growth: 1.3, perLevelMs: 30 * 60_000, maxLevel: 8 },
    },
  },
  /**
   * 상점(사용자 요청으로 추가, 원안에 없음). 코인 가격(간식·홍보 캠페인)은 base × priceMult × (1 + priceLevelStep × (플레이어 레벨 − 1))이라 후반에도 코인 싱크로 남는다.
   *   간식: 작업하기 라임 +bonus. 같은 간식을 또 사면 시간이 더해지고(최대 maxStack배까지), 다른 간식을 사면 바뀐다.
   *   홍보 캠페인: 싱글·앨범·모노그램으로 얻는 팬 ×mult. 비쌀수록 오래 간다.
   *   테마: 다이아로 사는 꾸미기. 모양만 바뀐다.
   */
  shop: {
    /** 간식·홍보 캠페인(코인) 가격 배수. 처음 제안값에서 사용자 요청으로 25배로 올렸다. 테마(다이아)에는 적용하지 않는다. */
    priceMult: 25,
    priceLevelStep: 0.25,
    maxStack: 3,
    snacks: {
      kimbap: { base: 60, bonus: 0.3, durationMs: 5 * 60_000 },
      coffee: { base: 150, bonus: 0.6, durationMs: 10 * 60_000 },
      energy: { base: 400, bonus: 1.2, durationMs: 10 * 60_000 },
      lunchbox: { base: 1200, bonus: 2, durationMs: 20 * 60_000 },
    } as Record<SnackId, { base: number; bonus: number; durationMs: number }>,
    campaigns: {
      flyer: { base: 500, mult: 1.5, durationMs: 30 * 60_000 },
      insta: { base: 4000, mult: 2, durationMs: 2 * 3600_000 },
      billboard: { base: 30000, mult: 3, durationMs: 6 * 3600_000 },
    } as Record<CampaignId, { base: number; mult: number; durationMs: number }>,
    themes: { default: 0, pastel: 30, mono: 30, neon: 50 } as Record<ThemeId, number>,
    /** 코스튬(사용자 지정): 일반속성 11종은 각 50다이아, 어둠속성 10종은 각 66다이아. 모양만 바뀐다. */
    costumes: {
      jirai: 50, hype: 50, angry: 50, maid: 50, bunny: 50, fallen: 50, bear: 50, nun: 50, vampire: 50, butler: 50, bride: 50,
      dbunny: 66, band: 66, king: 66, milk: 66, dbear: 66, postman: 66, cultist: 66, clown: 66, dnurse: 66, dbride: 66,
    } as Record<CostumeId, number>,
  },
  /**
   * 모노그램(가상 SNS). 게시물을 올려 두면 durationMs 뒤에 팬이 모인다.
   *   팬 = ceil(√(팬 + fansOffset) × k) × 홍보 캠페인 × 결과 배율. 팬이 많을수록 늘지만 √라서 복리로 불지는 않는다.
   *   결과는 씨앗과 게시물 번호로 정해진다: 바이럴(×viralMult + 다이아), 악플(×hateMult), 나머지는 보통.
   *   슬롯은 기본 baseSlots개, 슬롯마다 다이아로 늘린다(slotCosts[i] = (i+2)번째 슬롯). 첫 싱글을 낸 뒤부터 올릴 수 있다.
   */
  monogram: {
    baseSlots: 1,
    slotCosts: [10, 25, 60],
    fansOffset: 16,
    kinds: {
      lyric: { durationMs: 10 * 60_000, k: 0.2 },
      selfie: { durationMs: 20 * 60_000, k: 0.4 },
      reels: { durationMs: 60 * 60_000, k: 1.6 },
    } as Record<PostKind, { durationMs: number; k: number }>,
    viralChance: 0.1,
    hateChance: 0.15,
    viralMult: 5,
    hateMult: 0.4,
    viralDiamonds: [1, 3],
  },
  /**
   * 팬 DM. 한 통이 오고 다음 통이 오기까지 intervalMinMs~intervalMaxMs 사이(7~17분) 무작위로 걸리고(씨앗과 DM 번호로 정해진다),
   * 받은편지함은 cap통까지다(넘으면 가장 오래된 것이 밀려난다).
   * 답장 효과는 등급(effects)으로 정한다: 팬 증감은 지금 팬의 비율(최소 1명), 코인은 지금 인세 coinSecs초 분량(최소 minCoins).
   */
  fanMail: {
    intervalMinMs: 7 * 60_000,
    intervalMaxMs: 17 * 60_000,
    firstDelayMs: 2 * 60_000,
    cap: 6,
    minCoins: 5,
    weights: { support: 45, empathy: 35, anti: 20 },
    effects: {
      cheer: { fansPct: 0.003, coinSecs: 60, diamonds: 0 },
      thanks: { fansPct: 0.004, coinSecs: 120, diamonds: 0 },
      heart: { fansPct: 0.008, coinSecs: 240, diamonds: 0 },
      cool: { fansPct: 0.002, coinSecs: 30, diamonds: 0 },
      ignore: { fansPct: 0, coinSecs: 10, diamonds: 0 },
      empathize: { fansPct: 0.01, coinSecs: 300, diamonds: 1 },
    },
    /** 받아치기: winChance로 이기면 win, 지면 lose */
    clap: { winChance: 0.5, win: { fansPct: 0.02, coinSecs: 600, diamonds: 1 }, lose: { fansPct: -0.01, coinSecs: 0, diamonds: 0 } },
  },
  /**
   * 일일·주간 미션과 출석. 미션은 만들어 둔 표(MISSIONS)에서 고르고, 진행도는 지표의 증가량이다.
   * 모두 받으면 allBonus 다이아를 더 준다. 출석 보상은 연속 출석일 수에 따라 attendance가 7일 주기로 돈다.
   */
  missions: { allBonus: { daily: 3, weekly: 10 }, attendance: [1, 1, 2, 2, 3, 3, 10] },

  /**
   * 스트리밍(사용자 요청으로 추가, 원안에 없음). 자동 생산과 같은 방식으로 실제 경과 시간에 따라 쌓인다.
   *   초당 스트리밍 = 팬 수 × perFanPerSec (오프라인 정산은 다른 생산처럼 효율 70%·최대 2시간)
   *   쌓인 스트리밍은 4개 플랫폼에 무작위로 나뉘어 기록된다. 분배 비율은 shareBucketMs 구간마다 새로 뽑고,
   *   씨앗과 구간 번호만으로 정해지므로 한 번에 크게 전진하든 여러 번 나눠 전진하든 결과가 같다.
   *   claimIntervalMs마다 정산할 수 있고, streamsPerCoin 스트리밍 = 1코인(나머지는 다음 정산으로 넘어간다).
   *   원래 지정값은 3스트리밍 = 1코인이었으나 팬 1명이 초당 0.283코인(인세 기본치 0.025의 11배)이라 후반 코인이 넘쳐서 30으로 바꿨다.
   *   그 뒤 사용자 요청으로 팬당 초당 스트리밍을 0.85에서 0.2로 낮췄다. 지금은 팬 1명당 초당 약 0.0067코인(= 0.2 ÷ 30).
   */
  streaming: { perFanPerSec: 0.2, streamsPerCoin: 30, claimIntervalMs: 3600_000, shareBucketMs: 600_000 },
  /**
   * 유통사 호감도(사용자 요청): 코인으로 올리는 스트리밍 수익 업그레이드. 최대 레벨은 없다.
   *   스트리밍 정산으로 받는 코인 = 정산 대기 스트리밍 ÷ streamsPerCoin × (1 + perLevel × 레벨)
   *   비용 = ceil(base × growth^레벨) 코인 (첫 5,000, 이후 1.4배씩). 스트리밍 수·누적 기록은 그대로고 코인으로 바꾸는 비율만 바뀐다.
   */
  distributor: { base: 5000, growth: 1.4, perLevel: 0.05 },
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
   * 코스는 공연장마다 따로 정할 수 있다(stageCourse). 지하 클럽은 사용자 요청으로 짧아진 대신 훨씬 빨라진다:
   *   목표 일반 400m · 어둠 697.4m, 속도 일반 8→20 · 어둠 11→28(u/s). 달리는 시간은 약 69초/86초(원래 약 130초/151초).
   *   같은 자동 플레이어로 돌려 보면 점프 타이밍이 ±0.1초 흔들려도 원래 일반 코스보다 피격이 적다.
   *   stageCourse에 없는 공연장(폐건물 지하)은 persona의 원래 코스를 쓴다.
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
    stageCourse: {
      club: {
        normal: { goalM: 400, lengthU: 900, startSpeed: 8, endSpeed: 20 },
        dark: { goalM: 697.4, lengthU: 1570, startSpeed: 11, endSpeed: 28 },
      },
    } as Partial<Record<StageId, Record<Persona, { goalM: number; lengthU: number; startSpeed: number; endSpeed: number }>>>,
  },
  /**
   * 무대 세팅 블록 (소형 공연장의 직접 공연, 사용자 요청으로 추가, 원안에 없음). 수치는 모두 제안값이다.
   *   8×8 무대 바닥에 악기 모양 블록 3개를 끌어다 놓는다(회전 없음). 가로·세로 한 줄이 가득 차면 합주가 터져서 줄이 사라지고 점수가 오른다.
   *   손에 든 3개를 다 놓으면 새 3개를 받는다. 새 블록은 지금 바닥에 하나씩은 들어가는 것만 나온다(안 되면 작은 것으로 채운다).
   *   공연은 곡 4개(마지막이 앙코르) × 곡당 sets[].ms 동안이다. 곡이 바뀔 때마다 무대 사고로 불량 칸이 brokenPerSet만큼 생기고(어둠은 시작할 때도 startBroken칸),
   *   불량 칸은 채워진 칸으로 치지만 지우기 전에는 못 놓는다. 그 칸이 낀 줄이 터지면 같이 사라진다. 곡마다 점수 배율(mult)이 올라서 뒤 곡일수록 한 수가 값지다.
   *   점수(점) = (놓은 칸 수 × placePoint + clearPoint × n(n+1)/2 × 콤보 배율) × 곡 배율. n은 한 번에 터뜨린 줄 수(가로+세로 합).
   *   콤보 = 줄을 터뜨린 수가 이어진 횟수. 줄을 못 터뜨린 수가 comboGrace번 넘게 이어지면 끊기고, 배율 = 1 + comboStep × min(콤보 − 1, comboMax). 바닥이 통째로 비면 perfectBonus.
   *   놓을 곳이 없으면(어느 블록도 안 들어가면) 스태프가 가장 찬 가로줄·세로줄을 치워 주고 새 블록을 준다(rescues번까지, 일반·어둠 모두 1번). 그 뒤에도 막히면 공연이 거기서 끝난다.
   *   열기 점수(0~1000) = 1000 × min(1, 점수 ÷ target). 점수 600 이상이 클리어(concert.clearScore, 점수 = target × 0.6 이상). 어둠은 불량 칸이 많고 어려운 블록이 일찍 나오고 target이 높은 대신 보상이 2배다.
   *   블록은 tiers 가중치로 뽑는다(tier 0 작은 것, 1 중간, 2 큰 것). 어둠은 같은 곡에서 한 단계 어려운 가중치를 쓴다.
   *   봇 시뮬레이션(시드 300개, 휴리스틱으로 놓는 봇이 한 수에 걸리는 시간을 바꿔 가며): 한 수에 1.8초 걸리는 숙련 봇은 일반 96%·어둠 83% 클리어(열기 점수 평균 956·774),
   *   2.5초는 일반 94%·어둠 41%(813·569), 3.5초에 실수가 섞이면 일반 20%·어둠 0%(517·372), 5초는 둘 다 0%, 아무 데나 놓는 봇은 일반 16%·어둠 0%, 가만히 있으면 0점.
   *   한 판에 놓는 블록은 숙련 봇 기준 35~49개다. 사람의 실제 난이도는 측정하지 못했다.
   */
  blocks: {
    size: 8,
    hand: 3,
    /** 곡마다 길이(ms)와 점수 배율. 마지막 곡이 앙코르다. */
    sets: [
      { ms: 23_000, mult: 1 },
      { ms: 23_000, mult: 1.15 },
      { ms: 23_000, mult: 1.3 },
      { ms: 23_000, mult: 1.5 },
    ],
    placePoint: 1,
    clearPoint: 10,
    comboStep: 0.25,
    comboMax: 4,
    comboGrace: 2,
    perfectBonus: 60,
    /** 새 블록이 바닥에 하나씩 들어가는 조합을 찾는 시도 횟수 */
    dealTries: 12,
    persona: {
      normal: {
        startBroken: 0,
        brokenPerSet: [0, 1, 1, 2],
        tiers: [
          [8, 2, 0],
          [6, 4, 0],
          [4, 5, 1],
          [3, 5, 2],
        ],
        rescues: 1,
        target: 480,
        rewardMult: 1,
      },
      dark: {
        startBroken: 3,
        brokenPerSet: [0, 1, 2, 2],
        tiers: [
          [6, 4, 0],
          [4, 5, 1],
          [3, 5, 2],
          [2, 5, 3],
        ],
        rescues: 1,
        target: 750,
        rewardMult: 2,
      },
    },
  },
  /**
   * 응원봉 머지 웨이브 (단콘의 직접 공연, 사용자 요청으로 추가, 원안에 없음). 수치는 모두 제안값이다.
   *   5×5 무대에 응원봉이 가득 있다. 색은 3가지, 단계는 1~4. 같은 색·같은 단계가 상하좌우로 minGroup개 이상 붙어 있으면 그중 하나를 탭해서 합친다:
   *   탭한 칸에 한 단계 높은 응원봉이 생기고 나머지 칸은 비며, 빈 칸은 새 1단계 응원봉(무작위 색)으로 다시 채워진다. 4단계를 합치면 별 응원봉이 되어 터진다.
   *   합칠 때 얻는 응원 파워 = power[합쳐서 나온 단계] × 묶음 크기 ÷ 3 × 콤보 배율 × 앰프 배율(+ 연쇄·야유 정리 보너스).
   *   콤보: 직전 합치기에서 comboMs 안에 또 합치면 이어지고 배율 = 1 + comboStep × min(콤보 − 1, comboMax). 합칠 수 없는 곳을 탭하면 콤보가 끊긴다.
   *   묶음이 jumpGroup(5)개 이상이면 한 단계가 아니라 두 단계를 뛰어오른다(예: 1단계 5개 → 3단계). 묶음이 클수록 얻는 파워도 커져서(크기 ÷ 3) 바로 누를지 더 키울지 고르게 된다.
   *   연쇄: 합쳐서 생긴 응원봉이 같은 색·같은 단계 minGroup개 이상과 붙게 되면 저절로 이어서 합쳐지고(최대 chainMax번), k번째 연쇄는 파워 × (1 + chainStep × k)(체인 증폭기로 chainStep이 오른다).
   *   공연은 곡 4개(마지막이 앙코르) × 곡당 waves[].ms. 곡마다 열기 목표(goals)가 있고, 그 곡에서 모은 응원 파워 ÷ 목표(1이 상한)만큼 waveScore점(곡당 250점)을 받는다.
   *   곡이 끝나면 시간이 멈추고(앙코르 제외) 이펙터 offers개 중 하나를 고른다. 같은 이펙터를 또 고르면 겹쳐진다(작은 합창은 한 번만):
   *     앰프(파워 +ampStep씩) · 조명(이후 곡마다 시간 +lightMs씩) · 코러스(새 응원봉이 chorusStep 확률로 2단계로 나옴) · 체인 증폭기(연쇄 보너스 chainStep +chainBoost씩) · 작은 합창(minGroup이 3 → 2, 3개 미만 묶음의 파워는 pairPower배).
   *   합칠 수 있는 묶음이 하나도 없어지면 1단계 응원봉의 색을 다시 섞고, 그래도 없으면 이어진 세 칸을 1단계로 바꿔서 항상 한 수는 남게 한다.
   *   어둠은 새로 채워질 때 야유꾼(🗯)이 섞여 나온다(곡마다 heckleChance, 판 위에 heckleMax명까지). 야유꾼은 합칠 수 없는 칸이고, 합친 묶음에 붙어 있으면 사라지며 heckleBonus 파워를 준다. 판 위에 야유꾼이 있는 동안은 합치기 파워가 한 명당 heckleDrain(7%)씩 줄어든다.
   *   열기 점수(0~1000) = 곡별 waveScore 합. 600 이상이 클리어(concert.clearScore). 어둠은 목표가 높고 야유꾼이 끼는 대신 보상이 2배다.
   *   봇 시뮬레이션(시드 200개, 가장 값진 묶음을 누르는 봇이 한 번 누르는 데 걸리는 시간을 바꿔 가며, 이펙터는 앰프·체인·코러스·조명·작은 합창 순으로 고름):
   *     한 번에 1.2초 걸리는 숙련 봇은 일반·어둠 모두 100% 클리어(열기 점수 평균 876·839), 1.8초는 일반 85%·어둠 63%(718·622), 2.8초는 일반 9%·어둠 1%(467·351).
   *     아무 묶음이나 1.8초마다 누르는 봇은 일반 30%·어둠 7%, 가만히 있으면 0점. 이펙터를 무작위로 골라도 1.8초 봇은 일반 86%·어둠 46%, 작은 합창을 먼저 고르면 일반 83%·어둠 28%라
   *     어느 한 이펙터가 압도하지는 않는다. 한 판에 누르는 횟수는 숙련 봇 약 82회, 1.8초 봇 약 55회다.
   *   난이도 조정(사용자가 너무 쉽다고 해서 곡별 목표를 1.2배로 올림): 이전 목표(일반 600/470/460/460, 어둠 700/570/640/680)에서는 1.8초 봇이 일반 98%·어둠 92%,
   *     무작위 묶음 봇이 일반 74%·어둠 33%였다. 1.4배까지 올리면 1.5초 봇이 일반 81%·어둠 65%, 1.8초 봇이 일반 61%·어둠 24%로 "조금"을 넘어서 1.2배에서 멈췄다.
   *   사람의 실제 난이도는 측정하지 못했다.
   */
  merge: {
    size: 5,
    colors: 3,
    maxLevel: 4,
    minGroup: 3,
    /** 이 수 이상 붙은 묶음을 합치면 한 단계가 아니라 두 단계를 뛰어오른다 */
    jumpGroup: 5,
    /** 합쳐서 나온 단계(2~5)별 기본 응원 파워. 5단계는 4단계를 합친 별 응원봉이 터질 때다. */
    power: [0, 0, 10, 36, 130, 480],
    comboMs: 2500,
    comboStep: 0.1,
    comboMax: 5,
    chainStep: 0.5,
    chainMax: 6,
    waves: [{ ms: 23_000 }, { ms: 23_000 }, { ms: 23_000 }, { ms: 23_000 }],
    waveScore: 250,
    offers: 3,
    effects: { ampStep: 0.2, lightMs: 3000, chorusStep: 0.25, chainBoost: 0.5, pairMin: 2, pairPower: 0.6 },
    /** 이펙터 한도(겹쳐 고를 수 있는 횟수). 작은 합창은 한 번뿐이다. */
    effectMax: { amp: 3, light: 3, chorus: 3, chain: 3, pair: 1 },
    heckleBonus: 6,
    /** 합치는 순간 판 위에 야유꾼이 한 명 있을 때마다 그 합치기 파워가 이만큼(비율) 줄어든다 */
    heckleDrain: 0.07,
    /** 합칠 수 있는 묶음이 없을 때 색을 다시 섞는 시도 횟수 */
    reshuffleTries: 20,
    persona: {
      normal: { goals: [720, 565, 550, 550], heckleChance: [0, 0, 0, 0], heckleMax: 0, rewardMult: 1 },
      dark: { goals: [840, 685, 770, 815], heckleChance: [0.06, 0.1, 0.14, 0.18], heckleMax: 5, rewardMult: 2 },
    },
  },
  /**
   * 콘텐츠 팩 2(사용자 요청으로 추가, 원안에 없음). 아래 수치는 모두 제안값이고 설계는 docs/pack2-design.md에 있다.
   * 영구 보너스는 전부 "1에 더하는 비율"이라 가진 것이 없으면 기존 수치 그대로다.
   */
  /**
   * 곡 카드: 발매한 싱글이 카드가 된다(등급은 씨앗+싱글 번호로 결정). 덱 deckSlots장의 보너스가 합산된다.
   *   카드 하나의 보너스 = base[등급] × (1 + remasterBonus × 리마스터 레벨), 그 카드의 바이브 갈래에 더해진다. 라임은 그 카드를 낸 자아에만 적용된다.
   *   리마스터 비용(코인) = ceil(remasterCost[등급] × remasterGrowth^레벨). 싱글은 중복이 없어서 중복 강화 대신 코인으로 올린다.
   */
  cards: {
    rarityRates: { N: 0.55, R: 0.3, SR: 0.12, SSR: 0.03 },
    base: { N: 0.01, R: 0.02, SR: 0.04, SSR: 0.07 },
    deckSlots: 6,
    remasterMax: 5,
    remasterBonus: 0.15,
    remasterCost: { N: 300, R: 800, SR: 2500, SSR: 8000 },
    remasterGrowth: 2.2,
  },
  /**
   * 포토카드: 6세트 × 6등급 = 36장. 티켓 한 장으로 한 번 뽑는다(싱글 +1, 앨범 +5, 공연 첫 클리어 +2, 다이아로도 산다).
   *   등급 확률은 rates, 5등급 이상이 안 나온 채로 pityAt회째면 5등급 이상이 확정이다.
   *   중복은 조각이 되고(shardValue), 조각으로 원하는 카드를 만든다(craftCost). 세트를 다 모으면 setBonus가 영구로 붙고 다이아를 한 번 준다.
   */
  photo: {
    rates: [0.52, 0.28, 0.12, 0.052, 0.022, 0.006],
    pityAt: 90,
    pityGrade: 5,
    tickets: { single: 1, album: 5, firstClear: 2 },
    ticketDiamonds: 3,
    shardValue: [1, 2, 4, 10, 30, 100],
    craftCost: [8, 16, 32, 80, 240, 800],
    setDiamonds: 10,
    /** 세트 번호(1~6) 순서. all은 라임·인세·팬·전투력 모두에 더한다. */
    setBonus: [
      { kind: 'rhyme', value: 0.05 },
      { kind: 'coin', value: 0.05 },
      { kind: 'fan', value: 0.05 },
      { kind: 'power', value: 0.05 },
      { kind: 'offline', value: 30 * 60_000 },
      { kind: 'all', value: 0.03 },
    ] as { kind: 'rhyme' | 'coin' | 'fan' | 'power' | 'offline' | 'all'; value: number }[],
    /** 뽑기 한 번에 다이아로 사는 티켓 묶음 상한 */
    maxBuy: 10,
    maxTickets: 999,
  },
  /**
   * 피처링: 래퍼 21명(일반 5 · 레어 5 · 에픽 6 · 전설 5, 등급 코드는 N·R·SR·SSR). 한 번 뽑는 데 pullCost 다이아(10연은 tenCost).
   * 전설은 rates.SSR, pityAt회째에 전설 확정. 전설은 이번 주 픽업이 pickupRate 확률이고, 빗나가면 다음 전설은 픽업이 확정이다.
   * 10연의 마지막은 레어 이상이 확정이다. 등급 확률은 예전 3등급(R 85 · SR 13 · SSR 2)의 SR을 레어 8 + 에픽 5로 나눈 값이다.
   * 중복은 별이 오르고(최대 maxStar), 넘치면 dupRefund 다이아로 돌려받는다. 장착한 slots명의 패시브가 영구로 붙는다.
   *   패시브 = passive[등급] × (1 + starBonus × (별 − 1))
   */
  feat: {
    pullCost: 10,
    tenCost: 90,
    rates: { SSR: 0.02, SR: 0.05, R: 0.08, N: 0.85 },
    pityAt: 50,
    pickupRate: 0.5,
    slots: 3,
    maxStar: 6,
    starBonus: 0.1,
    passive: { N: 0.03, R: 0.05, SR: 0.07, SSR: 0.1 },
    dupRefund: { N: 1, R: 2, SR: 4, SSR: 8 },
    pickupWeekMs: 7 * 24 * 3600_000,
  },
  /**
   * 마스코트: 자아마다 하나. xp가 stageXp를 넘을 때마다 단계가 오르고 단계별 생산 보너스(그 자아의 라임)가 붙는다.
   * 기분: 배부름(fullUntil까지) → 배고픔(hungryMs 동안, 보너스 절반) → 삐짐(보너스 없음). 간식을 주면 풀린다.
   *   간식 값(코인) = ceil(baseCoins × growth^min(그 마스코트에게 간식을 준 횟수, maxRaises)), 놀아주기는 무료(쿨다운), 선물은 다이아.
   *   (처음에는 growth 1.05로 플레이어 레벨이 오를수록 비쌌지만, 요청으로 줄 때마다 1.0175배씩 오르고 maxRaises(500)번 뒤로는 오르지 않게 바꿨다. 시작 값은 처음 40이었다가 90으로 올렸다. 상한 값은 90×1.0175^500 ≈ 526,565코인.)
   *   배부를 때는 presentMs마다 선물(현재 인세 coinSecs초 분량 코인, diamondChance 확률로 다이아 1)을 받을 수 있다.
   */
  mascot: {
    stageXp: [0, 20, 80, 240, 720],
    stageBonus: [0, 0.02, 0.05, 0.09, 0.15],
    moodFactor: { happy: 1, hungry: 0.5, sulk: 0 },
    fullMs: 4 * 3600_000,
    fullCapMs: 12 * 3600_000,
    hungryMs: 12 * 3600_000,
    feed: { baseCoins: 90, growth: 1.0175, maxRaises: 500, xp: 4 },
    play: { cooldownMs: 10 * 60_000, xp: 1 },
    gift: { diamonds: 3, xp: 20 },
    present: { intervalMs: 6 * 3600_000, coinSecs: 300, diamondChance: 0.1, minCoins: 20 },
  },
  /**
   * 아케이드 공통: 점수(0~1000)로 등급을 정하고(grades 이상이 S·A·B, 미만은 C) 등급별로 보상한다.
   *   코인 = max(minCoins, ceil(현재 인세/초 × coinSecs[등급])), 팬 = ceil(팬 × fansPct[등급])
   *   다이아는 그 대상(곡·게임)에서 A·S 등급에 처음 닿을 때 한 번(firstDiamonds).
   * 시작할 때 쿨다운이 확정된다. 전투력·정확도에 영향을 주는 영구 보너스는 "power" 하나뿐이다.
   */
  arcade: {
    grades: { S: 900, A: 750, B: 500 },
    firstDiamonds: { A: 1, S: 3 },
    kinds: {
      rhythm: { cooldownMs: 90_000, coinSecs: { S: 300, A: 200, B: 120, C: 40 }, fansPct: { S: 0.004, A: 0.0025, B: 0.0012, C: 0 }, minCoins: 30 },
      survival: { cooldownMs: 240_000, coinSecs: { S: 900, A: 600, B: 360, C: 120 }, fansPct: { S: 0.008, A: 0.005, B: 0.0025, C: 0 }, minCoins: 60 },
      lyric: { cooldownMs: 180_000, coinSecs: { S: 600, A: 400, B: 240, C: 80 }, fansPct: { S: 0.006, A: 0.004, B: 0.002, C: 0 }, minCoins: 50 },
      ticketing: { cooldownMs: 180_000, coinSecs: { S: 0, A: 0, B: 0, C: 0 }, fansPct: { S: 0, A: 0, B: 0, C: 0 }, minCoins: 0 },
    },
  },
  /**
   * 리듬게임: 음원이 있는 곡(`songcharts.ts`)으로만 플레이한다. 채보는 음원에 맞춘 고정 채보이고, 음원은 leadInMs에 시작해 끝난 뒤 trackTailMs에 끝난다.
   * 난이도별 보상 배율(mult)과 판정 폭(power 보너스만큼 넓어진다)이 이 값들이다. 박 수·BPM·노트 밀도·darkBpm은 곡 번호와 씨앗으로 채보를 자동 생성하던
   * 처음 설계의 값이라 지금 게임에서는 쓰이지 않고 `buildChart`의 음원 없는 경로(테스트)에서만 쓰인다.
   * 점수 = 1000 × (정확도 × (1 − comboWeight) + 최대 콤보 비율 × comboWeight), 정확도 = (Perfect 1 + Good goodValue) / 노트 수
   */
  rhythm: {
    lanes: 4,
    levels: {
      easy: { beats: 40, bpm: 100, density: 0.75, mult: 0.6 },
      normal: { beats: 56, bpm: 116, density: 0.9, mult: 1 },
      hard: { beats: 72, bpm: 132, density: 1.2, mult: 1.6 },
    } as Record<'easy' | 'normal' | 'hard', { beats: number; bpm: number; density: number; mult: number }>,
    darkBpm: 8,
    leadInMs: 2200,
    tailMs: 1200,
    /** 음원 곡은 음원이 끝나고 이만큼 뒤에 끝난다 */
    trackTailMs: 300,
    perfectMs: 55,
    goodMs: 115,
    goodValue: 0.6,
    comboWeight: 0.15,
    /** 노트가 내려오는 시간(ms) */
    approachMs: 1100,
  },
  /**
   * 새벽 생존: 3분 동안 몰려오는 악플·잡음을 마이크가 자동으로 쓸어낸다. 레벨업마다 가사 스킬 3택 1.
   * 어둠 자아는 과열 게이지(=100−체력)가 체력이고 공격이 강한 대신 더 아프게 맞는다.
   *   점수 = 600 × 버틴 시간 비율 + 400 × min(1, 처치 수 / killsTarget)
   */
  survival: {
    durationMs: 180_000,
    stepMs: 1000 / 60,
    half: 34,
    playerR: 0.7,
    speed: 8,
    hp: 80,
    invincibleMs: 400,
    fireMs: 700,
    bulletSpeed: 24,
    bulletLife: 1.1,
    bulletR: 0.4,
    dmg: 1,
    maxEnemies: 140,
    spawnMs: [800, 180],
    bossAtMs: 150_000,
    killsTarget: 320,
    xpBase: 5,
    xpStep: 4,
    skillMax: 5,
    healAmount: 25,
    enemies: {
      noise: { hp: 1, speed: 3.6, dmg: 9, xp: 1, r: 0.55 },
      troll: { hp: 3, speed: 4.2, dmg: 14, xp: 2, r: 0.7 },
      mob: { hp: 14, speed: 3, dmg: 22, xp: 6, r: 1.1 },
      boss: { hp: 220, speed: 2.6, dmg: 35, xp: 40, r: 1.8 },
    },
    dark: { dmg: 1.4, taken: 1.3 },
  },
  /**
   * 가사 덱빌딩: turns턴 동안 매 턴 hand장을 뽑아 energy만큼 카드를 낸다. 카드 위력 × (1 + chain × 이어 붙은 수)가 완성도에 더해진다.
   * 점수 = min(1000, 1000 × 완성도 / target). 끝나면 draft장 중 한 장을 덱에 더한다. 덱은 minDeck장 밑으로 줄일 수 없다.
   * 완성도는 다음 싱글의 팬 보너스(fanBonus)가 된다(더 큰 보너스로만 덮어쓴다).
   */
  lyric: {
    turns: 6,
    hand: 5,
    energy: 3,
    chain: 0.5,
    target: 150,
    draft: 3,
    minDeck: 8,
    maxDeck: 30,
    fanBonus: { S: 0.5, A: 0.35, B: 0.2, C: 0.1 },
    /** 시작 덱(카드 ID → 장수) */
    starter: { 'l-a1': 2, 'l-eo1': 2, 'l-o1': 2, 'l-u1': 2, 'l-i1': 2, 'l-wild': 1, 'l-breath': 1 } as Record<string, number>,
  },
  /**
   * 무한의 계단: 한 층 = 보스 한 명. 직접 움직여 탄을 피하면서 보스를 쓰러뜨린다(마이크는 보스를 자동으로 조준해 쏜다).
   * 적 전투력 = baseEnemy × growth^(층−1), bossEvery층마다 보스층(× bossMult). 내 전투력 =
   *   (basePower + perLevel × (레벨−1)) × (1 + perGear × 그 자아의 장비 레벨 합 + perClick × 클릭 업그레이드) × (1 + 수집 power 보너스),
   * 층마다 정해진 약점 자아로 도전하면 weakMult배. 두 전투력의 비율(ratio = 내 / 적)이 내 탄의 위력을 정한다: 한 발 = shotDmg × ratio,
   * 보스 체력은 항상 bossHp. 그래서 전투력이 모자라면 시간 안에 못 쓰러뜨리고, 넉넉하면 빨리 끝난다.
   * 보스의 탄은 층이 오를수록 빠르고 잦고 아프다(fireMs·dmg·shotSpeed). 체력이 0이 되거나 시간이 다 되면 진 것이다.
   * 시작하면 failCooldownMs가 확정되고(포기·패배는 그대로), 이기면 winCooldownMs로 바로 풀린다. 주(월요일)마다 층이 1로 돌아가고 최고 기록은 남는다.
   * 보상: 층마다 인세 coinSecs초 분량 코인(처음 깰 때만), 보스층 다이아, milestoneEvery층마다 다이아 (이번 주 한 번씩).
   */
  tower: {
    baseEnemy: 40,
    growth: 1.09,
    bossEvery: 5,
    bossMult: 1.6,
    weakMult: 1.4,
    failCooldownMs: 30_000,
    winCooldownMs: 0,
    basePower: 30,
    perLevel: 6,
    perGear: 0.04,
    perClick: 0.01,
    clickCap: 100,
    coinSecs: 20,
    coinSecsPerFloor: 4,
    bossDiamonds: 1,
    milestoneEvery: 10,
    milestoneDiamonds: 3,
    battle: {
      stepMs: 1000 / 60,
      countdownMs: 2000,
      timeLimitMs: 45_000,
      half: 34,
      playerR: 0.7,
      playerSpeed: 8,
      hp: 100,
      invincibleMs: 400,
      bossHp: 100,
      bossR: 2,
      bossSpeed: 4,
      playerFireMs: 500,
      shotDmg: 2,
      shotSpeed: 24,
      shotLife: 2.2,
      shotR: 0.4,
      ratioMin: 0.2,
      ratioMax: 8,
      /** 보스 탄: 발사 간격(ms) = max(fireMin, fireBase − fireStep × 층), 피해 = min(dmgMax, dmgBase + dmgStep × 층), 속도 = min(speedMax, speedBase + speedStep × 층) */
      fireBase: 1300,
      fireMin: 320,
      fireStep: 9,
      dmgBase: 10,
      dmgMax: 35,
      dmgStep: 0.15,
      speedBase: 9,
      speedMax: 22,
      speedStep: 0.09,
      enemyShotR: 0.5,
      /**
       * 한 번에 쏘는 탄 수 = min(fanMax, 1 + 층 ÷ fanEvery)(체력이 절반 아래이거나 보스층이면 +1), 탄 사이 각도 spread.
       * 플레이어가 움직이는 쪽을 leadFactor만큼 앞서 겨눈다. 보스층은 ringEvery번째 발사마다,
       * ringFromFloor층부터는 ringEveryNormal번째 발사마다 사방(ringCount발)으로 퍼진다.
       */
      leadFactor: 0.7,
      fanEvery: 10,
      fanMax: 6,
      spread: 0.2,
      ringEvery: 4,
      ringEveryNormal: 5,
      ringFromFloor: 15,
      ringCount: 10,
      ringCountPerFloor: 0.2,
      ringCountMax: 40,
      /** spiralFromFloor층부터는 발사마다 돌아가는 방향으로 탄이 하나 더 나간다 */
      spiralFromFloor: 30,
      /** 승산 표시 기준: 전투력 비율이 이 값 이상이면 해당 난이도 */
      easyRatio: 1.6,
      normalRatio: 1.1,
      hardRatio: 0.75,
    },
  },
  /**
   * 피켓팅: 오픈 시각(무작위 대기)에 누르는 반응속도(최대 reactionMax점) + 보안문자 입력(맞히면 captchaBase + 빠를수록 최대 captchaSpeed점).
   * 오픈 전에 누르면 반응 점수 0. 점수가 failBelow 미만이면 매진(보상 없음), 이상이면 다음 공연 코인이 (1 + 점수/1000)배, boostMs 안에 한 번.
   */
  ticketing: {
    waitMs: [1500, 4000],
    reactionBestMs: 150,
    reactionWorstMs: 1000,
    reactionMax: 500,
    captchaMs: 10_000,
    captchaDigits: 5,
    captchaBase: 300,
    captchaSpeed: 200,
    failBelow: 300,
    boostMs: 30 * 60_000,
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
  /** 어둠속성일 때만 입장할 수 있는 비밀 공연장. 앞 공연장을 클리어하기 전에는 목록에 보이지 않는다. */
  darkOnly?: boolean;
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
  // 월클 이후의 비밀 공연장(사용자 요청으로 추가). 어둠속성으로만 입장하고 수치는 월클에서 이어지게 잡은 제안값이다.
  { id: 'rooftop', fans: 250000, firstClearCoins: 300000, firstClearDiamonds: 100, baseCoins: 15000, darkOnly: true },
  { id: 'ruins', fans: 500000, firstClearCoins: 800000, firstClearDiamonds: 150, baseCoins: 40000, darkOnly: true },
  { id: 'garage', fans: 1000000, firstClearCoins: 2000000, firstClearDiamonds: 200, baseCoins: 100000, darkOnly: true },
];

export const STAGE_IDS: readonly StageId[] = STAGES.map((s) => s.id);

/**
 * 임시: 팬 수·앞 공연장 클리어 조건 없이 입장할 수 있는 공연장. 새 직접 공연(소형 공연장 무대 세팅 블록, 단콘 응원봉 머지 웨이브)을 해 보려고 연다.
 * 되돌릴 때는 배열을 비운다. (원래 조건: 소형 공연장 팬 1,200명 + 지하 클럽 클리어, 단콘 팬 3,000명 + 소형 공연장 클리어, 쿨다운·속성 조건은 그대로)
 */
export const TEMP_OPEN_STAGES: readonly StageId[] = ['hall', 'solo'];

/** 직접 공연 종류. 적혀 있지 않은 공연장은 마이크 타이밍이다. */
export type ManualGame = 'timing' | 'run' | 'blocks' | 'merge';
const STAGE_GAMES: Partial<Record<StageId, ManualGame>> = { club: 'run', hall: 'blocks', solo: 'merge', ruins: 'run' };
export const manualGameOf = (id: StageId): ManualGame => STAGE_GAMES[id] ?? 'timing';
export const LAST_STAGE: StageId = STAGES[STAGES.length - 1].id;
/** 일반 공연장의 마지막. 이걸 클리어하면 비밀 공연장이 열린다. */
export const WORLD_STAGE: StageId = 'world';
export const SECRET_STAGE_IDS: readonly StageId[] = STAGES.filter((s) => s.darkOnly).map((s) => s.id);
/** 이 공연장을 처음 클리어하면 「첫 투어 완료」 카드가 뜬다. 이후 공연장은 그 너머의 확장 콘텐츠다. */
export const TOUR_STAGE: StageId = 'hall';

export const EQUIPMENT_KINDS: readonly EquipmentKind[] = ['mic', 'studio', 'promotion'];
export const DIAMOND_UPGRADE_KINDS: readonly DiamondUpgradeKind[] = ['production', 'royalty', 'offline'];
export const STREAM_PLATFORMS: readonly StreamPlatform[] = ['spotify', 'ytmusic', 'melon', 'applemusic'];

export const SNACK_IDS = Object.keys(BALANCE.shop.snacks) as SnackId[];
export const CAMPAIGN_IDS = Object.keys(BALANCE.shop.campaigns) as CampaignId[];
export const THEME_IDS = Object.keys(BALANCE.shop.themes) as ThemeId[];
export const COSTUME_IDS = Object.keys(BALANCE.shop.costumes) as CostumeId[];
const DARK_COSTUMES: readonly DarkCostumeId[] = ['dbunny', 'band', 'king', 'milk', 'dbear', 'postman', 'cultist', 'clown', 'dnurse', 'dbride'];
/** 코스튬이 어느 자아의 것인지 */
export const costumePersona = (id: CostumeId): Persona => ((DARK_COSTUMES as readonly CostumeId[]).includes(id) ? 'dark' : 'normal');
/** 자아별 코스튬(상점 표시 순서) */
export const COSTUME_IDS_OF: Record<Persona, CostumeId[]> = {
  normal: COSTUME_IDS.filter((id) => costumePersona(id) === 'normal'),
  dark: COSTUME_IDS.filter((id) => costumePersona(id) === 'dark'),
};
export const POST_KINDS = Object.keys(BALANCE.monogram.kinds) as PostKind[];

/* ---------- 콘텐츠 팩 2: 카드·NPC·가사 카드 표 ---------- */

export const CARD_RARITIES: readonly CardRarity[] = ['N', 'R', 'SR', 'SSR'];

/** 포토카드 ID는 `p{세트}-{등급}` */
export const PHOTO_SETS = BALANCE.photo.setBonus.length;
export const PHOTO_GRADES = BALANCE.photo.rates.length;
export const photoCardId = (set: number, grade: number): string => `p${set}-${grade}`;
export const PHOTO_CARD_IDS: readonly string[] = Array.from({ length: PHOTO_SETS }, (_, i) =>
  Array.from({ length: PHOTO_GRADES }, (_, j) => photoCardId(i + 1, j + 1)),
).flat();

export interface FeatDef {
  id: string;
  rarity: CardRarity;
  vibe: Vibe;
}
/** 피처링 래퍼. 이름·소개는 content.ts */
export const FEAT_NPCS: readonly FeatDef[] = [
  { id: 'f-alfrado', rarity: 'N', vibe: 'rhyme' },
  { id: 'f-haname', rarity: 'N', vibe: 'coin' },
  { id: 'f-seungcheon', rarity: 'N', vibe: 'fan' },
  { id: 'f-0ik2', rarity: 'N', vibe: 'power' },
  { id: 'f-saerim', rarity: 'N', vibe: 'rhyme' },
  { id: 'f-gangyusi', rarity: 'R', vibe: 'coin' },
  { id: 'f-upia', rarity: 'R', vibe: 'rhyme' },
  { id: 'f-feiz', rarity: 'R', vibe: 'fan' },
  { id: 'f-p4rki', rarity: 'R', vibe: 'power' },
  { id: 'f-nunalgogi', rarity: 'R', vibe: 'coin' },
  { id: 'f-sohee', rarity: 'SR', vibe: 'rhyme' },
  { id: 'f-truman', rarity: 'SR', vibe: 'coin' },
  { id: 'f-pshine', rarity: 'SR', vibe: 'fan' },
  { id: 'f-ch1tkey', rarity: 'SR', vibe: 'power' },
  { id: 'f-k4ton', rarity: 'SR', vibe: 'rhyme' },
  { id: 'f-rtw', rarity: 'SR', vibe: 'fan' },
  { id: 'f-scails', rarity: 'SSR', vibe: 'rhyme' },
  { id: 'f-hamo', rarity: 'SSR', vibe: 'fan' },
  { id: 'f-ghostclub', rarity: 'SSR', vibe: 'power' },
  { id: 'f-choisung', rarity: 'SSR', vibe: 'coin' },
  { id: 'f-ruru', rarity: 'SSR', vibe: 'rhyme' },
];
/** 12명 시절의 ID → 지금 ID. 예전 저장을 읽을 때 같은 등급 자리로 옮긴다(별·장착 유지). */
export const FEAT_LEGACY_IDS: Readonly<Record<string, string>> = {
  'f-han': 'f-alfrado',
  'f-conv': 'f-haname',
  'f-bus': 'f-seungcheon',
  'f-roof': 'f-0ik2',
  'f-rain': 'f-saerim',
  'f-pc': 'f-gangyusi',
  'f-study': 'f-upia',
  'f-diary': 'f-feiz',
  'f-dawn': 'f-p4rki',
  'f-moon': 'f-scails',
  'f-heart': 'f-hamo',
  'f-void': 'f-ghostclub',
};
export const FEAT_IDS: readonly string[] = FEAT_NPCS.map((n) => n.id);
export const featDefById = (id: string): FeatDef | undefined => FEAT_NPCS.find((n) => n.id === id);

export type Vowel = 'a' | 'eo' | 'o' | 'u' | 'i' | 'any';
export const VOWELS: readonly Exclude<Vowel, 'any'>[] = ['a', 'eo', 'o', 'u', 'i'];
/** draw 한 장 더 뽑기 · double 다음 카드 위력 2배 · energy 에너지 +1 · keep 체인이 한 번 끊기지 않게 지킴 */
export type LyricEffect = 'draw' | 'double' | 'energy' | 'keep';
export interface LyricCardDef {
  id: string;
  vowel: Vowel;
  cost: number;
  power: number;
  effect?: LyricEffect;
  /** 보상 후보로 나오는 무게(0이면 시작 덱 전용) */
  weight: number;
}
const vowelCards = (v: Exclude<Vowel, 'any'>): LyricCardDef[] => [
  { id: `l-${v}1`, vowel: v, cost: 1, power: 5, weight: 0 },
  { id: `l-${v}2`, vowel: v, cost: 1, power: 7, weight: 5 },
  { id: `l-${v}3`, vowel: v, cost: 2, power: 14, weight: 3 },
];
export const LYRIC_CARDS: readonly LyricCardDef[] = [
  ...VOWELS.flatMap(vowelCards),
  { id: 'l-wild', vowel: 'any', cost: 1, power: 4, weight: 0 },
  { id: 'l-breath', vowel: 'any', cost: 0, power: 0, effect: 'draw', weight: 0 },
  { id: 'l-adlib', vowel: 'any', cost: 0, power: 3, effect: 'draw', weight: 4 },
  { id: 'l-hook', vowel: 'any', cost: 1, power: 6, effect: 'double', weight: 3 },
  { id: 'l-bridge', vowel: 'any', cost: 1, power: 4, effect: 'keep', weight: 3 },
  { id: 'l-sweat', vowel: 'any', cost: 0, power: 2, effect: 'energy', weight: 2 },
  { id: 'l-punch', vowel: 'any', cost: 2, power: 18, weight: 1 },
];
export const lyricCardById = (id: string): LyricCardDef | undefined => LYRIC_CARDS.find((c) => c.id === id);
export const LYRIC_CARD_IDS: readonly string[] = LYRIC_CARDS.map((c) => c.id);

/* ---------- 미션 ---------- */

/** 미션 진행도를 재는 지표. 값은 selectors의 metricValue()가 상태에서 읽는다. */
export type MissionMetric = Extract<CounterKey, 'works' | 'buys' | 'concerts' | 'claims' | 'snacks' | 'posts' | 'mails' | 'arcades' | 'pets' | 'pulls'>;
export interface MissionDef {
  id: string;
  scope: 'daily' | 'weekly';
  metric: MissionMetric;
  goal: number;
  diamonds: number;
}
export const MISSIONS: readonly MissionDef[] = [
  { id: 'd-work', scope: 'daily', metric: 'works', goal: 100, diamonds: 1 },
  { id: 'd-buy', scope: 'daily', metric: 'buys', goal: 1, diamonds: 1 },
  { id: 'd-concert', scope: 'daily', metric: 'concerts', goal: 2, diamonds: 1 },
  { id: 'd-post', scope: 'daily', metric: 'posts', goal: 2, diamonds: 1 },
  { id: 'd-mail', scope: 'daily', metric: 'mails', goal: 2, diamonds: 1 },
  { id: 'd-arcade', scope: 'daily', metric: 'arcades', goal: 3, diamonds: 1 },
  { id: 'd-pet', scope: 'daily', metric: 'pets', goal: 2, diamonds: 1 },
  { id: 'w-work', scope: 'weekly', metric: 'works', goal: 3000, diamonds: 5 },
  { id: 'w-concert', scope: 'weekly', metric: 'concerts', goal: 15, diamonds: 6 },
  { id: 'w-post', scope: 'weekly', metric: 'posts', goal: 15, diamonds: 5 },
  { id: 'w-mail', scope: 'weekly', metric: 'mails', goal: 10, diamonds: 4 },
  { id: 'w-snack', scope: 'weekly', metric: 'snacks', goal: 5, diamonds: 4 },
  { id: 'w-claim', scope: 'weekly', metric: 'claims', goal: 5, diamonds: 4 },
  { id: 'w-arcade', scope: 'weekly', metric: 'arcades', goal: 15, diamonds: 5 },
  { id: 'w-pull', scope: 'weekly', metric: 'pulls', goal: 10, diamonds: 4 },
];
export const MISSION_METRICS: readonly MissionMetric[] = [...new Set(MISSIONS.map((m) => m.metric))];

/* ---------- 업적 ---------- */

/** 업적 조건을 재는 지표. 값은 selectors의 achievementValue()가 상태에서 읽는다. */
export type AchievementMetric =
  | CounterKey
  | 'singles'
  | 'albums'
  | 'fans'
  | 'level'
  | 'stages'
  | 'tour'
  | 'world'
  | 'secrets'
  | 'maxedEquip'
  | 'upgradeLevels'
  | 'themes'
  | 'streams'
  | 'photoCards'
  | 'photoSets'
  | 'featOwned'
  | 'mascotStage'
  | 'towerBest'
  | 'survivalBest'
  | 'lyricBest'
  | 'ticketBest'
  | 'ssrCards';
export interface AchievementDef {
  id: string;
  metric: AchievementMetric;
  goal: number;
  /** 달성하면 한 번 받는 다이아 */
  diamonds: number;
}
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-verse', metric: 'works', goal: 1, diamonds: 1 },
  { id: 'hands', metric: 'works', goal: 1000, diamonds: 3 },
  { id: 'grind', metric: 'works', goal: 10000, diamonds: 10 },
  { id: 'dawn-rapper', metric: 'dawnWorks', goal: 30, diamonds: 5 },
  { id: 'debut', metric: 'singles', goal: 1, diamonds: 2 },
  { id: 'five-singles', metric: 'singles', goal: 5, diamonds: 4 },
  { id: 'ten-singles', metric: 'singles', goal: 10, diamonds: 8 },
  { id: 'album-1', metric: 'albums', goal: 1, diamonds: 5 },
  { id: 'album-3', metric: 'albums', goal: 3, diamonds: 20 },
  { id: 'fans-100', metric: 'fans', goal: 100, diamonds: 2 },
  { id: 'fans-1k', metric: 'fans', goal: 1000, diamonds: 5 },
  { id: 'fans-10k', metric: 'fans', goal: 10000, diamonds: 15 },
  { id: 'fans-100k', metric: 'fans', goal: 100000, diamonds: 40 },
  { id: 'level-10', metric: 'level', goal: 10, diamonds: 4 },
  { id: 'level-30', metric: 'level', goal: 30, diamonds: 12 },
  { id: 'level-60', metric: 'level', goal: 60, diamonds: 30 },
  { id: 'seized-1', metric: 'seizures', goal: 1, diamonds: 2 },
  { id: 'seized-10', metric: 'seizures', goal: 10, diamonds: 6 },
  { id: 'stage-1', metric: 'stages', goal: 1, diamonds: 2 },
  { id: 'tour', metric: 'tour', goal: 1, diamonds: 5 },
  { id: 'world', metric: 'world', goal: 1, diamonds: 20 },
  { id: 'secret-1', metric: 'secrets', goal: 1, diamonds: 15 },
  { id: 'secret-3', metric: 'secrets', goal: 3, diamonds: 30 },
  { id: 'equip-max', metric: 'maxedEquip', goal: 1, diamonds: 5 },
  { id: 'equip-max-3', metric: 'maxedEquip', goal: 3, diamonds: 15 },
  { id: 'upgrades-20', metric: 'upgradeLevels', goal: 20, diamonds: 6 },
  { id: 'snack-10', metric: 'snacks', goal: 10, diamonds: 3 },
  { id: 'snack-50', metric: 'snacks', goal: 50, diamonds: 8 },
  { id: 'campaign-5', metric: 'campaigns', goal: 5, diamonds: 4 },
  { id: 'post-1', metric: 'posts', goal: 1, diamonds: 2 },
  { id: 'post-30', metric: 'posts', goal: 30, diamonds: 6 },
  { id: 'viral-1', metric: 'virals', goal: 1, diamonds: 5 },
  { id: 'viral-10', metric: 'virals', goal: 10, diamonds: 15 },
  { id: 'mail-10', metric: 'mails', goal: 10, diamonds: 3 },
  { id: 'mail-50', metric: 'mails', goal: 50, diamonds: 8 },
  { id: 'anti-5', metric: 'antiMails', goal: 5, diamonds: 4 },
  { id: 'mission-20', metric: 'missions', goal: 20, diamonds: 5 },
  { id: 'mission-100', metric: 'missions', goal: 100, diamonds: 20 },
  { id: 'streak-7', metric: 'bestStreak', goal: 7, diamonds: 8 },
  { id: 'streak-30', metric: 'bestStreak', goal: 30, diamonds: 25 },
  { id: 'themes-3', metric: 'themes', goal: 3, diamonds: 6 },
  { id: 'streams-100k', metric: 'streams', goal: 100000, diamonds: 5 },
  { id: 'streams-10m', metric: 'streams', goal: 10000000, diamonds: 15 },
  // 콘텐츠 팩 2
  { id: 'rhythm-1', metric: 'rhythms', goal: 1, diamonds: 2 },
  { id: 'rhythm-30', metric: 'rhythms', goal: 30, diamonds: 8 },
  { id: 'survival-1', metric: 'survivals', goal: 1, diamonds: 2 },
  { id: 'survival-s', metric: 'survivalBest', goal: 900, diamonds: 10 },
  { id: 'lyric-1', metric: 'lyrics', goal: 1, diamonds: 2 },
  { id: 'lyric-s', metric: 'lyricBest', goal: 900, diamonds: 8 },
  { id: 'tower-10', metric: 'towerBest', goal: 10, diamonds: 5 },
  { id: 'tower-30', metric: 'towerBest', goal: 30, diamonds: 15 },
  { id: 'tower-60', metric: 'towerBest', goal: 60, diamonds: 40 },
  { id: 'ticket-1', metric: 'ticketings', goal: 1, diamonds: 2 },
  { id: 'ticket-ace', metric: 'ticketBest', goal: 900, diamonds: 6 },
  { id: 'pull-10', metric: 'pulls', goal: 10, diamonds: 3 },
  { id: 'pull-100', metric: 'pulls', goal: 100, diamonds: 12 },
  { id: 'photo-12', metric: 'photoCards', goal: 12, diamonds: 4 },
  { id: 'photo-36', metric: 'photoCards', goal: 36, diamonds: 25 },
  { id: 'photoset-1', metric: 'photoSets', goal: 1, diamonds: 6 },
  { id: 'photoset-6', metric: 'photoSets', goal: 6, diamonds: 30 },
  { id: 'feat-5', metric: 'featOwned', goal: 5, diamonds: 4 },
  // id는 12명 시절 그대로 둔다(저장된 달성 기록과 칭호가 id로 이어진다). 목표는 지금 래퍼 전원.
  { id: 'feat-12', metric: 'featOwned', goal: FEAT_NPCS.length, diamonds: 20 },
  { id: 'card-ssr', metric: 'ssrCards', goal: 1, diamonds: 6 },
  { id: 'pet-adult', metric: 'mascotStage', goal: 3, diamonds: 5 },
  { id: 'pet-legend', metric: 'mascotStage', goal: 4, diamonds: 15 },
  { id: 'pet-20', metric: 'pets', goal: 20, diamonds: 3 },
  { id: 'challenge-1', metric: 'challenges', goal: 1, diamonds: 2 },
  { id: 'challenge-10', metric: 'challenges', goal: 10, diamonds: 8 },
  { id: 'chart-10', metric: 'chartTop10', goal: 1, diamonds: 5 },
  { id: 'chart-no1', metric: 'chartNo1', goal: 1, diamonds: 20 },
  { id: 'trade-1', metric: 'trades', goal: 1, diamonds: 3 },
];
