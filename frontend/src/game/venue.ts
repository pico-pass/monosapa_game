import { BALANCE, VENUE_DEVICES, venueDeviceDef, type VenueDeviceDef } from './balance';
import { clampResource, royaltyRate } from './selectors';
import type { CommandResult, Fail, FailReason, GameState, Persona, Venue, VenueDeviceId } from './types';

/*
 * 무대 디자인 빌더 「내 무대」. 8열 × 6행 바닥에 장치를 놓아 무대를 꾸미고, 점수·등급으로 무대 배율이 정해진다.
 * 점수 식은 서버 `backend/src/venues/rules.ts`와 같아야 한다(서버가 올라온 무대의 등급을 다시 계산한다. 프런트 테스트 venue.test.ts가 두 구현을 비교한다).
 * 이 파일은 초안(state.venue)을 만지는 명령과 코인 보상 계산만 한다. 올리기·둘러보기·남의 무대 공연·좋아요는 서버 일이고 store/gameStore.ts가 이어 준다.
 * 수치는 balance.ts의 BALANCE.venue·VENUE_DEVICES.
 */

const V = BALANCE.venue;
export const VENUE_CELLS = V.w * V.h;
export const GRADE_LETTERS = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
export const MAX_GRADE = GRADE_LETTERS.length - 1;

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export type VenueCells = (VenueDeviceId | null)[];

export const venueUnlocked = (fans: number): boolean => fans >= V.unlockFans;
export const emptyCells = (): VenueCells => Array.from({ length: VENUE_CELLS }, () => null);
export const emptyVenue = (): Venue => ({ name: '', theme: 'normal', cells: emptyCells(), ownAt: 0 });

/** 무대 배율 = 1 + 등급당 gradeMultStep (E ×1 ~ S ×1.25) */
export const venueMult = (grade: number): number => 1 + V.gradeMultStep * clampGrade(grade);
const clampGrade = (grade: number): number => Math.max(0, Math.min(MAX_GRADE, Math.floor(Number.isFinite(grade) ? grade : 0)));

/** 공연장 첫 클리어로 해금되는 장치인지(클리어 조건이 없는 장치는 처음부터 쓴다). */
export const deviceUnlocked = (state: Pick<GameState, 'concerts'>, def: VenueDeviceDef): boolean => def.unlock === null || !!state.concerts[def.unlock]?.cleared;
export const unlockedDevices = (state: Pick<GameState, 'concerts'>): VenueDeviceDef[] => VENUE_DEVICES.filter((d) => deviceUnlocked(state, d));

export const deviceCount = (cells: readonly (VenueDeviceId | null)[], id: VenueDeviceId): number => cells.reduce((n, c) => n + (c === id ? 1 : 0), 0);
export const placedCount = (cells: readonly (VenueDeviceId | null)[]): number => cells.reduce((n, c) => n + (c ? 1 : 0), 0);

/* ---------- 점수 ---------- */

export interface VenueScore {
  glam: number;
  sound: number;
  safety: number;
  mood: number;
  /** 주변 8칸에 안전바가 없는 연출 장치 수. 하나마다 안전 −hazardPenalty */
  hazards: number;
  /** 위험한 연출 장치가 있는 칸 번호 */
  hazardCells: number[];
  lights: number;
  sounds: number;
  devices: number;
  total: number;
  /** 0(E) ~ 5(S) */
  grade: number;
  /** 조명·음향이 없어서 등급이 C로 막혔다 */
  capped: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 점수와 등급. 같은 칸·테마면 항상 같다. 서버 `scoreVenue`와 같은 식이다(순서까지 같게 써서 부동소수점 결과도 같다). */
export function scoreVenue(cells: readonly (VenueDeviceId | null)[], theme: Persona): VenueScore {
  const at = (r: number, c: number): VenueDeviceId | null => (r < 0 || r >= V.h || c < 0 || c >= V.w ? null : (cells[r * V.w + c] ?? null));
  const kindOf = (id: VenueDeviceId | null) => (id ? venueDeviceDef(id).kind : null);
  const near4Light = (r: number, c: number): boolean => [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].some((d) => kindOf(d) === 'light');
  const near8Safety = (r: number, c: number): boolean => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (kindOf(at(r + dr, c + dc)) === 'safety') return true;
      }
    }
    return false;
  };

  let glam = 0;
  let sound = 0;
  let safety = 0;
  let mood = 0;
  let lights = 0;
  let sounds = 0;
  let devices = 0;
  const hazardCells: number[] = [];
  for (let r = 0; r < V.h; r++) {
    for (let c = 0; c < V.w; c++) {
      const id = at(r, c);
      if (!id) continue;
      const def = venueDeviceDef(id);
      devices++;
      if (def.kind === 'light') {
        glam += def.base;
        lights++;
      } else if (def.kind === 'fx') {
        glam += def.base * (near4Light(r, c) ? V.lightFxMult : 1);
        if (!near8Safety(r, c)) hazardCells.push(r * V.w + c);
      } else if (def.kind === 'sound') {
        sound += def.base * (id === 'speaker' && at(r, V.w - 1 - c) === 'speaker' ? V.speakerSymmetryMult : 1);
        sounds++;
      } else if (def.kind === 'safety') {
        safety += def.base;
      } else if (theme === 'dark') {
        mood += def.base;
      }
    }
  }
  const hazards = hazardCells.length;
  safety -= V.hazardPenalty * hazards;
  const total = Math.max(0, round2(glam + sound + safety + mood));
  let grade = 0;
  V.gradeMin.forEach((min, i) => {
    if (total >= min) grade = i;
  });
  const capped = (lights < 1 || sounds < 1) && grade > V.gradeCapMissing;
  if (capped) grade = V.gradeCapMissing;
  return { glam: round2(glam), sound: round2(sound), safety: round2(safety), mood: round2(mood), hazards, hazardCells, lights, sounds, devices, total, grade, capped };
}

