import { BALANCE, SECRET_STAGE_IDS, STAGES, STREAM_PLATFORMS, TOUR_STAGE, WORLD_STAGE, type AchievementMetric, type MissionMetric } from './balance';
import { ALBUM_CATALOG, singleTitle, type AlbumDef } from './content';
import { bonuses, completedSets, mascotStage, photoDistinct, songCardOf, type BonusState } from './packdata';
import type { CounterKey, DiamondUpgradeKind, Equipment, EquipmentKind, GameState, Persona, StageId, Streaming } from './types';

const P = BALANCE.persona;

export function clampResource(n: number): number {
  if (!Number.isFinite(n) || n < 0) return n > 0 ? BALANCE.maxResource : 0;
  return Math.min(n, BALANCE.maxResource);
}

/* ---------- 파생 값: 원본 데이터에서만 계산한다 ---------- */

/* 장비는 속성마다 따로 있다. 일반속성은 equipment·musicPower, 어둠속성은 darkEquipment·dripPower를 쓰고
 * 각각 자기 속성에서만 효과가 난다. */

export const equipmentOf = (s: Pick<GameState, 'equipment' | 'darkEquipment'>, persona: Persona): Equipment =>
  persona === 'normal' ? s.equipment : s.darkEquipment;

/** 그 속성의 클릭 업그레이드 레벨 (일반: 순수 음악력, 어둠: 음지 드립력) */
export const clickPowerOf = (s: Pick<GameState, 'musicPower' | 'dripPower'>, persona: Persona): number =>
  persona === 'normal' ? s.musicPower : s.dripPower;

export const equipmentDef = (persona: Persona) => (persona === 'normal' ? BALANCE.equipment : BALANCE.darkEquipment);
const clickDef = (persona: Persona) => (persona === 'normal' ? BALANCE.musicPower : BALANCE.dripPower);

/** 그 속성 장비(마이크·작업실)가 주는 생산배율 */
export function productionMultiplier(s: Pick<GameState, 'equipment' | 'darkEquipment'>, persona: Persona): number {
  const e = equipmentOf(s, persona);
  return 1 + BALANCE.production.micPerLevel * e.mic + BALANCE.production.studioPerLevel * e.studio;
}

/** 다이아 전용 업그레이드가 주는 배율. 두 자아 모두, 자동 생산과 작업하기 라임 모두에 곱해진다. */
export const diamondProductionMult = (s: Pick<GameState, 'diamondUpgrades'>): number =>
  1 + BALANCE.diamond.upgrade.production.perLevel * s.diamondUpgrades.production;
export const diamondRoyaltyMult = (s: Pick<GameState, 'diamondUpgrades'>): number =>
  1 + BALANCE.diamond.upgrade.royalty.perLevel * s.diamondUpgrades.royalty;

/* ---------- 상점 버프 ---------- */

/** 지금(정산된 시각) 켜져 있는 간식의 작업하기 라임 배율. 없거나 끝났으면 1. */
export function snackMult(s: Pick<GameState, 'buffs' | 'lastSettledAt'>): number {
  const b = s.buffs.snack;
  return b && b.until > s.lastSettledAt ? 1 + BALANCE.shop.snacks[b.id].bonus : 1;
}

/** 지금 켜져 있는 홍보 캠페인의 팬 획득 배율. 없거나 끝났으면 1. */
export function campaignMult(s: Pick<GameState, 'buffs' | 'lastSettledAt'>): number {
  const b = s.buffs.campaign;
  return b && b.until > s.lastSettledAt ? BALANCE.shop.campaigns[b.id].mult : 1;
}

/** 상점 코인 가격: 기본가 × 25 × (1 + 0.25 × (플레이어 레벨 − 1)) */
export function shopPrice(base: number, fans: number): number {
  return Math.ceil(base * BALANCE.shop.priceMult * (1 + BALANCE.shop.priceLevelStep * (playerLevel(fans) - 1)));
}

/** 오프라인 정산으로 인정하는 최대 시간(ms). 기본 2시간 + 다이아 업그레이드. */
export function offlineCapMs(s: Pick<GameState, 'diamondUpgrades'> & Partial<BonusState>): number {
  const u = BALANCE.diamond.upgrade.offline;
  const extra = s.cards && s.photo && s.feat && s.mascot && s.singles ? bonuses(s as BonusState).offlineMs : 0;
  return BALANCE.offline.capMs + u.perLevelMs * s.diamondUpgrades.offline + extra;
}

