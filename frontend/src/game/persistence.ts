import { ACHIEVEMENTS, BALANCE, CAMPAIGN_IDS, MISSION_METRICS, POST_KINDS, SCHEMA_VERSION, SNACK_IDS, STAGE_IDS, STREAM_PLATFORMS, THEME_IDS } from './balance';
import { ALBUM_CATALOG, mailTemplateById } from './content';
import { emptyFanMail } from './fanmail';
import { emptyMissions } from './missions';
import { emptyMonogram } from './monogram';
import { Invalid, MAX_TIME, bad, bool, int, isObj, num, persona, str, type Obj } from './parse';
import { emptyArcade, emptyCards, emptyFeat, emptyMascots, emptyPhoto, emptyStats, packSeeds, parseArcade, parseCards, parseFeat, parseMascots, parsePhoto, parseStats } from './pack-state';
import { retroactiveDiamonds } from './selectors';
import { streamSeedFrom, zeroTotals } from './streaming';
import { COUNTER_KEYS, zeroCounters } from './tracking';
import type {
  Buffs,
  CampaignId,
  ConcertRecord,
  Cosmetics,
  Counters,
  DialogueTone,
  FanMail,
  GameState,
  Mail,
  MissionState,
  Monogram,
  Post,
  SnackId,
  StageId,
  Streaming,
  ThemeId,
} from './types';

export const SAVE_KEY = 'monosapa.save';
export const BACKUP_KEY = 'monosapa.save.backup';
export const CORRUPT_KEY = 'monosapa.save.corrupt';

/** localStorage와 같은 최소 인터페이스. 테스트에서는 메모리 구현을 넣는다. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createInitialState(now: number, reducedMotion = false): GameState {
  const concerts = {} as Record<StageId, ConcertRecord>;
  for (const id of STAGE_IDS) concerts[id] = { cleared: false, bestScore: 0, cooldownUntil: 0 };
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    savedAt: now,
    lastSettledAt: now,
    coins: 0,
    fans: 0,
    normalRhymes: 0,
    darkRhymes: 0,
    activePersona: 'normal',
    heat: 0,
    switchLockedUntil: 0,
    recoveryPenaltyUntil: 0,
    recoveryReentryRequired: false,
    equipment: { mic: 0, studio: 0, promotion: 0 },
    darkEquipment: { mic: 0, studio: 0, promotion: 0 },
    musicPower: 0,
    dripPower: 0,
    diamonds: 0,
    diamondUpgrades: { production: 0, royalty: 0, offline: 0 },
    buffs: { snack: null, campaign: null },
    cosmetics: { themes: ['default'], theme: 'default', title: null },
    counters: zeroCounters(),
    achievements: {},
    missions: emptyMissions(),
    fanMail: emptyFanMail(now, streamSeedFrom(now + 1)),
    monogram: emptyMonogram(streamSeedFrom(now + 2)),
    cards: emptyCards(packSeeds(now).cards),
    photo: emptyPhoto(packSeeds(now).photo),
    feat: emptyFeat(packSeeds(now).feat),
    mascot: emptyMascots(),
    arcade: emptyArcade(),
    stats: emptyStats(),
    // 첫 정산은 시작 후 정산 간격이 지나야 한다.
    streaming: { totals: zeroTotals(), settled: 0, lastClaimAt: now, seed: streamSeedFrom(now) },
    singles: [],
    albums: [],
    concerts,
    tutorialFlags: {},
    settings: { muted: false, bgmMuted: false, dialogueTone: 'original', reducedMotion },
  };
}

/* ---------- 검증 ---------- */

export type Validation = { ok: true; state: GameState } | { ok: false; error: string };

/** 스키마 버전 이동. 새 버전이 생기면 여기에 (from → from+1) 변환을 추가한다. */
const MIGRATIONS: Record<number, (raw: Obj) => Obj> = {};

