import { BALANCE, CARD_RARITIES, FEAT_NPCS, PHOTO_GRADES, PHOTO_SETS, SKILL_IDS, STREAM_CERT_VIBE, STREAM_PLATFORMS, featDefById, photoCardId, titlePerkOf, type FeatDef } from './balance';
import { nurtureBonus } from './nurturedata';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { CardRarity, GameState, Mascot, Persona, Single, SongCards, Vibe } from './types';
import { villageEffects } from './villagedata';

/*
 * 콘텐츠 팩 2의 순수 데이터 규칙: 곡 카드 파생, 포토카드 ID, 마스코트 단계·기분, 그리고 영구 보너스 합산.
 * selectors·simulation이 쓰므로 다른 game 모듈(selectors 포함)을 가져오지 않는다.
 */

const CARD_SALT = 0x63617264;

/** 싱글 ID(`single-N`)의 번호 */
export const singleNo = (id: string): number => Number(id.slice(7)) || 0;

/* ---------- 곡 카드 ---------- */

export function cardRarityOf(seed: number, singleId: string): CardRarity {
  const rng = mulberry32(mix(seed ^ CARD_SALT, singleNo(singleId)));
  rng();
  const r = rng();
  let acc = 0;
  for (const k of CARD_RARITIES) {
    acc += BALANCE.cards.rarityRates[k];
    if (r < acc) return k;
  }
  return 'N';
}

const VIBES: readonly Vibe[] = ['rhyme', 'coin', 'fan', 'power'];

export function cardVibeOf(seed: number, singleId: string): Vibe {
  const rng = mulberry32(mix(seed ^ (CARD_SALT + 1), singleNo(singleId)));
  rng();
  return VIBES[Math.floor(rng() * VIBES.length)];
}

export const cardBonus = (rarity: CardRarity, remaster: number): number => BALANCE.cards.base[rarity] * (1 + BALANCE.cards.remasterBonus * remaster);

export interface SongCard {
  id: string;
  title: string;
  persona: Persona;
  rarity: CardRarity;
  vibe: Vibe;
  remaster: number;
  bonus: number;
}

export function songCardOf(cards: Pick<SongCards, 'seed' | 'remaster'>, single: Pick<Single, 'id' | 'title' | 'persona'>): SongCard {
  const rarity = cardRarityOf(cards.seed, single.id);
  const remaster = cards.remaster[single.id] ?? 0;
  return { id: single.id, title: single.title, persona: single.persona, rarity, vibe: cardVibeOf(cards.seed, single.id), remaster, bonus: cardBonus(rarity, remaster) };
}

export const remasterCost = (rarity: CardRarity, level: number): number => Math.ceil(BALANCE.cards.remasterCost[rarity] * BALANCE.cards.remasterGrowth ** level);

/* ---------- 포토카드 ---------- */

export function parsePhotoId(id: string): { set: number; grade: number } | null {
  const m = /^p([1-9])-([1-9])$/.exec(id);
  if (!m) return null;
  const set = Number(m[1]);
  const grade = Number(m[2]);
  return set <= PHOTO_SETS && grade <= PHOTO_GRADES ? { set, grade } : null;
}

export const isPhotoCard = (id: string): boolean => parsePhotoId(id) !== null;

/** 6장을 모두 가진 세트 번호들 */
export function completedSets(owned: Record<string, number>): number[] {
  const out: number[] = [];
  for (let set = 1; set <= PHOTO_SETS; set++) {
    let all = true;
    for (let g = 1; g <= PHOTO_GRADES; g++) if (!(owned[photoCardId(set, g)] > 0)) all = false;
    if (all) out.push(set);
  }
  return out;
}

export const photoDistinct = (owned: Record<string, number>): number => Object.values(owned).filter((n) => n > 0).length;

/* ---------- 피처링 ---------- */

/** 패시브 = 등급 기본값 × (1 + 별 보너스 + 초월 보너스). tier는 초월 단계(0이면 초월 전). */
export const featPassive = (def: Pick<FeatDef, 'rarity'>, stars: number, tier = 0): number =>
  BALANCE.feat.passive[def.rarity] * (1 + BALANCE.feat.starBonus * Math.max(0, stars - 1) + BALANCE.feat.transBonus * Math.max(0, tier));