/** 수집품(곡 카드·피처링·포토 세트·마스코트)이 주는 그 자아의 라임 생산 배율 */
export const collectionProductionMult = (s: BonusState, persona: Persona): number => 1 + bonuses(s).rhyme[persona];

/** 싱글·앨범·모노그램으로 얻는 팬에 곱하는 배율: 홍보 캠페인 × 수집 팬 보너스 */
export const fanGainMult = (s: Pick<GameState, 'buffs' | 'lastSettledAt'> & BonusState): number => campaignMult(s) * (1 + bonuses(s).fan);

type ClickState = Pick<
  GameState,
  'equipment' | 'darkEquipment' | 'musicPower' | 'dripPower' | 'activePersona' | 'diamondUpgrades' | 'buffs' | 'lastSettledAt'
> &
  BonusState;

/** 작업하기 한 번에 얻는 기본 라임(생산배율 곱하기 전). 그 속성의 클릭 업그레이드 레벨당 늘어난다. */
export function clickValue(s: ClickState, persona: Persona = s.activePersona): number {
  return BALANCE.click.value + clickDef(persona).clickPerLevel * clickPowerOf(s, persona);
}

/** 작업하기 한 번에 실제로 얻는 라임 = 기본 라임 × 그 속성의 생산배율 × 다이아 생산 증폭 × 간식 */
export const clickGain = (s: ClickState, persona: Persona = s.activePersona): number =>
  clickValue(s, persona) * productionMultiplier(s, persona) * diamondProductionMult(s) * snackMult(s) * collectionProductionMult(s, persona);

export function playerLevel(fans: number): number {
  return 1 + Math.floor(Math.sqrt(fans / BALANCE.level.fansPerStep));
}

export const singleCount = (s: GameState) => s.singles.length;
export const albumCount = (s: GameState) => s.albums.length;

export function isPenaltyActive(s: GameState, at: number = s.lastSettledAt): boolean {
  return at < s.recoveryPenaltyUntil;
}

/** 현재(혹은 at 시점) 상태에서의 라임 초당 생산량. 효율(오프라인)은 곱하지 않는다. */
export function rhymeRate(s: GameState, persona: Persona = s.activePersona, at: number = s.lastSettledAt): number {
  const mult = productionMultiplier(s, persona) * diamondProductionMult(s) * collectionProductionMult(s, persona);
  if (persona === 'normal') {
    return P.normalRate * mult * (isPenaltyActive(s, at) ? P.recoveryPenalty : 1);
  }
  return (s.heat < P.hotThreshold ? P.darkRate : P.darkHotRate) * mult;
}

export interface RoyaltyBreakdown {
  perSec: number;
  fans: number;
  promotionMult: number;
  albumMult: number;
  personaMult: number;
  /** 다이아 인세 증폭 */
  diamondMult: number;
  /** 수집품(곡 카드·피처링·포토 세트) 인세 보너스 */
  collectionMult: number;
}

export function royaltyBreakdown(s: GameState, persona: Persona = s.activePersona): RoyaltyBreakdown {
  const promotionMult = 1 + BALANCE.royalty.promotionPerLevel * equipmentOf(s, persona).promotion;
  const albumMult = 1 + albumRoyaltyBonus(s.albums.length);
  const personaMult = persona === 'normal' ? P.normalRoyaltyMult : P.darkRoyaltyMult;
  const diamondMult = diamondRoyaltyMult(s);
  const collectionMult = 1 + bonuses(s).coin;
  return {
    perSec: s.fans * BALANCE.royalty.perFan * promotionMult * albumMult * personaMult * diamondMult * collectionMult,
    fans: s.fans,
    promotionMult,
    albumMult,
    personaMult,
    diamondMult,
    collectionMult,
  };
}

export const royaltyRate = (s: GameState, persona: Persona = s.activePersona) => royaltyBreakdown(s, persona).perSec;

/* ---------- 스트리밍 ---------- */

