/*
 * 무대 디자인 빌더 「내 무대」의 순수 규칙. 서버는 게임 규칙을 검증하지 않지만, 다른 사람에게 보여 주는 무대는 서버가 점수·등급을 다시 계산해서
 * 내려줘야 해서(클라이언트가 보낸 등급을 믿지 않는다) 장치 표와 점수 식을 여기에도 둔다. 아래 값은 프런트 `balance.ts`의 `VENUE_DEVICES`·`BALANCE.venue`와
 * 같아야 하고, 프런트 테스트 `venue.test.ts`가 이 파일을 읽어 표·점수 식이 같은지 확인한다. 이 서버가 모르는 것은 해금 여부(어느 공연장을 클리어했는지)다.
 */

export const VENUE_W = 8;
export const VENUE_H = 6;
export const VENUE_CELLS = VENUE_W * VENUE_H;

export type DeviceKind = 'light' | 'sound' | 'fx' | 'safety' | 'mood';
export type VenueStat = 'glam' | 'sound' | 'safety' | 'mood';
export type VenueTheme = 'normal' | 'dark';

/** 장치 표: 갈래·기본값(능력치에 더해지는 점수)·한 무대에 놓을 수 있는 최대 개수 */
export const DEVICES = {
  spot: { kind: 'light', base: 1, max: 6 },
  mirrorball: { kind: 'light', base: 2, max: 4 },
  laser: { kind: 'light', base: 2, max: 4 },
  wire: { kind: 'light', base: 3, max: 2 },
  speaker: { kind: 'sound', base: 1, max: 6 },
  micstand: { kind: 'sound', base: 2, max: 4 },
  subwoofer: { kind: 'sound', base: 3, max: 2 },
  flame: { kind: 'fx', base: 2, max: 4 },
  dryice: { kind: 'fx', base: 2, max: 3 },
  confetti: { kind: 'fx', base: 3, max: 3 },
  led: { kind: 'fx', base: 3, max: 2 },
  bar: { kind: 'safety', base: 1, max: 6 },
  candle: { kind: 'mood', base: 1, max: 6 },
  monitor: { kind: 'mood', base: 2, max: 3 },
  coffin: { kind: 'mood', base: 3, max: 1 },
} as const satisfies Record<string, { kind: DeviceKind; base: number; max: number }>;
export type DeviceId = keyof typeof DEVICES;
export const DEVICE_IDS = Object.keys(DEVICES) as DeviceId[];

const isDevice = (v: unknown): v is DeviceId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DEVICES, v);

/** 능력치마다 점수에 더해지는 값. 조명 옆 연출 · 좌우 대칭 스피커 배율과 위험한 연출 하나당 안전 감점 */
export const LIGHT_FX_MULT = 1.25;
export const SPEAKER_SYMMETRY_MULT = 1.2;
export const HAZARD_PENALTY = 2;

/** 등급 E·D·C·B·A·S(번호 0~5)에 닿는 최소 점수 */
export const GRADE_MIN: readonly number[] = [0, 8, 18, 36, 60, 84];
/** 조명이나 음향이 하나도 없을 때 올라갈 수 있는 가장 높은 등급(C) */
export const GRADE_CAP_MISSING = 2;
/** 무대 배율 = 1 + 등급당 0.05 (E ×1 ~ S ×1.25) */
export const GRADE_MULT_STEP = 0.05;
export const gradeMult = (grade: number): number => 1 + GRADE_MULT_STEP * grade;

/* ---------- 서버가 정하는 값(프런트는 화면 문구로만 쓴다) ---------- */

/** 이 팬 수부터 무대를 올리고 남의 무대에서 공연하고 좋아요를 누를 수 있다(여러 계정을 만들어 대관료·인기 보상을 모으는 것을 막는다). */
export const VENUE_MIN_FANS = 1000;
export const NAME_MIN = 2;
export const NAME_MAX = 16;
/** 하루에 공연할 수 있는 남의 무대 수 */
export const VISITS_PER_DAY = 3;
/** 방문자 한 명이 공연할 때 주인에게 가는 대관료(다이아)와 주인이 하루에 받을 수 있는 대관료 횟수 */
export const RENT_FEE = 1;
export const RENT_DAILY_MAX = 5;
/** 지난주 인기 무대 1·2·3위 보상(다이아) */
export const WEEKLY_REWARDS: readonly number[] = [30, 20, 10];
/** 둘러보기 한 쪽에 내려주는 무대 수와 볼 수 있는 최대 쪽 수 */
export const LIST_PAGE_SIZE = 20;
export const LIST_MAX_PAGE = 50;

export type Cells = (DeviceId | null)[];

