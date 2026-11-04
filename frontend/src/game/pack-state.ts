import { BALANCE, FEAT_IDS, FEAT_LEGACY_IDS, LYRIC_CARD_IDS, PHOTO_SETS, lyricCardById, nurtureActionById } from './balance';
import { bool, countMap, int, isObj, num, MAX_TIME, bad, type Obj } from './parse';
import { emptyNurtureSide } from './nurturedata';
import { isPhotoCard } from './packdata';
import { streamSeedFrom } from './streaming';
import type { Arcade, ArcadeRecord, Featuring, Mascot, Mascots, NurtureSide, Nurtures, Persona, PhotoBook, SongCards, Stats } from './types';

/* 콘텐츠 팩 2 상태의 초기값과 저장 검증. 나중에 추가된 필드라 없는 예전 저장은 기본값으로 읽는다. */

export const emptyCards = (seed: number): SongCards => ({ seed, deck: [], remaster: {} });
export const emptyPhoto = (seed: number): PhotoBook => ({ seed, pulls: 0, pity: 0, tickets: 0, owned: {}, shards: 0, claimedSets: [] });
export const emptyFeat = (seed: number): Featuring => ({ seed, pulls: 0, pity: 0, guaranteed: false, owned: {}, slots: [] });
export const emptyMascot = (): Mascot => ({ xp: 0, fullUntil: 0, playReadyAt: 0, giftReadyAt: 0, fed: 0 });
export const emptyMascots = (): Mascots => ({ normal: emptyMascot(), dark: emptyMascot() });
export const emptyNurtures = (): Nurtures => ({ normal: emptyNurtureSide(), dark: emptyNurtureSide() });
const emptyRecord = (): ArcadeRecord => ({ cooldownUntil: 0, best: 0, plays: 0 });
export const emptyArcade = (): Arcade => ({
  rhythm: { ...emptyRecord(), songs: {} },
  survival: emptyRecord(),
  lyric: { ...emptyRecord(), cards: { ...BALANCE.lyric.starter }, bonus: 0 },
  ticketing: { ...emptyRecord(), boost: null },
  tower: { week: '', floor: 1, best: 0, claimed: [], cooldownUntil: 0, attempts: 0 },
});
export const emptyStats = (): Stats => ({ normalMs: 0, darkMs: 0, nicks: {}, notes: [] });

export const NICK_LIMIT = 30;
export const NOTE_LIMIT = 20;

const BIG = 1e9;
const idList = (raw: unknown, allowed: (id: string) => boolean, max: number): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && allowed(x)))].slice(0, max) : [];

export function parseCards(raw: unknown, seed: number, singleIds: ReadonlySet<string>): SongCards {
  if (raw === undefined) return emptyCards(seed);
  if (!isObj(raw)) return bad('cards가 올바르지 않습니다.');
  const remaster = countMap(raw.remaster, (id) => singleIds.has(id), BALANCE.cards.remasterMax, 'cards.remaster');
  return {
    seed: int(raw, 'seed', 0, 0xffffffff, 'cards.seed'),
    deck: idList(raw.deck, (id) => singleIds.has(id), BALANCE.cards.deckSlots),
    remaster,
  };
}

export function parsePhoto(raw: unknown, seed: number): PhotoBook {
  if (raw === undefined) return emptyPhoto(seed);
  if (!isObj(raw)) return bad('photo가 올바르지 않습니다.');
  return {
    seed: int(raw, 'seed', 0, 0xffffffff, 'photo.seed'),
    pulls: int(raw, 'pulls', 0, BIG, 'photo.pulls'),
    pity: int(raw, 'pity', 0, BALANCE.photo.pityAt, 'photo.pity'),
    tickets: int(raw, 'tickets', 0, BALANCE.photo.maxTickets, 'photo.tickets'),
    owned: countMap(raw.owned, isPhotoCard, BIG, 'photo.owned'),
    shards: int(raw, 'shards', 0, BIG, 'photo.shards'),
    claimedSets: Array.isArray(raw.claimedSets)
      ? [...new Set(raw.claimedSets.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= PHOTO_SETS))]
      : [],
  };
}