export function migrate(raw: Obj): Obj {
  let cur = raw;
  const declared = cur.schemaVersion;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1) {
    return bad('schemaVersion이 없거나 올바르지 않습니다.');
  }
  let version: number = declared;
  if (version > SCHEMA_VERSION) {
    return bad(`이 저장 데이터는 더 새로운 버전(v${version})입니다. 게임을 최신으로 업데이트해 주세요.`);
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return bad(`v${version} 저장 데이터를 변환할 방법이 없습니다.`);
    cur = step(cur);
    version = cur.schemaVersion as number;
  }
  return cur;
}

/* ---------- 나중에 추가된 필드의 검증 ---------- */

/** 숫자는 엄격하게, 알 수 없는 ID나 사라진 항목은 조용히 버린다. */
function parseBuffs(raw: unknown): Buffs {
  const buffs: Buffs = { snack: null, campaign: null };
  if (raw === undefined) return buffs;
  if (!isObj(raw)) return bad('buffs가 올바르지 않습니다.');
  if (raw.snack != null) {
    if (!isObj(raw.snack)) return bad('buffs.snack이 올바르지 않습니다.');
    const id = raw.snack.id;
    const until = num(raw.snack, 'until', 0, MAX_TIME, 'buffs.snack.until');
    if (SNACK_IDS.includes(id as SnackId)) buffs.snack = { id: id as SnackId, until };
  }
  if (raw.campaign != null) {
    if (!isObj(raw.campaign)) return bad('buffs.campaign이 올바르지 않습니다.');
    const id = raw.campaign.id;
    const until = num(raw.campaign, 'until', 0, MAX_TIME, 'buffs.campaign.until');
    if (CAMPAIGN_IDS.includes(id as CampaignId)) buffs.campaign = { id: id as CampaignId, until };
  }
  return buffs;
}

function parseCosmetics(raw: unknown): Cosmetics {
  if (raw === undefined) return { themes: ['default'], theme: 'default', title: null };
  if (!isObj(raw)) return bad('cosmetics가 올바르지 않습니다.');
  const owned = Array.isArray(raw.themes) ? raw.themes.filter((t): t is ThemeId => THEME_IDS.includes(t as ThemeId)) : [];
  const themes = [...new Set<ThemeId>(['default', ...owned])];
  const theme = themes.includes(raw.theme as ThemeId) ? (raw.theme as ThemeId) : 'default';
  const title = typeof raw.title === 'string' && raw.title.length > 0 && raw.title.length <= 40 ? raw.title : null;
  return { themes, theme, title };
}

function parseCounters(raw: unknown): Counters {
  const counters = zeroCounters();
  if (raw === undefined) return counters;
  if (!isObj(raw)) return bad('counters가 올바르지 않습니다.');
  for (const k of COUNTER_KEYS) if (raw[k] !== undefined) counters[k] = int(raw, k, 0, 1e12, `counters.${k}`);
  return counters;
}

function parseAchievements(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === undefined) return out;
  if (!isObj(raw)) return bad('achievements가 올바르지 않습니다.');
  for (const def of ACHIEVEMENTS) if (raw[def.id] !== undefined) out[def.id] = num(raw, def.id, 0, MAX_TIME, `achievements.${def.id}`);
  return out;
}

function parseMissions(raw: unknown): MissionState {
  const m = emptyMissions();
  if (raw === undefined) return m;
  if (!isObj(raw)) return bad('missions가 올바르지 않습니다.');
  const shortStr = (v: unknown) => (typeof v === 'string' && v.length <= 12 ? v : '');
  const base = (b: unknown, label: string): Record<string, number> => {
    const out: Record<string, number> = {};
    if (b === undefined) return out;
    if (!isObj(b)) return bad(`${label}가 올바르지 않습니다.`);
    for (const k of MISSION_METRICS) if (b[k] !== undefined) out[k] = int(b, k, 0, 1e12, `${label}.${k}`);
    return out;
  };
  return {
    day: shortStr(raw.day),
    week: shortStr(raw.week),
    dayBase: base(raw.dayBase, 'missions.dayBase'),
    weekBase: base(raw.weekBase, 'missions.weekBase'),
    claimed: Array.isArray(raw.claimed) ? raw.claimed.filter((x): x is string => typeof x === 'string' && x.length <= 12).slice(0, 40) : [],
    streak: raw.streak === undefined ? 0 : int(raw, 'streak', 0, 100000, 'missions.streak'),
    lastAttend: shortStr(raw.lastAttend),
  };
}