/** 초당 스트리밍 = 팬 수 × perFanPerSec. 자아·장비와 무관하다. */
export const streamRate = (s: Pick<GameState, 'fans'>): number => s.fans * BALANCE.streaming.perFanPerSec;

export const streamTotal = (st: Streaming): number => STREAM_PLATFORMS.reduce((sum, p) => sum + st.totals[p], 0);

/** 아직 코인으로 정산하지 않은 스트리밍 */
export const streamsPending = (st: Streaming): number => Math.max(0, streamTotal(st) - st.settled);

export interface StreamClaimStatus {
  /** 정산 대기 스트리밍 */
  pending: number;
  /** 지금 정산하면 받는 코인 */
  coins: number;
  /** 다음 정산까지 남은 시간(ms). 0이면 간격은 지났다. */
  waitMs: number;
  /** 간격이 지났고 받을 코인이 있다 */
  ready: boolean;
}

/** 정산 상태. 시계는 정산이 끝난 state.lastSettledAt을 쓴다. */
export function streamClaimStatus(s: GameState): StreamClaimStatus {
  const pending = streamsPending(s.streaming);
  const coins = Math.floor(pending / BALANCE.streaming.streamsPerCoin + 1e-9);
  const waitMs = Math.max(0, s.streaming.lastClaimAt + BALANCE.streaming.claimIntervalMs - s.lastSettledAt);
  return { pending, coins, waitMs, ready: waitMs === 0 && coins > 0 };
}

/* ---------- 싱글 ---------- */

export interface SinglePreview {
  /** 이 자아로 이미 낸 싱글 수(비용·효과 공식의 n) */
  n: number;
  /** 이 자아로 내는 몇 번째 싱글인지(1부터) */
  ordinal: number;
  persona: Persona;
  title: string;
  needRhymes: number;
  haveRhymes: number;
  coins: number;
  fans: number;
  affordable: boolean;
}

/** n: 해당 자아로 이미 낸 싱글 수 */
export function singleNeed(persona: Persona, n: number): number {
  const c = BALANCE.single[persona];
  return Math.ceil(c.rhymeBase * c.rhymeGrowth ** n);
}
export function singleCoins(persona: Persona, n: number): number {
  const c = BALANCE.single[persona];
  return Math.floor(c.coinBase * c.coinGrowth ** n);
}
export function singleFans(persona: Persona, n: number): number {
  const c = BALANCE.single[persona];
  return Math.ceil(c.fanBase * c.fanGrowth ** n);
}

export function rhymesOf(s: GameState, persona: Persona): number {
  return persona === 'normal' ? s.normalRhymes : s.darkRhymes;
}

export function previewSingle(s: GameState, persona: Persona = s.activePersona): SinglePreview {
  const personaIndex = s.singles.filter((x) => x.persona === persona).length;
  const n = personaIndex;
  const needRhymes = singleNeed(persona, n);
  const haveRhymes = rhymesOf(s, persona);
  return {
    n,
    ordinal: personaIndex + 1,
    persona,
    title: singleTitle(
      persona,
      personaIndex,
      s.singles.map((x) => x.title),
    ),
    needRhymes,
    haveRhymes,
    coins: singleCoins(persona, n),
    fans: singleFans(persona, n),
    affordable: Number.isFinite(needRhymes) && haveRhymes >= needRhymes && s.singles.length < BALANCE.maxSingles,
  };
}

/* ---------- 앨범 ---------- */

/** 앨범 count장을 냈을 때 인세 배율에 더해지는 누적 값 (8% → +10% → +12% … 합산) */
export const albumRoyaltyBonus = (count: number): number => BALANCE.royalty.perAlbum.slice(0, count).reduce((a, b) => a + b, 0);
/** i번째(0부터) 앨범 하나가 더하는 값 */
export const albumRoyaltyOf = (i: number): number => BALANCE.royalty.perAlbum[i] ?? 0;
export const albumCost = (a: number): number => BALANCE.album.costs[a];
export const albumFans = (a: number): number => BALANCE.album.fans[a];

export interface AlbumPreview {
  /** 이번에 낼 앨범의 순번(0부터) */
  index: number;
  def: AlbumDef;
  cost: number;
  fans: number;
  affordable: boolean;
}