/** 초월 중복이 이만큼 쌓이면 끝(최대 단계). 이 뒤의 중복은 환급된다. */
export const FEAT_TRANS_TOTAL: number = BALANCE.feat.transNeed.reduce((a, b) => a + b, 0);
export const FEAT_TRANS_MAX_TIER: number = BALANCE.feat.transNeed.length;

/** 초월 중복 수 → 단계, 다음 단계까지 남은 중복(최대 단계면 0) */
export function featTransView(count: number): { tier: number; into: number; need: number } {
  let left = Math.max(0, count);
  for (let tier = 0; tier < FEAT_TRANS_MAX_TIER; tier++) {
    const need = BALANCE.feat.transNeed[tier];
    if (left < need) return { tier, into: left, need };
    left -= need;
  }
  return { tier: FEAT_TRANS_MAX_TIER, into: 0, need: 0 };
}

/** 가진 래퍼의 별 합계 (슬롯 확장 기준) */
export const featStarTotal = (owned: Record<string, number>): number => Object.values(owned).reduce((a, b) => a + b, 0);

/** 지금 쓸 수 있는 장착 칸 수 (기본 칸 + 별 합계로 열린 칸) */
export const featSlotCount = (owned: Record<string, number>): number => {
  const total = featStarTotal(owned);
  return BALANCE.feat.slots + BALANCE.feat.extraSlotStars.filter((need) => total >= need).length;
};
export const FEAT_MAX_SLOTS: number = BALANCE.feat.slots + BALANCE.feat.extraSlotStars.length;

export interface FeatSynergy {
  kind: 'vibe' | 'rarity' | 'rainbow';
  /** kind가 vibe일 때: 어느 갈래, 몇 명 */
  vibe?: Vibe;
  count?: number;
  /** kind가 rarity일 때: 어느 등급 */
  rarity?: CardRarity;
  /** 이 시너지가 더해지는 갈래들과 각 갈래에 더해지는 값 */
  vibes: readonly Vibe[];
  value: number;
}

/** 장착한 래퍼들의 구성이 주는 시너지 목록 */
export function featSynergies(slotIds: readonly string[]): FeatSynergy[] {
  const defs = slotIds.map((id) => featDefById(id)).filter((d): d is FeatDef => !!d);
  const S = BALANCE.feat.synergy;
  const out: FeatSynergy[] = [];
  const perVibe = new Map<Vibe, number>();
  for (const d of defs) perVibe.set(d.vibe, (perVibe.get(d.vibe) ?? 0) + 1);
  for (const v of VIBES) {
    const n = perVibe.get(v) ?? 0;
    const value = S.sameVibe[Math.min(n, S.sameVibe.length - 1)];
    if (n >= 2 && value > 0) out.push({ kind: 'vibe', vibe: v, count: n, vibes: [v], value });
  }
  if (defs.length >= 3 && defs.every((d) => d.rarity === defs[0].rarity)) out.push({ kind: 'rarity', rarity: defs[0].rarity, vibes: VIBES, value: S.sameRarity[defs[0].rarity] });
  if (VIBES.every((v) => (perVibe.get(v) ?? 0) >= 1)) out.push({ kind: 'rainbow', vibes: VIBES, value: S.rainbow });
  return out;
}

/** 이번 주 픽업 SSR (주 번호로 돌아가며 정해진다) */
export function pickupOf(now: number): FeatDef {
  const ssr = FEAT_NPCS.filter((n) => n.rarity === 'SSR');
  return ssr[Math.floor(now / BALANCE.feat.pickupWeekMs) % ssr.length];
}

/* ---------- 마스코트 ---------- */

export type Mood = 'happy' | 'hungry' | 'sulk';

export function mascotStage(xp: number): number {
  const t = BALANCE.mascot.stageXp;
  let stage = 0;
  for (let i = 0; i < t.length; i++) if (xp >= t[i]) stage = i;
  return stage;
}

export function mascotMood(m: Pick<Mascot, 'fullUntil'>, at: number): Mood {
  if (at < m.fullUntil) return 'happy';
  return at < m.fullUntil + BALANCE.mascot.hungryMs ? 'hungry' : 'sulk';
}

export const mascotBonus = (m: Mascot, at: number): number => BALANCE.mascot.stageBonus[mascotStage(m.xp)] * BALANCE.mascot.moodFactor[mascotMood(m, at)];

/* ---------- 영구 보너스 합산 ---------- */

