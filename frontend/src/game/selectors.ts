import { BALANCE, STAGES, TOUR_STAGE } from './balance';
import { ALBUM_CATALOG, singleTitle, type AlbumDef } from './content';
import type { EquipmentKind, GameState, Persona, StageId } from './types';

const P = BALANCE.persona;

export function clampResource(n: number): number {
  if (!Number.isFinite(n) || n < 0) return n > 0 ? BALANCE.maxResource : 0;
  return Math.min(n, BALANCE.maxResource);
}

/* ---------- 파생 값: 원본 데이터에서만 계산한다 ---------- */

export function productionMultiplier(s: Pick<GameState, 'equipment'>): number {
  return (
    1 + BALANCE.production.micPerLevel * s.equipment.mic + BALANCE.production.studioPerLevel * s.equipment.studio
  );
}

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
  const mult = productionMultiplier(s);
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
}

export function royaltyBreakdown(s: GameState, persona: Persona = s.activePersona): RoyaltyBreakdown {
  const promotionMult = 1 + BALANCE.royalty.promotionPerLevel * s.equipment.promotion;
  const albumMult = 1 + albumRoyaltyBonus(s.albums.length);
  const personaMult = persona === 'normal' ? P.normalRoyaltyMult : P.darkRoyaltyMult;
  return {
    perSec: s.fans * BALANCE.royalty.perFan * promotionMult * albumMult * personaMult,
    fans: s.fans,
    promotionMult,
    albumMult,
    personaMult,
  };
}

export const royaltyRate = (s: GameState, persona: Persona = s.activePersona) => royaltyBreakdown(s, persona).perSec;

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

export function equipmentCost(kind: EquipmentKind, level: number): number {
  const def = BALANCE.equipment[kind];
  return Math.ceil(def.base * def.growth ** level);
}

export interface EquipmentPreview {
  kind: EquipmentKind;
  level: number;
  maxed: boolean;
  cost: number;
  /** 구매 전/후 표시 값 (생산배율 또는 인세 배율 계수) */
  before: number;
  after: number;
  /** 현재 자아 기준 초당 생산 또는 수입의 전/후 */
  rateBefore: number;
  rateAfter: number;
  rateLabel: '라임/초' | '코인/초';
}

export function previewEquipment(s: GameState, kind: EquipmentKind): EquipmentPreview {
  const level = s.equipment[kind];
  const maxed = level >= BALANCE.equipment.maxLevel;
  const next: GameState = {
    ...s,
    equipment: { ...s.equipment, [kind]: Math.min(level + 1, BALANCE.equipment.maxLevel) },
  };
  if (kind === 'promotion') {
    return {
      kind,
      level,
      maxed,
      cost: equipmentCost(kind, level),
      before: 1 + BALANCE.royalty.promotionPerLevel * level,
      after: 1 + BALANCE.royalty.promotionPerLevel * next.equipment.promotion,
      rateBefore: royaltyRate(s),
      rateAfter: royaltyRate(next),
      rateLabel: '코인/초',
    };
  }
  return {
    kind,
    level,
    maxed,
    cost: equipmentCost(kind, level),
    before: productionMultiplier(s),
    after: productionMultiplier(next),
    rateBefore: rhymeRate(s),
    rateAfter: rhymeRate(next),
    rateLabel: '라임/초',
  };
}

/** 작업실 외형 단계: 작업실 레벨 5마다 한 단계. */
export function roomTier(s: Pick<GameState, 'equipment'>): number {
  return Math.min(4, Math.floor(s.equipment.studio / 5));
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
}

export function stageStatus(s: GameState, id: StageId, at: number = s.lastSettledAt): StageStatus {
  const idx = STAGES.findIndex((x) => x.id === id);
  const def = STAGES[idx];
  const rec = s.concerts[id];
  const previousCleared = idx === 0 ? true : s.concerts[STAGES[idx - 1].id].cleared;
  const fansOk = s.fans >= def.fans;
  const unlocked = fansOk && previousCleared;
  const cooldownLeftMs = Math.max(0, rec.cooldownUntil - at);
  return {
    id,
    fansRequired: def.fans,
    fansOk,
    previousCleared,
    unlocked,
    cleared: rec.cleared,
    bestScore: rec.bestScore,
    cooldownLeftMs,
    canRun: unlocked && cooldownLeftMs <= 0,
    baseCoins: def.baseCoins,
    firstClearCoins: def.firstClearCoins,
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