/** 다음에 낼 앨범. 카탈로그를 모두 냈으면 null. */
export function previewAlbum(s: GameState): AlbumPreview | null {
  const index = s.albums.length;
  const def = ALBUM_CATALOG[index];
  if (!def) return null;
  const cost = albumCost(index);
  return { index, def, cost, fans: albumFans(index), affordable: s.coins >= cost };
}

/* ---------- 장비 ---------- */

export function equipmentCost(kind: EquipmentKind, level: number, persona: Persona = 'normal'): number {
  const def = equipmentDef(persona)[kind];
  return Math.ceil(def.base * def.growth ** level);
}

export interface EquipmentPreview {
  kind: EquipmentKind;
  persona: Persona;
  level: number;
  maxed: boolean;
  cost: number;
  /** 구매 전/후 표시 값 (생산배율 또는 인세 배율 계수) */
  before: number;
  after: number;
  /** 그 속성 기준 초당 생산 또는 수입의 전/후 */
  rateBefore: number;
  rateAfter: number;
  rateLabel: '라임/초' | '코인/초';
}

/** 그 속성 장비 한 종류를 한 레벨 올린 상태 */
function withEquipmentLevel(s: GameState, persona: Persona, kind: EquipmentKind, level: number): GameState {
  return persona === 'normal'
    ? { ...s, equipment: { ...s.equipment, [kind]: level } }
    : { ...s, darkEquipment: { ...s.darkEquipment, [kind]: level } };
}

export function previewEquipment(s: GameState, kind: EquipmentKind, persona: Persona = 'normal'): EquipmentPreview {
  const level = equipmentOf(s, persona)[kind];
  const maxLevel = equipmentDef(persona).maxLevel;
  const maxed = level >= maxLevel;
  const next = withEquipmentLevel(s, persona, kind, Math.min(level + 1, maxLevel));
  if (kind === 'promotion') {
    return {
      kind,
      persona,
      level,
      maxed,
      cost: equipmentCost(kind, level, persona),
      before: 1 + BALANCE.royalty.promotionPerLevel * level,
      after: 1 + BALANCE.royalty.promotionPerLevel * equipmentOf(next, persona).promotion,
      rateBefore: royaltyRate(s, persona),
      rateAfter: royaltyRate(next, persona),
      rateLabel: '코인/초',
    };
  }
  return {
    kind,
    persona,
    level,
    maxed,
    cost: equipmentCost(kind, level, persona),
    before: productionMultiplier(s, persona),
    after: productionMultiplier(next, persona),
    rateBefore: rhymeRate(s, persona),
    rateAfter: rhymeRate(next, persona),
    rateLabel: '라임/초',
  };
}

/* ---------- 클릭 업그레이드 (일반: 순수 음악력, 어둠: 음지 드립력) ---------- */

/** level: 지금 레벨. 다음 레벨로 올리는 비용(코인)을 돌려준다. */
export function musicPowerCost(level: number, persona: Persona = 'normal'): number {
  const c = clickDef(persona);
  return Math.ceil(c.base * c.growth ** level);
}

export interface MusicPowerPreview {
  persona: Persona;
  level: number;
  cost: number;
  affordable: boolean;
  /** 그 속성에서 작업하기 한 번에 얻는 라임(생산배율 포함)의 올리기 전/후 */
  gainBefore: number;
  gainAfter: number;
}

export function previewMusicPower(s: GameState, persona: Persona = 'normal'): MusicPowerPreview {
  const level = clickPowerOf(s, persona);
  const cost = musicPowerCost(level, persona);
  const next = persona === 'normal' ? { ...s, musicPower: level + 1 } : { ...s, dripPower: level + 1 };
  return {
    persona,
    level,
    cost,
    affordable: Number.isFinite(cost) && s.coins >= cost,
    gainBefore: clickGain(s, persona),
    gainAfter: clickGain(next, persona),
  };
}

/** 작업실 외형 단계: 그 속성 작업실 레벨 5마다 한 단계. 기본은 지금 자아의 작업실을 본다. */
export function roomTier(s: Pick<GameState, 'equipment' | 'darkEquipment' | 'activePersona'>, persona: Persona = s.activePersona): number {
  return Math.min(4, Math.floor(equipmentOf(s, persona).studio / 5));
}