export function parseFeat(raw: unknown, seed: number): Featuring {
  if (raw === undefined) return emptyFeat(seed);
  if (!isObj(raw)) return bad('feat가 올바르지 않습니다.');
  // 12명 시절 ID는 같은 등급 자리의 새 ID로 옮긴다(별·장착 유지)
  const upgraded = isObj(raw.owned) ? Object.fromEntries(Object.entries(raw.owned).map(([id, v]) => [FEAT_LEGACY_IDS[id] ?? id, v])) : raw.owned;
  const owned = countMap(upgraded, (id) => FEAT_IDS.includes(id), BALANCE.feat.maxStar, 'feat.owned');
  const slotIds = Array.isArray(raw.slots) ? raw.slots.map((id) => (typeof id === 'string' ? (FEAT_LEGACY_IDS[id] ?? id) : id)) : raw.slots;
  return {
    seed: int(raw, 'seed', 0, 0xffffffff, 'feat.seed'),
    pulls: int(raw, 'pulls', 0, BIG, 'feat.pulls'),
    pity: int(raw, 'pity', 0, BALANCE.feat.pityAt, 'feat.pity'),
    guaranteed: bool(raw, 'guaranteed', 'feat.guaranteed'),
    owned,
    slots: idList(slotIds, (id) => (owned[id] ?? 0) > 0, BALANCE.feat.slots),
  };
}

function parseMascot(raw: unknown, label: string): Mascot {
  if (raw === undefined) return emptyMascot();
  if (!isObj(raw)) return bad(`${label}이 올바르지 않습니다.`);
  return {
    xp: int(raw, 'xp', 0, BIG, `${label}.xp`),
    fullUntil: num(raw, 'fullUntil', 0, MAX_TIME, `${label}.fullUntil`),
    playReadyAt: num(raw, 'playReadyAt', 0, MAX_TIME, `${label}.playReadyAt`),
    giftReadyAt: num(raw, 'giftReadyAt', 0, MAX_TIME, `${label}.giftReadyAt`),
    // 간식 횟수는 나중에 생긴 필드라 없는 예전 저장은 0부터 센다
    fed: raw.fed === undefined ? 0 : int(raw, 'fed', 0, BIG, `${label}.fed`),
  };
}

export function parseMascots(raw: unknown): Mascots {
  if (raw === undefined) return emptyMascots();
  if (!isObj(raw)) return bad('mascot이 올바르지 않습니다.');
  return { normal: parseMascot(raw.normal, 'mascot.normal'), dark: parseMascot(raw.dark, 'mascot.dark') };
}

function parseNurtureSide(raw: unknown, who: Persona, label: string): NurtureSide {
  if (raw === undefined) return emptyNurtureSide();
  if (!isObj(raw)) return bad(`${label}이 올바르지 않습니다.`);
  const max = BALANCE.nurture.gauge.max;
  const at = num(raw, 'at', 0, MAX_TIME, `${label}.at`);
  const sleepUntil = num(raw, 'sleepUntil', 0, MAX_TIME, `${label}.sleepUntil`);
  return {
    xp: int(raw, 'xp', 0, BIG, `${label}.xp`),
    full: num(raw, 'full', 0, max, `${label}.full`),
    mood: num(raw, 'mood', 0, max, `${label}.mood`),
    tired: num(raw, 'tired', 0, max, `${label}.tired`),
    clean: num(raw, 'clean', 0, max, `${label}.clean`),
    at,
    // 자는 시간은 한 번에 sleep.ms까지라, 기록 시각보다 그 이상 먼 값은 고쳐진 저장이다
    sleepUntil: at > 0 ? Math.min(sleepUntil, at + BALANCE.nurture.sleep.ms) : 0,
    uses: countMap(raw.uses, (id) => nurtureActionById(id)?.persona === who, BIG, `${label}.uses`),
  };
}

export function parseNurtures(raw: unknown): Nurtures {
  if (raw === undefined) return emptyNurtures();
  if (!isObj(raw)) return bad('nurture가 올바르지 않습니다.');
  return { normal: parseNurtureSide(raw.normal, 'normal', 'nurture.normal'), dark: parseNurtureSide(raw.dark, 'dark', 'nurture.dark') };
}

function parseRecord(raw: unknown, label: string): ArcadeRecord {
  if (raw === undefined) return emptyRecord();
  if (!isObj(raw)) return bad(`${label}가 올바르지 않습니다.`);
  return { cooldownUntil: num(raw, 'cooldownUntil', 0, MAX_TIME, `${label}.cooldownUntil`), best: int(raw, 'best', 0, 1000, `${label}.best`), plays: int(raw, 'plays', 0, BIG, `${label}.plays`) };
}