export interface Bonuses {
  /** 라임 생산(자아별) */
  rhyme: Record<Persona, number>;
  /** 인세 (모든 자아) */
  coin: number;
  /** 인세 (그 자아만): 모노사파 육성 레벨 */
  coinBy: Record<Persona, number>;
  /** 싱글·앨범·모노그램 팬 획득 */
  fan: number;
  /** 미니게임·계단 전투력 */
  power: number;
  /** 오프라인 정산 상한에 더하는 시간(ms) */
  offlineMs: number;
}

export type BonusState = Pick<GameState, 'cards' | 'photo' | 'feat' | 'mascot' | 'nurture' | 'singles' | 'lastSettledAt' | 'skills' | 'streaming' | 'cosmetics' | 'village'>;

/** 수집품·레벨 스킬·스트리밍 인증·칭호·팬 마을이 주는 영구 보너스. 아무것도 없으면 전부 0이라 곱하는 쪽은 ×1이다. 마스코트 기분은 lastSettledAt 시점 기준이다. */
export function bonuses(s: BonusState): Bonuses {
  const b: Bonuses = { rhyme: { normal: 0, dark: 0 }, coin: 0, coinBy: { normal: 0, dark: 0 }, fan: 0, power: 0, offlineMs: 0 };
  const add = (vibe: Vibe, v: number, persona?: Persona) => {
    if (vibe === 'rhyme') {
      if (persona) b.rhyme[persona] += v;
      else {
        b.rhyme.normal += v;
        b.rhyme.dark += v;
      }
    } else b[vibe] += v;
  };

  for (const id of s.cards.deck) {
    const single = s.singles.find((x) => x.id === id);
    if (!single) continue;
    const c = songCardOf(s.cards, single);
    add(c.vibe, c.bonus, c.persona);
  }
  for (const id of s.feat.slots) {
    const def = featDefById(id);
    const stars = s.feat.owned[id] ?? 0;
    if (def && stars > 0) add(def.vibe, featPassive(def, stars, featTransView(s.feat.trans[id] ?? 0).tier));
  }
  for (const syn of featSynergies(s.feat.slots.filter((id) => (s.feat.owned[id] ?? 0) > 0))) for (const v of syn.vibes) add(v, syn.value);
  for (const set of completedSets(s.photo.owned)) {
    const sb = BALANCE.photo.setBonus[set - 1];
    if (sb.kind === 'offline') b.offlineMs += sb.value;
    else if (sb.kind === 'all') {
      for (const v of VIBES) add(v, sb.value);
    } else add(sb.kind, sb.value);
  }
  // 레벨 스킬: 갈래마다 찍은 단계만큼 (최대 단계는 없다)
  for (const id of SKILL_IDS) {
    const lv = Math.max(0, s.skills[id] ?? 0);
    if (id === 'offline') b.offlineMs += lv * BALANCE.skills.offlinePerLevelMs;
    else add(id, lv * BALANCE.skills.perLevel);
  }
  // 스트리밍 인증: 받은 단계마다 그 플랫폼의 갈래가 올라간다
  for (const p of STREAM_PLATFORMS) {
    const tier = Math.min(Math.max(0, s.streaming.certs[p] ?? 0), BALANCE.certs.tiers.length);
    if (tier > 0) add(STREAM_CERT_VIBE[p], tier * BALANCE.certs.bonusPerTier);
  }
  // 칭호 효과: 달고 있는 칭호 하나
  const perk = titlePerkOf(s.cosmetics.title);
  if (perk) add(perk.vibe, perk.value);
  // 팬 마을: 지어 둔 건물이 주는 효과(합주실은 구역의 자아에만)
  const village = villageEffects(s.village);
  add('coin', village.coin);
  add('fan', village.fan);
  add('power', village.power);
  b.rhyme.normal += village.rhyme.normal;
  b.rhyme.dark += village.rhyme.dark;
  b.offlineMs += village.offlineMs;
  for (const p of ['normal', 'dark'] as const) {
    b.rhyme[p] += mascotBonus(s.mascot[p], s.lastSettledAt);
    // 모노사파 육성 레벨: 그 자아의 라임·인세, 이정표 레벨은 일반이 팬 획득, 어둠이 전투력
    const n = nurtureBonus(p, s.nurture[p].xp);
    b.rhyme[p] += n.rhyme;
    b.coinBy[p] += n.coin;
    b[n.vibe] += n.extra;
  }
  return b;
}