function parseFanMail(raw: unknown, lastSettledAt: number, seed: number): FanMail {
  const fresh = emptyFanMail(lastSettledAt, seed);
  if (raw === undefined) return fresh;
  if (!isObj(raw)) return bad('fanMail이 올바르지 않습니다.');
  const inbox: Mail[] = [];
  if (Array.isArray(raw.inbox)) {
    for (const x of raw.inbox.slice(-BALANCE.fanMail.cap)) {
      if (!isObj(x) || !mailTemplateById(String(x.tpl))) continue; // 사라진 템플릿의 DM은 버린다
      inbox.push({ id: str(x, 'id', 40, 'fanMail.inbox.id'), tpl: str(x, 'tpl', 40, 'fanMail.inbox.tpl'), nick: str(x, 'nick', 60, 'fanMail.inbox.nick'), at: num(x, 'at', 0, MAX_TIME, 'fanMail.inbox.at') });
    }
  }
  return {
    seed: int(raw, 'seed', 0, 0xffffffff, 'fanMail.seed'),
    seq: int(raw, 'seq', 0, 1e12, 'fanMail.seq'),
    nextAt: num(raw, 'nextAt', 0, MAX_TIME, 'fanMail.nextAt'),
    inbox,
  };
}

function parseMonogram(raw: unknown, seed: number): Monogram {
  const g = BALANCE.monogram;
  if (raw === undefined) return emptyMonogram(seed);
  if (!isObj(raw)) return bad('monogram이 올바르지 않습니다.');
  const slots = int(raw, 'slots', g.baseSlots, g.baseSlots + g.slotCosts.length, 'monogram.slots');
  const posts: Post[] = [];
  if (Array.isArray(raw.posts)) {
    for (const x of raw.posts.slice(0, slots)) {
      if (!isObj(x) || !POST_KINDS.includes(x.kind as Post['kind'])) continue;
      posts.push({
        id: str(x, 'id', 40, 'monogram.posts.id'),
        kind: x.kind as Post['kind'],
        persona: persona(x, 'persona', 'monogram.posts.persona'),
        at: num(x, 'at', 0, MAX_TIME, 'monogram.posts.at'),
        endsAt: num(x, 'endsAt', 0, MAX_TIME, 'monogram.posts.endsAt'),
      });
    }
  }
  return { seed: int(raw, 'seed', 0, 0xffffffff, 'monogram.seed'), seq: int(raw, 'seq', 0, 1e12, 'monogram.seq'), slots, posts };
}