/** 올라온 칸 배열을 읽는다. 길이가 48이 아니거나 모르는 장치·개수 한도를 넘은 장치가 있으면 null(정직한 클라이언트는 그런 값을 보내지 않는다). */
export function parseCells(raw: unknown): Cells | null {
  if (!Array.isArray(raw) || raw.length !== VENUE_CELLS) return null;
  const used: Partial<Record<DeviceId, number>> = {};
  const out: Cells = [];
  for (const c of raw as unknown[]) {
    if (c === null) {
      out.push(null);
      continue;
    }
    if (!isDevice(c)) return null;
    used[c] = (used[c] ?? 0) + 1;
    if ((used[c] ?? 0) > DEVICES[c].max) return null;
    out.push(c);
  }
  return out;
}

/** 저장된 문자열 칸('' = 빈 칸)을 칸 배열로 되돌린다. 모양이 이상한 칸은 빈 칸으로 본다. */
export function cellsFromStored(stored: readonly string[] | null | undefined): Cells {
  const out: Cells = Array.from({ length: VENUE_CELLS }, () => null);
  (stored ?? []).slice(0, VENUE_CELLS).forEach((c, i) => {
    if (isDevice(c)) out[i] = c;
  });
  return out;
}

export const cellsToStored = (cells: Cells): string[] => cells.map((c) => c ?? '');

export const isTheme = (v: unknown): v is VenueTheme => v === 'normal' || v === 'dark';

export interface VenueScore {
  glam: number;
  sound: number;
  safety: number;
  mood: number;
  /** 가까이(주변 8칸)에 안전바가 없는 연출 장치 수. 하나마다 안전 −2 */
  hazards: number;
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

/** 점수와 등급. 같은 칸·테마면 항상 같다. */
export function scoreVenue(cells: Cells, theme: VenueTheme): VenueScore {
  const at = (r: number, c: number): DeviceId | null => (r < 0 || r >= VENUE_H || c < 0 || c >= VENUE_W ? null : (cells[r * VENUE_W + c] ?? null));
  const near4 = (r: number, c: number, pred: (d: DeviceId) => boolean): boolean =>
    [at(r - 1, c), at(r + 1, c), at(r, c - 1), at(r, c + 1)].some((d) => d !== null && pred(d));
  const near8 = (r: number, c: number, pred: (d: DeviceId) => boolean): boolean => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const d = at(r + dr, c + dc);
        if (d !== null && pred(d)) return true;
      }
    }
    return false;
  };

  let glam = 0;
  let sound = 0;
  let safety = 0;
  let mood = 0;
  let hazards = 0;
  let lights = 0;
  let sounds = 0;
  let devices = 0;
  for (let r = 0; r < VENUE_H; r++) {
    for (let c = 0; c < VENUE_W; c++) {
      const id = at(r, c);
      if (!id) continue;
      const def = DEVICES[id];
      devices++;
      if (def.kind === 'light') {
        glam += def.base;
        lights++;
      } else if (def.kind === 'fx') {
        glam += def.base * (near4(r, c, (d) => DEVICES[d].kind === 'light') ? LIGHT_FX_MULT : 1);
        if (!near8(r, c, (d) => DEVICES[d].kind === 'safety')) hazards++;
      } else if (def.kind === 'sound') {
        sound += def.base * (id === 'speaker' && at(r, VENUE_W - 1 - c) === 'speaker' ? SPEAKER_SYMMETRY_MULT : 1);
        sounds++;
      } else if (def.kind === 'safety') {
        safety += def.base;
      } else if (theme === 'dark') {
        mood += def.base;
      }
    }
  }
  safety -= HAZARD_PENALTY * hazards;
  const total = Math.max(0, round2(glam + sound + safety + mood));
  let grade = 0;
  GRADE_MIN.forEach((min, i) => {
    if (total >= min) grade = i;
  });
  const capped = (lights < 1 || sounds < 1) && grade > GRADE_CAP_MISSING;
  if (capped) grade = GRADE_CAP_MISSING;
  return { glam: round2(glam), sound: round2(sound), safety: round2(safety), mood: round2(mood), hazards, lights, sounds, devices, total, grade, capped };
}

export interface WeeklyRow {
  /** 무대 ID */
  id: string;
  /** 그 주에 받은 좋아요 수 */
  n: number;
}

export interface WeeklyRank {
  id: string;
  rank: number;
  n: number;
  diamonds: number;
}

/**
 * 지난주 인기 무대 순위. 좋아요가 많은 순(같으면 앞선 행이 먼저)으로 오는 rows 중 숨김 처리되지 않은 무대(visible)만 남겨 위에서 3곳에 보상을 붙인다.
 * 좋아요가 하나도 없으면 순위에 오르지 않는다.
 */
export function rankWeekly(rows: readonly WeeklyRow[], visible: ReadonlySet<string>): WeeklyRank[] {
  const out: WeeklyRank[] = [];
  for (const row of rows) {
    if (out.length >= WEEKLY_REWARDS.length) break;
    if (row.n < 1 || !visible.has(row.id)) continue;
    out.push({ id: row.id, rank: out.length + 1, n: row.n, diamonds: WEEKLY_REWARDS[out.length] });
  }
  return out;
}