/* ---------- 다이아 ---------- */

/** 플레이어 레벨이 fansBefore → fansAfter로 오르면서 받는 다이아 */
export function levelUpDiamonds(fansBefore: number, fansAfter: number): number {
  return Math.max(0, playerLevel(fansAfter) - playerLevel(fansBefore)) * BALANCE.diamond.levelUp;
}

/** 다이아 전용 업그레이드 한 종류의 최대 레벨. 오프라인 확장만 따로 정해져 있다. */
export const diamondUpgradeMaxLevel = (kind: DiamondUpgradeKind): number =>
  kind === 'offline' ? BALANCE.diamond.upgrade.offline.maxLevel : BALANCE.diamond.upgrade.maxLevel;

/** 다이아 전용 업그레이드 한 종류의 다음 레벨 비용(다이아) */
export function diamondUpgradeCost(kind: DiamondUpgradeKind, level: number): number {
  const c = BALANCE.diamond.upgrade[kind];
  return Math.ceil(c.base * c.growth ** level);
}

export interface DiamondUpgradePreview {
  kind: DiamondUpgradeKind;
  level: number;
  maxLevel: number;
  maxed: boolean;
  cost: number;
  affordable: boolean;
  /** 올리기 전/후 값. 생산·인세는 배율, 오프라인은 정산 상한(ms) */
  before: number;
  after: number;
}

export function previewDiamondUpgrade(s: GameState, kind: DiamondUpgradeKind): DiamondUpgradePreview {
  const level = s.diamondUpgrades[kind];
  const maxLevel = diamondUpgradeMaxLevel(kind);
  const maxed = level >= maxLevel;
  const cost = diamondUpgradeCost(kind, level);
  const at = (lv: number) =>
    kind === 'offline'
      ? BALANCE.offline.capMs + BALANCE.diamond.upgrade.offline.perLevelMs * lv
      : 1 + BALANCE.diamond.upgrade[kind].perLevel * lv;
  return { kind, level, maxLevel, maxed, cost, affordable: !maxed && s.diamonds >= cost, before: at(level), after: at(Math.min(level + 1, maxLevel)) };
}

/**
 * 다이아가 생기기 전의 저장을 불러올 때 지금까지 한 일에 대한 다이아를 한 번에 준다.
 * (이미 클리어한 공연장, 이미 낸 앨범, 이미 오른 플레이어 레벨)
 */
export function retroactiveDiamonds(s: Pick<GameState, 'concerts' | 'albums' | 'fans'>): number {
  const stages = STAGES.filter((d) => s.concerts[d.id]?.cleared).reduce((a, d) => a + d.firstClearDiamonds, 0);
  const albums = BALANCE.diamond.album.slice(0, s.albums.length).reduce((a, b) => a + b, 0);
  return stages + albums + levelUpDiamonds(0, s.fans);
}

/* ---------- 자아 전환 ---------- */

export interface SwitchStatus {
  allowed: boolean;
  reason: 'ok' | 'same' | 'lock' | 'heat' | 'recovery';
  /** 사람이 읽는 잠금 사유. 허용이면 null. */
  message: string | null;
  remainingMs: number;
}

export function switchStatus(s: GameState, target: Persona, at: number = s.lastSettledAt): SwitchStatus {
  if (target === s.activePersona) return { allowed: false, reason: 'same', message: null, remainingMs: 0 };
  const lockLeft = s.switchLockedUntil - at;
  if (lockLeft > 0) {
    return {
      allowed: false,
      reason: 'lock',
      message: `전환 직후 재전환 불가 · ${(lockLeft / 1000).toFixed(1)}초`,
      remainingMs: lockLeft,
    };
  }
  if (target === 'dark') {
    if (s.recoveryReentryRequired) {
      const penaltyLeft = s.recoveryPenaltyUntil - at;
      if (penaltyLeft > 0) {
        return {
          allowed: false,
          reason: 'recovery',
          message: `마이크 압수 중 · ${Math.ceil(penaltyLeft / 1000)}초 뒤 + 과열 ${P.reentryMaxHeat} 이하 필요`,
          remainingMs: penaltyLeft,
        };
      }
      if (s.heat > P.reentryMaxHeat) {
        return {
          allowed: false,
          reason: 'heat',
          message: `과열 ${P.reentryMaxHeat} 이하에서 어둠 재진입 (현재 ${Math.ceil(s.heat)})`,
          remainingMs: ((s.heat - P.reentryMaxHeat) / P.heatDownPerSec) * 1000,
        };
      }
    } else if (s.heat > P.manualDarkMaxHeat) {
      return {
        allowed: false,
        reason: 'heat',
        message: `과열 ${P.manualDarkMaxHeat} 이하에서만 어둠 전환 (현재 ${Math.ceil(s.heat)})`,
        remainingMs: ((s.heat - P.manualDarkMaxHeat) / P.heatDownPerSec) * 1000,
      };
    }
  }
  return { allowed: true, reason: 'ok', message: null, remainingMs: 0 };
}