export function parseArcade(raw: unknown, singleIds: ReadonlySet<string>): Arcade {
  const fresh = emptyArcade();
  if (raw === undefined) return fresh;
  if (!isObj(raw)) return bad('arcade가 올바르지 않습니다.');
  const rhythmRaw = isObj(raw.rhythm) ? raw.rhythm : ({} as Obj);
  const lyricRaw = isObj(raw.lyric) ? raw.lyric : ({} as Obj);
  const ticketRaw = isObj(raw.ticketing) ? raw.ticketing : ({} as Obj);
  const towerRaw = raw.tower;

  const songs: Record<string, number> = {};
  if (isObj(rhythmRaw.songs)) {
    for (const [id, v] of Object.entries(rhythmRaw.songs)) {
      if (!singleIds.has(id)) continue;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1000) return bad(`arcade.rhythm.songs.${id}: 허용 범위를 벗어났습니다.`);
      songs[id] = v;
    }
  }
  let cards = lyricRaw.cards === undefined ? fresh.lyric.cards : countMap(lyricRaw.cards, (id) => !!lyricCardById(id), 99, 'arcade.lyric.cards');
  // 덱이 너무 작거나 비정상이면(고쳐진 저장) 시작 덱으로 돌린다. 곡을 만들 수 없는 상태를 막는다.
  const deckTotal = Object.values(cards).reduce((a, b) => a + b, 0);
  if (deckTotal < BALANCE.lyric.minDeck || deckTotal > BALANCE.lyric.maxDeck) cards = fresh.lyric.cards;
  let boost: Arcade['ticketing']['boost'] = null;
  if (isObj(ticketRaw.boost)) boost = { mult: num(ticketRaw.boost, 'mult', 1, 2, 'arcade.ticketing.boost.mult'), until: num(ticketRaw.boost, 'until', 0, MAX_TIME, 'arcade.ticketing.boost.until') };

  let tower = fresh.tower;
  if (towerRaw !== undefined) {
    if (!isObj(towerRaw)) return bad('arcade.tower가 올바르지 않습니다.');
    tower = {
      week: typeof towerRaw.week === 'string' && towerRaw.week.length <= 12 ? towerRaw.week : '',
      floor: int(towerRaw, 'floor', 1, BIG, 'arcade.tower.floor'),
      best: int(towerRaw, 'best', 0, BIG, 'arcade.tower.best'),
      claimed: Array.isArray(towerRaw.claimed) ? towerRaw.claimed.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= BIG).slice(-200) : [],
      cooldownUntil: num(towerRaw, 'cooldownUntil', 0, MAX_TIME, 'arcade.tower.cooldownUntil'),
      attempts: int(towerRaw, 'attempts', 0, BIG, 'arcade.tower.attempts'),
    };
  }
  return {
    rhythm: { ...parseRecord(rhythmRaw, 'arcade.rhythm'), songs },
    survival: parseRecord(raw.survival, 'arcade.survival'),
    lyric: { ...parseRecord(lyricRaw, 'arcade.lyric'), cards, bonus: lyricRaw.bonus === undefined ? 0 : num(lyricRaw, 'bonus', 0, 1, 'arcade.lyric.bonus') },
    ticketing: { ...parseRecord(ticketRaw, 'arcade.ticketing'), boost },
    tower,
  };
}

export function parseStats(raw: unknown): Stats {
  if (raw === undefined) return emptyStats();
  if (!isObj(raw)) return bad('stats가 올바르지 않습니다.');
  const nicks: Record<string, number> = {};
  if (isObj(raw.nicks)) {
    for (const [k, v] of Object.entries(raw.nicks).slice(0, NICK_LIMIT)) {
      if (k.length > 0 && k.length <= 60 && !/[.$]/.test(k) && typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= BIG) nicks[k] = v;
    }
  }
  return {
    normalMs: raw.normalMs === undefined ? 0 : num(raw, 'normalMs', 0, MAX_TIME, 'stats.normalMs'),
    darkMs: raw.darkMs === undefined ? 0 : num(raw, 'darkMs', 0, MAX_TIME, 'stats.darkMs'),
    nicks,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120).slice(-NOTE_LIMIT) : [],
  };
}

/** 새 게임·예전 저장에 줄 씨앗 (시각에서 결정적으로 만든다) */
export const packSeeds = (n: number) => ({ cards: streamSeedFrom(n + 3), photo: streamSeedFrom(n + 4), feat: streamSeedFrom(n + 5) });
export { LYRIC_CARD_IDS };