export function validateState(input: unknown): Validation {
  try {
    if (!isObj(input)) return bad('저장 데이터가 객체가 아닙니다.');
    const o = migrate(input);
    const R = BALANCE.maxResource;

    const equipmentRaw = o.equipment;
    if (!isObj(equipmentRaw)) return bad('equipment가 없습니다.');
    const maxLv = BALANCE.equipment.maxLevel;
    const equipment = {
      mic: int(equipmentRaw, 'mic', 0, maxLv, 'equipment.mic'),
      studio: int(equipmentRaw, 'studio', 0, maxLv, 'equipment.studio'),
      promotion: int(equipmentRaw, 'promotion', 0, maxLv, 'equipment.promotion'),
    };

    // 어둠속성 장비·두 클릭 업그레이드는 나중에 추가된 필드라, 없는 예전 저장은 0레벨로 읽는다.
    // (클릭 업그레이드는 최대 레벨이 없지만 코인 상한 안에서는 100레벨도 못 간다.)
    let darkEquipment = { mic: 0, studio: 0, promotion: 0 };
    if (o.darkEquipment !== undefined) {
      const darkRaw = o.darkEquipment;
      if (!isObj(darkRaw)) return bad('darkEquipment가 올바르지 않습니다.');
      const darkMaxLv = BALANCE.darkEquipment.maxLevel;
      darkEquipment = {
        mic: int(darkRaw, 'mic', 0, darkMaxLv, 'darkEquipment.mic'),
        studio: int(darkRaw, 'studio', 0, darkMaxLv, 'darkEquipment.studio'),
        promotion: int(darkRaw, 'promotion', 0, darkMaxLv, 'darkEquipment.promotion'),
      };
    }
    let diamondUpgrades = { production: 0, royalty: 0, offline: 0 };
    if (o.diamondUpgrades !== undefined) {
      const dRaw = o.diamondUpgrades;
      if (!isObj(dRaw)) return bad('diamondUpgrades가 올바르지 않습니다.');
      const dMax = BALANCE.diamond.upgrade.maxLevel;
      diamondUpgrades = {
        production: int(dRaw, 'production', 0, dMax, 'diamondUpgrades.production'),
        royalty: int(dRaw, 'royalty', 0, dMax, 'diamondUpgrades.royalty'),
        // 오프라인 확장은 나중에 추가돼서 없는 예전 저장은 0레벨이다.
        offline: dRaw.offline === undefined ? 0 : int(dRaw, 'offline', 0, BALANCE.diamond.upgrade.offline.maxLevel, 'diamondUpgrades.offline'),
      };
    }
    const musicPower = o.musicPower === undefined ? 0 : int(o, 'musicPower', 0, 1000, 'musicPower');
    const dripPower = o.dripPower === undefined ? 0 : int(o, 'dripPower', 0, 1000, 'dripPower');

    // 스트리밍도 나중에 추가된 필드다. 없는 예전 저장은 0에서 시작하고, 첫 정산은 바로 가능하다(복귀 정산분만 쌓여 있다).
    let streaming: Streaming = {
      totals: zeroTotals(),
      settled: 0,
      lastClaimAt: num(o, 'lastSettledAt', 0, MAX_TIME),
      seed: streamSeedFrom(num(o, 'savedAt', 0, MAX_TIME)),
    };
    if (o.streaming !== undefined) {
      const stRaw = o.streaming;
      if (!isObj(stRaw) || !isObj(stRaw.totals)) return bad('streaming이 올바르지 않습니다.');
      const totals = zeroTotals();
      let sum = 0;
      for (const p of STREAM_PLATFORMS) {
        totals[p] = num(stRaw.totals, p, 0, R, `streaming.totals.${p}`);
        sum += totals[p];
      }
      streaming = {
        totals,
        // 정산한 양이 쌓인 양보다 많을 수는 없다. 고쳐진 파일이어도 정산 대기분이 음수가 되지 않게 맞춘다.
        settled: Math.min(num(stRaw, 'settled', 0, R * STREAM_PLATFORMS.length, 'streaming.settled'), sum),
        lastClaimAt: num(stRaw, 'lastClaimAt', 0, MAX_TIME, 'streaming.lastClaimAt'),
        seed: int(stRaw, 'seed', 0, 0xffffffff, 'streaming.seed'),
      };
    }

    if (!Array.isArray(o.singles) || o.singles.length > BALANCE.maxSingles) return bad('singles 목록이 올바르지 않습니다.');
    const singleIds = new Set<string>();
    const singles = o.singles.map((x, i) => {
      if (!isObj(x)) return bad(`singles[${i}]가 객체가 아닙니다.`);
      const id = str(x, 'id', 64, `singles[${i}].id`);
      if (singleIds.has(id)) return bad(`싱글 ID가 중복됩니다: ${id}`);
      singleIds.add(id);
      return {
        id,
        persona: persona(x, 'persona', `singles[${i}].persona`),
        title: str(x, 'title', 200, `singles[${i}].title`),
        releasedAt: num(x, 'releasedAt', 0, MAX_TIME, `singles[${i}].releasedAt`),
      };
    });

    // 앨범은 카탈로그 순서대로만 발매된다. 저장된 앨범은 발매 시각만 쓰고 제목·속성은 카탈로그에서 가져온다.
    // (예전 저장의 「싱글 2개로 만든 앨범」도 앞에서부터 카탈로그 앨범으로 옮겨 읽는다.)
    if (!Array.isArray(o.albums) || o.albums.length > BALANCE.maxSingles) return bad('albums 목록이 올바르지 않습니다.');
    const albums = o.albums.slice(0, ALBUM_CATALOG.length).map((x, i) => {
      if (!isObj(x)) return bad(`albums[${i}]가 객체가 아닙니다.`);
      const def = ALBUM_CATALOG[i];
      return { id: def.id, title: def.title, type: def.type, releasedAt: num(x, 'releasedAt', 0, MAX_TIME, `albums[${i}].releasedAt`) };
    });

    const concertsRaw = isObj(o.concerts) ? o.concerts : {};
    const concerts = {} as Record<StageId, ConcertRecord>;
    for (const id of STAGE_IDS) {
      const c = concertsRaw[id];
      if (c === undefined) {
        concerts[id] = { cleared: false, bestScore: 0, cooldownUntil: 0 };
        continue;
      }
      if (!isObj(c)) return bad(`concerts.${id}가 올바르지 않습니다.`);
      concerts[id] = {
        cleared: bool(c, 'cleared', `concerts.${id}.cleared`),
        bestScore: int(c, 'bestScore', 0, 1000, `concerts.${id}.bestScore`),
        cooldownUntil: num(c, 'cooldownUntil', 0, MAX_TIME, `concerts.${id}.cooldownUntil`),
      };
    }

    const flagsRaw = isObj(o.tutorialFlags) ? o.tutorialFlags : {};
    const tutorialFlags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(flagsRaw)) if (typeof v === 'boolean' && k.length <= 40) tutorialFlags[k] = v;

    const sRaw = isObj(o.settings) ? o.settings : {};
    const tone: DialogueTone = sRaw.dialogueTone === 'soft' ? 'soft' : 'original';
    const settings = {
      muted: sRaw.muted === true,
      bgmMuted: sRaw.bgmMuted === true,
      dialogueTone: tone,
      reducedMotion: sRaw.reducedMotion === true,
    };

    // 아래 필드는 모두 나중에 추가된 것이라 없는 예전 저장은 기본값으로 읽는다.
    const savedAtSeed = num(o, 'savedAt', 0, MAX_TIME);
    const buffs = parseBuffs(o.buffs);
    const cosmetics = parseCosmetics(o.cosmetics);
    const counters = parseCounters(o.counters);
    const achievements = parseAchievements(o.achievements);
    const missions = parseMissions(o.missions);
    const fanMail = parseFanMail(o.fanMail, num(o, 'lastSettledAt', 0, MAX_TIME), streamSeedFrom(savedAtSeed + 1));
    const monogram = parseMonogram(o.monogram, streamSeedFrom(savedAtSeed + 2));
    const seeds = packSeeds(savedAtSeed);
    const singleIdSet = new Set(singles.map((x) => x.id));
    const cards = parseCards(o.cards, seeds.cards, singleIdSet);
    const photo = parsePhoto(o.photo, seeds.photo);
    const feat = parseFeat(o.feat, seeds.feat);
    const mascot = parseMascots(o.mascot);
    const arcade = parseArcade(o.arcade, singleIdSet);
    const stats = parseStats(o.stats);

    const state: GameState = {
      schemaVersion: SCHEMA_VERSION,
      revision: int(o, 'revision', 0, Number.MAX_SAFE_INTEGER),
      savedAt: num(o, 'savedAt', 0, MAX_TIME),
      lastSettledAt: num(o, 'lastSettledAt', 0, MAX_TIME),
      coins: num(o, 'coins', 0, R),
      fans: num(o, 'fans', 0, R),
      normalRhymes: num(o, 'normalRhymes', 0, R),
      darkRhymes: num(o, 'darkRhymes', 0, R),
      activePersona: persona(o, 'activePersona'),
      heat: num(o, 'heat', 0, BALANCE.persona.maxHeat),
      switchLockedUntil: num(o, 'switchLockedUntil', 0, MAX_TIME),
      recoveryPenaltyUntil: num(o, 'recoveryPenaltyUntil', 0, MAX_TIME),
      recoveryReentryRequired: bool(o, 'recoveryReentryRequired'),
      equipment,
      darkEquipment,
      musicPower,
      dripPower,
      diamonds: o.diamonds === undefined ? 0 : num(o, 'diamonds', 0, R),
      diamondUpgrades,
      buffs,
      cosmetics,
      counters,
      achievements,
      missions,
      fanMail,
      monogram,
      cards,
      photo,
      feat,
      mascot,
      arcade,
      stats,
      streaming,
      singles,
      albums,
      concerts,
      tutorialFlags,
      settings,
    };
    // 다이아가 없던 예전 저장: 지금까지 한 일에 대한 다이아를 한 번 소급 지급한다.
    if (o.diamonds === undefined) state.diamonds = retroactiveDiamonds(state);
    return { ok: true, state };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    return { ok: false, error: '저장 데이터를 검증하는 중 알 수 없는 오류가 났습니다.' };
  }
}

