import { BALANCE, SCHEMA_VERSION, STAGE_IDS } from './balance';
import { ALBUM_CATALOG } from './content';
import type { ConcertRecord, DialogueTone, GameState, Persona, StageId } from './types';

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
    singles: [],
    albums: [],
    concerts,
    tutorialFlags: {},
    settings: { muted: false, bgmMuted: false, dialogueTone: 'original', reducedMotion },
  };
}

/* ---------- 검증 ---------- */

export type Validation = { ok: true; state: GameState } | { ok: false; error: string };

class Invalid extends Error {}
const bad = (msg: string): never => {
  throw new Invalid(msg);
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(o: Obj, key: string, min: number, max: number, label = key): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${label}: 숫자가 아니거나 비정상 값입니다.`);
  if (v < min || v > max) return bad(`${label}: 허용 범위(${min}~${max})를 벗어났습니다.`);
  return v;
}
function int(o: Obj, key: string, min: number, max: number, label = key): number {
  const v = num(o, key, min, max, label);
  if (!Number.isInteger(v)) return bad(`${label}: 정수여야 합니다.`);
  return v;
}
function str(o: Obj, key: string, maxLen = 200, label = key): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) return bad(`${label}: 문자열이 올바르지 않습니다.`);
  return v;
}
function bool(o: Obj, key: string, label = key): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') return bad(`${label}: true/false 값이어야 합니다.`);
  return v;
}
function persona(o: Obj, key: string, label = key): Persona {
  const v = o[key];
  if (v !== 'normal' && v !== 'dark') return bad(`${label}: 알 수 없는 자아입니다.`);
  return v;
}

const MAX_TIME = 8.64e15;

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
      singles,
      albums,
      concerts,
      tutorialFlags,
      settings,
    };
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

export function exportSave(state: GameState, now: number): string {
  return JSON.stringify({ ...state, savedAt: now }, null, 2);
}

/**
 * 불러오기. 검증에 실패하면 현재 저장을 건드리지 않는다.
 * 가져온 파일의 lastSettledAt은 now로 맞춘다: 오래된 파일을 반복해서 불러와 오프라인 보상을 재청구할 수 없다.
 */
export function importSave(storage: StorageLike, text: string, now: number): SaveResult {
  const v = parseSave(text);
  if (!v.ok) return { ok: false, error: v.error };
  const current = safeGet(storage, SAVE_KEY);
  if (current !== null) {
    try {
      storage.setItem(BACKUP_KEY, current);
    } catch {
      /* 백업 실패는 불러오기를 막지 않는다 */
    }
  }
  const state: GameState = { ...v.state, lastSettledAt: now };
  try {
    storage.setItem(SAVE_KEY, serialize({ ...state, savedAt: now }));
  } catch {
    return { ok: false, error: '브라우저 저장소에 쓸 수 없습니다.' };
  }
  return { ok: true, state };
}

export function resetSave(storage: StorageLike): void {
  const current = safeGet(storage, SAVE_KEY);
  if (current !== null) {
    try {
      storage.setItem(BACKUP_KEY, current);
    } catch {
      /* ignore */
    }
  }
  storage.removeItem(SAVE_KEY);
}