/* ---------- 공연 ---------- */

export interface StageStatus {
  id: StageId;
  fansRequired: number;
  fansOk: boolean;
  previousCleared: boolean;
  unlocked: boolean;
  cleared: boolean;
  bestScore: number;
  cooldownLeftMs: number;
  canRun: boolean;
  baseCoins: number;
  firstClearCoins: number;
  firstClearDiamonds: number;
  /** 어둠속성으로만 입장하는 비밀 공연장 */
  darkOnly: boolean;
  /** 지금 자아로 입장할 수 있다 (비밀 공연장은 어둠일 때만) */
  personaOk: boolean;
  /** 목록에 보이는 공연장. 비밀 공연장은 앞 공연장을 클리어해야 나타난다. */
  visible: boolean;
}

export function stageStatus(s: GameState, id: StageId, at: number = s.lastSettledAt): StageStatus {
  const idx = STAGES.findIndex((x) => x.id === id);
  const def = STAGES[idx];
  const rec = s.concerts[id];
  const previousCleared = idx === 0 ? true : s.concerts[STAGES[idx - 1].id].cleared;
  const fansOk = s.fans >= def.fans;
  const unlocked = fansOk && previousCleared;
  const cooldownLeftMs = Math.max(0, rec.cooldownUntil - at);
  const darkOnly = !!def.darkOnly;
  const personaOk = !darkOnly || s.activePersona === 'dark';
  return {
    id,
    fansRequired: def.fans,
    fansOk,
    previousCleared,
    unlocked,
    cleared: rec.cleared,
    bestScore: rec.bestScore,
    cooldownLeftMs,
    canRun: unlocked && personaOk && cooldownLeftMs <= 0,
    baseCoins: def.baseCoins,
    firstClearCoins: def.firstClearCoins,
    firstClearDiamonds: def.firstClearDiamonds,
    darkOnly,
    personaOk,
    visible: !darkOnly || previousCleared,
  };
}

/** 직접 공연 난이도: baseDifficulty × stageDifficultyGrowth^(공연장 순번). 방구석 1.30 → 지하 클럽 1.43 → 소형 공연장 1.57 → … → 월클 콘서트 2.53 */
export function stageDifficulty(id: StageId): number {
  const idx = Math.max(0, STAGES.findIndex((x) => x.id === id));
  return BALANCE.concert.baseDifficulty * BALANCE.concert.stageDifficultyGrowth ** idx;
}

/** 그 공연장의 마이크 타이밍에서 과제를 넘길 때마다 곱해지는 난이도 배수 */
export const stageTaskGrowth = (id: StageId): number => BALANCE.concert.stageTaskGrowth[id] ?? BALANCE.concert.taskDifficultyGrowth;

export const isTourComplete = (s: GameState) => s.concerts[TOUR_STAGE].cleared;

/** 아직 보이지 않는 첫 비밀 공연장 (월클을 클리어하면 사라진다). 목록에 "???" 안내를 띄울 때 쓴다. */
export const hiddenSecretStage = (s: GameState): StageId | null =>
  s.concerts[WORLD_STAGE].cleared ? null : (SECRET_STAGE_IDS[0] ?? null);

/* ---------- 업적·미션 지표 ---------- */

/** 평생 누적 횟수 하나 */
export const counterOf = (s: Pick<GameState, 'counters'>, key: CounterKey): number => s.counters[key] ?? 0;