export function parseSave(text: string): Validation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 형식이 깨져 있습니다.' };
  }
  return validateState(raw);
}

/* ---------- 저장·불러오기 ---------- */

export type LoadResult =
  | { status: 'new' }
  | { status: 'ok'; state: GameState }
  | { status: 'corrupt'; error: string; hasBackup: boolean };

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function loadGame(storage: StorageLike): LoadResult {
  const text = safeGet(storage, SAVE_KEY);
  if (text === null) return { status: 'new' };
  const v = parseSave(text);
  if (v.ok) return { status: 'ok', state: v.state };
  const backup = safeGet(storage, BACKUP_KEY);
  return { status: 'corrupt', error: v.error, hasBackup: backup !== null && parseSave(backup).ok };
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export type SaveResult = { ok: true; state: GameState } | { ok: false; error: string };

/**
 * 저장. 검증을 통과한 상태만 쓰고, 기존 정상 저장은 최소 간격마다 백업으로 남긴다.
 * 기존 저장이 손상돼 있으면 덮어쓰지 않는다. (호출자가 사용자 선택을 받아야 한다)
 */
export function saveGame(storage: StorageLike, state: GameState, now: number): SaveResult {
  const next: GameState = { ...state, revision: state.revision + 1, savedAt: now };
  const check = validateState(next);
  if (!check.ok) return { ok: false, error: check.error };
  try {
    const current = safeGet(storage, SAVE_KEY);
    if (current !== null) {
      const cur = parseSave(current);
      if (!cur.ok) return { ok: false, error: '기존 저장이 손상돼 있어 덮어쓰지 않았습니다.' };
      const backupText = safeGet(storage, BACKUP_KEY);
      const backup = backupText === null ? null : parseSave(backupText);
      const stale = !backup || !backup.ok || cur.state.savedAt - backup.state.savedAt >= BALANCE.save.backupMinIntervalMs;
      if (stale) storage.setItem(BACKUP_KEY, current);
    }
    storage.setItem(SAVE_KEY, serialize(next));
    return { ok: true, state: next };
  } catch {
    return { ok: false, error: '브라우저 저장소에 쓸 수 없습니다. (용량 부족이거나 저장이 차단됨)' };
  }
}

export function recoverFromBackup(storage: StorageLike): Validation {
  const text = safeGet(storage, BACKUP_KEY);
  if (text === null) return { ok: false, error: '백업이 없습니다.' };
  const v = parseSave(text);
  if (!v.ok) return v;
  storage.setItem(SAVE_KEY, text);
  return v;
}

/** 손상된 원본은 지우지 않고 별도 키에 보관한 뒤 새 게임을 시작할 수 있게 한다. */
export function discardCorrupt(storage: StorageLike): void {
  const raw = safeGet(storage, SAVE_KEY);
  if (raw !== null) {
    try {
      storage.setItem(CORRUPT_KEY, raw);
    } catch {
      /* 보관 실패는 무시 */
    }
  }
  storage.removeItem(SAVE_KEY);
}