/* ---------- 이름 ---------- */

/** 입력 중인 이름: 제어 문자는 공백으로 바꾸고 최대 길이에서 자른다(앞뒤 공백 정리는 올릴 때 한다). */
export function cleanVenueName(raw: string): string {
  return [...raw]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ? ' ' : ch;
    })
    .slice(0, V.nameMax)
    .join('');
}

/** 올릴 때 보내는 이름(연속 공백을 하나로 줄이고 앞뒤를 자른다). 서버 `cleanLine`과 같은 결과다. */
export const submitName = (name: string): string => name.replace(/\s+/g, ' ').trim();

export type UploadIssue = 'locked' | 'name' | 'empty';
/** 지금 초안을 올릴 수 없는 이유(올릴 수 있으면 null) */
export function uploadIssue(state: Pick<GameState, 'fans' | 'venue'>): UploadIssue | null {
  if (!venueUnlocked(state.fans)) return 'locked';
  const n = [...submitName(state.venue.name)].length;
  if (n < V.nameMin || n > V.nameMax) return 'name';
  if (placedCount(state.venue.cells) === 0) return 'empty';
  return null;
}

/* ---------- 초안 명령 ---------- */

const withVenue = (state: GameState, patch: Partial<Venue>): GameState => ({ ...state, venue: { ...state.venue, ...patch } });

/** 칸 하나에 장치를 놓거나(id) 비운다(null). 이미 같은 장치면 그대로 둔다. */
export function placeDevice(state: GameState, index: number, id: VenueDeviceId | null): CommandResult {
  if (!venueUnlocked(state.fans)) return fail(state, 'venue_locked');
  if (!Number.isInteger(index) || index < 0 || index >= VENUE_CELLS) return fail(state, 'venue_invalid');
  const cells = state.venue.cells.slice();
  if (id !== null) {
    const def = VENUE_DEVICES.find((d) => d.id === id);
    if (!def) return fail(state, 'venue_invalid');
    if (!deviceUnlocked(state, def)) return fail(state, 'venue_device_locked');
    if (cells[index] === id) return { ok: true, state };
    if (deviceCount(cells, id) >= def.max) return fail(state, 'venue_limit');
  }
  cells[index] = id;
  return { ok: true, state: withVenue(state, { cells }) };
}

/** 장치를 모두 치운다(이름·분위기는 그대로). */
export function clearVenue(state: GameState): CommandResult {
  if (!venueUnlocked(state.fans)) return fail(state, 'venue_locked');
  return { ok: true, state: withVenue(state, { cells: emptyCells() }) };
}

export function setVenueName(state: GameState, name: string): CommandResult {
  if (!venueUnlocked(state.fans)) return fail(state, 'venue_locked');
  return { ok: true, state: withVenue(state, { name: cleanVenueName(name) }) };
}

export function setVenueTheme(state: GameState, theme: Persona): CommandResult {
  if (!venueUnlocked(state.fans)) return fail(state, 'venue_locked');
  if (theme !== 'normal' && theme !== 'dark') return fail(state, 'venue_invalid');
  return { ok: true, state: withVenue(state, { theme }) };
}

/* ---------- 공연 보상 ---------- */

/** 내 무대 공연까지 남은 시간(ms). 0이면 지금 할 수 있다. */
export const ownPlayWaitMs = (venue: Pick<Venue, 'ownAt'>, now: number): number => Math.max(0, venue.ownAt + V.ownCooldownMs - now);

/** 내 무대 공연으로 받을 코인(지금 초안의 등급 기준) */
export function ownPlayCoins(state: GameState): number {
  return royaltyRate(state) * V.ownSecs * venueMult(scoreVenue(state.venue.cells, state.venue.theme).grade);
}

/** 내 무대에서 공연한다: ownCooldownMs마다 한 번, 인세 ownSecs초 분량 × 무대 배율. 장치가 하나도 없는 무대에서는 공연할 수 없다. */
export function playOwnVenue(state: GameState, now: number): CommandResult<{ coins: number; grade: number }> {
  if (!venueUnlocked(state.fans)) return fail(state, 'venue_locked');
  if (placedCount(state.venue.cells) === 0) return fail(state, 'venue_empty');
  if (ownPlayWaitMs(state.venue, now) > 0) return fail(state, 'venue_cooldown');
  const grade = scoreVenue(state.venue.cells, state.venue.theme).grade;
  const coins = Math.floor(ownPlayCoins(state));
  return { ok: true, state: { ...withVenue(state, { ownAt: now }), coins: clampResource(state.coins + coins) }, coins, grade };
}

/** 남의 무대 공연 코인 = 인세 visitSecs초 분량 × (visitBase + visitStep × 등급 번호) */
export const visitCoins = (state: GameState, grade: number): number => Math.floor(royaltyRate(state) * V.visitSecs * (V.visitBase + V.visitStep * clampGrade(grade)));

/** 남의 무대에서 공연한 보상을 반영한다. 서버가 하루 한도·하루 한 번을 지키고 무대 등급을 돌려준다(코인은 클라이언트가 계산하는 기존 서버 보상과 같은 신뢰 모델). */
export function applyVenueVisit(state: GameState, grade: number): CommandResult<{ coins: number; grade: number }> {
  if (!venueUnlocked(state.fans)) return fail(state, 'venue_locked');
  const g = clampGrade(grade);
  const coins = visitCoins(state, g);
  return { ok: true, state: { ...state, coins: clampResource(state.coins + coins) }, coins, grade: g };
}