/** 모든 업적 지표의 현재 값. 목록 길이나 카운터에서 바로 읽을 수 있는 것만 있다. */
export function achievementValue(s: GameState, metric: AchievementMetric): number {
  switch (metric) {
    case 'singles':
      return s.singles.length;
    case 'albums':
      return s.albums.length;
    case 'fans':
      return Math.floor(s.fans);
    case 'level':
      return playerLevel(s.fans);
    case 'stages':
      return STAGES.filter((d) => !d.darkOnly && s.concerts[d.id]?.cleared).length;
    case 'tour':
      return s.concerts[TOUR_STAGE].cleared ? 1 : 0;
    case 'world':
      return s.concerts[WORLD_STAGE].cleared ? 1 : 0;
    case 'secrets':
      return SECRET_STAGE_IDS.filter((id) => s.concerts[id]?.cleared).length;
    case 'maxedEquip':
      return (
        EQUIPMENT_KIND_LIST.filter((k) => s.equipment[k] >= BALANCE.equipment.maxLevel).length +
        EQUIPMENT_KIND_LIST.filter((k) => s.darkEquipment[k] >= BALANCE.darkEquipment.maxLevel).length
      );
    case 'upgradeLevels':
      return s.diamondUpgrades.production + s.diamondUpgrades.royalty + s.diamondUpgrades.offline;
    case 'themes':
      return s.cosmetics.themes.filter((t) => t !== 'default').length;
    case 'streams':
      return Math.floor(streamTotal(s.streaming));
    case 'photoCards':
      return photoDistinct(s.photo.owned);
    case 'photoSets':
      return completedSets(s.photo.owned).length;
    case 'featOwned':
      return Object.keys(s.feat.owned).length;
    case 'mascotStage':
      return Math.max(mascotStage(s.mascot.normal.xp), mascotStage(s.mascot.dark.xp));
    case 'towerBest':
      return s.arcade.tower.best;
    case 'survivalBest':
      return s.arcade.survival.best;
    case 'lyricBest':
      return s.arcade.lyric.best;
    case 'ticketBest':
      return s.arcade.ticketing.best;
    case 'ssrCards':
      return s.singles.filter((x) => songCardOf(s.cards, x).rarity === 'SSR').length;
    default:
      return counterOf(s, metric);
  }
}

const EQUIPMENT_KIND_LIST: readonly EquipmentKind[] = ['mic', 'studio', 'promotion'];

/** 미션 지표의 현재 값(평생 누적). 진행도는 이 값에서 그날(그 주) 시작할 때의 값을 뺀 것이다. */
export const missionMetricValue = (s: Pick<GameState, 'counters'>, metric: MissionMetric): number => counterOf(s, metric);

/* ---------- 튜토리얼(문맥 안내) ---------- */

export interface Hint {
  tab: 'studio' | 'release' | 'equip' | 'concert' | 'collection';
  text: string;
}

export function currentHint(s: GameState): Hint | null {
  const f = s.tutorialFlags;
  const prev = previewSingle(s);
  if (!f.work) {
    return { tab: 'studio', text: '「작업하기」 패드를 눌러보자. 안 눌러도 라임은 자동으로 쌓여.' };
  }
  if (!f.release) {
    return prev.affordable
      ? { tab: 'release', text: '라임이 모였다! 발매 탭에서 첫 싱글을 내보자.' }
      : { tab: 'studio', text: `라임 ${Math.ceil(prev.needRhymes)}개가 모이면 첫 싱글을 발매할 수 있어.` };
  }
  if (!f.buy) {
    return { tab: 'equip', text: '코인이 생겼다. 장비 탭에서 마이크부터 사보자.' };
  }
  if (!f.switch) {
    return { tab: 'studio', text: '어둠속성으로 바꿔보자. 라임이 더 빨리 쌓이지만 과열이 올라가.' };
  }
  if (!f.album) {
    const album = previewAlbum(s);
    if (album) {
      return album.affordable
        ? { tab: 'release', text: `코인이 모였다! 발매 탭에서 첫 앨범 「${album.def.title}」을 내보자.` }
        : { tab: 'studio', text: `코인 ${Math.ceil(album.cost)}개가 모이면 첫 앨범 「${album.def.title}」을 발매할 수 있어.` };
    }
  }
  return null;
}
