import { BALANCE, CARD_RARITIES, FEAT_NPCS, PHOTO_GRADES, PHOTO_SETS, featDefById, photoCardId, type FeatDef } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { CardRarity, GameState, Mascot, Persona, Single, SongCards, Vibe } from './types';

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

export const featPassive = (def: Pick<FeatDef, 'rarity'>, stars: number): number =>
  BALANCE.feat.passive[def.rarity] * (1 + BALANCE.feat.starBonus * Math.max(0, stars - 1));

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
  /** 인세 */
  coin: number;
  /** 싱글·앨범·모노그램 팬 획득 */
  fan: number;
  /** 미니게임·계단 전투력 */
  power: number;
  /** 오프라인 정산 상한에 더하는 시간(ms) */
  offlineMs: number;
}

export type BonusState = Pick<GameState, 'cards' | 'photo' | 'feat' | 'mascot' | 'singles' | 'lastSettledAt'>;

/** 수집품이 주는 영구 보너스. 아무것도 없으면 전부 0이라 곱하는 쪽은 ×1이다. 마스코트 기분은 lastSettledAt 시점 기준이다. */
export function bonuses(s: BonusState): Bonuses {
  const b: Bonuses = { rhyme: { normal: 0, dark: 0 }, coin: 0, fan: 0, power: 0, offlineMs: 0 };
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
    if (def && stars > 0) add(def.vibe, featPassive(def, stars));
  }
  for (const set of completedSets(s.photo.owned)) {
    const sb = BALANCE.photo.setBonus[set - 1];
    if (sb.kind === 'offline') b.offlineMs += sb.value;
    else if (sb.kind === 'all') {
      for (const v of VIBES) add(v, sb.value);
    } else add(sb.kind, sb.value);
  }
  for (const p of ['normal', 'dark'] as const) b.rhyme[p] += mascotBonus(s.mascot[p], s.lastSettledAt);
  return b;
}
