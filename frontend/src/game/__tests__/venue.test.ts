import { describe, expect, it } from 'vitest';
import * as server from '../../../../backend/src/venues/rules';
import { BALANCE, STAGE_IDS, VENUE_DEVICES } from '../balance';
import { VENUE_DEVICE_TEXT, VENUE_KIND_TEXT, venueDeviceEffect } from '../content';
import { createInitialState, validateState } from '../persistence';
import { royaltyRate } from '../selectors';
import { applyVenueClaim } from '../serverRewards';
import type { ConcertRecord, GameState, StageId, VenueDeviceId } from '../types';
import {
  GRADE_LETTERS,
  VENUE_CELLS,
  applyVenueVisit,
  cleanVenueName,
  clearVenue,
  deviceUnlocked,
  emptyCells,
  emptyVenue,
  ownPlayCoins,
  ownPlayWaitMs,
  placeDevice,
  placedCount,
  playOwnVenue,
  scoreVenue,
  setVenueName,
  setVenueTheme,
  submitName,
  unlockedDevices,
  uploadIssue,
  venueMult,
  venueUnlocked,
  visitCoins,
  type VenueCells,
} from '../venue';

const V = BALANCE.venue;
const T0 = new Date(2026, 10, 18, 12, 0, 0).getTime();
const base = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), fans: 100_000, lastSettledAt: T0, ...over });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const failReason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);
const cleared = (...ids: StageId[]): GameState['concerts'] => {
  const c = { ...createInitialState(T0).concerts };
  for (const id of ids) c[id] = { ...(c[id] as ConcertRecord), cleared: true };
  return c;
};
const cell = (r: number, c: number) => r * V.w + c;
const withCells = (s: GameState, placed: [number, number, VenueDeviceId][]): GameState => {
  const cells = emptyCells();
  for (const [r, c, id] of placed) cells[cell(r, c)] = id;
  return { ...s, venue: { ...s.venue, cells } };
};

describe('내 무대: 서버와 같은 약속', () => {
  it('그리드 크기·점수 식 상수·등급 경계가 서버 규칙 파일과 같다', () => {
    expect(V.w).toBe(server.VENUE_W);
    expect(V.h).toBe(server.VENUE_H);
    expect(VENUE_CELLS).toBe(server.VENUE_CELLS);
    expect(V.lightFxMult).toBe(server.LIGHT_FX_MULT);
    expect(V.speakerSymmetryMult).toBe(server.SPEAKER_SYMMETRY_MULT);
    expect(V.hazardPenalty).toBe(server.HAZARD_PENALTY);
    expect([...V.gradeMin]).toEqual([...server.GRADE_MIN]);
    expect(V.gradeCapMissing).toBe(server.GRADE_CAP_MISSING);
    expect(V.gradeMultStep).toBe(server.GRADE_MULT_STEP);
    for (let g = 0; g <= 5; g++) expect(venueMult(g)).toBe(server.gradeMult(g));
  });

  it('장치 표(ID·갈래·기본값·최대 개수)가 서버와 같다', () => {
    expect(VENUE_DEVICES.map((d) => d.id).sort()).toEqual([...server.DEVICE_IDS].sort());
    for (const d of VENUE_DEVICES) {
      const s = server.DEVICES[d.id];
      expect({ kind: d.kind, base: d.base, max: d.max }, d.id).toEqual({ kind: s.kind, base: s.base, max: s.max });
    }
  });

  it('서버가 정하는 값(열리는 팬 수·이름 길이·방문 한도·대관료·주간 보상)이 문구용 값과 같다', () => {
    expect(V.unlockFans).toBe(server.VENUE_MIN_FANS);
    expect(V.nameMin).toBe(server.NAME_MIN);
    expect(V.nameMax).toBe(server.NAME_MAX);
    expect(V.visitsPerDay).toBe(server.VISITS_PER_DAY);
    expect(V.rentFee).toBe(server.RENT_FEE);
    expect(V.rentDailyMax).toBe(server.RENT_DAILY_MAX);
    expect([...V.weeklyRewards]).toEqual([...server.WEEKLY_REWARDS]);
  });

  it('무작위 배치 400개의 점수·등급이 서버와 같다(일반·어둠 모두)', () => {
    let seed = 12345;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const ids = VENUE_DEVICES.map((d) => d.id);
    for (let n = 0; n < 400; n++) {
      const cells: VenueCells = emptyCells();
      const used: Record<string, number> = {};
      const fill = 0.2 + rand() * 0.7;
      for (let i = 0; i < VENUE_CELLS; i++) {
        if (rand() > fill) continue;
        const id = ids[Math.floor(rand() * ids.length)];
        const max = VENUE_DEVICES.find((d) => d.id === id)!.max;
        if ((used[id] ?? 0) >= max) continue;
        used[id] = (used[id] ?? 0) + 1;
        cells[i] = id;
      }
      for (const theme of ['normal', 'dark'] as const) {
        const a = scoreVenue(cells, theme);
        const b = server.scoreVenue(cells, theme);
        expect({ glam: a.glam, sound: a.sound, safety: a.safety, mood: a.mood, hazards: a.hazards, lights: a.lights, sounds: a.sounds, devices: a.devices, total: a.total, grade: a.grade, capped: a.capped }, `${n}/${theme}`).toEqual(b);
      }
    }
  });

  it('해금 공연장은 모두 실제 공연장이고 설계서 표와 같다', () => {
    for (const d of VENUE_DEVICES) if (d.unlock) expect(STAGE_IDS, d.id).toContain(d.unlock);
    const unlock = Object.fromEntries(VENUE_DEVICES.map((d) => [d.id, d.unlock]));
    expect(unlock).toMatchObject({
      spot: null,
      speaker: null,
      bar: null,
      mirrorball: 'hall',
      laser: 'solo',
      wire: 'universe',
      micstand: 'club',
      subwoofer: 'large',
      flame: 'medium',
      dryice: 'large',
      confetti: 'arena',
      led: 'world',
      candle: 'rooftop',
      monitor: 'ruins',
      coffin: 'garage',
    });
  });

  it('장치마다 문구·갈래 문구가 있고 효과 문구가 수치를 담는다', () => {
    const rules = { lightFxMult: V.lightFxMult, speakerSymmetryMult: V.speakerSymmetryMult, hazardPenalty: V.hazardPenalty };
    for (const d of VENUE_DEVICES) {
      expect(VENUE_DEVICE_TEXT[d.id].name.length, d.id).toBeGreaterThan(0);
      expect(VENUE_KIND_TEXT[d.kind].name.length, d.id).toBeGreaterThan(0);
      expect(venueDeviceEffect(d, rules), d.id).toContain(`+${d.base}`);
    }
    expect(venueDeviceEffect(VENUE_DEVICES.find((d) => d.id === 'flame')!, rules)).toContain('×1.25');
    expect(venueDeviceEffect(VENUE_DEVICES.find((d) => d.id === 'speaker')!, rules)).toContain('×1.2');
  });
});

describe('내 무대: 점수', () => {
  it('빈 무대는 E, 점수 0이다', () => {
    const s = scoreVenue(emptyCells(), 'normal');
    expect(s.total).toBe(0);
    expect(GRADE_LETTERS[s.grade]).toBe('E');
  });

  it('위험한 연출 칸 번호를 알려 준다', () => {
    const s = withCells(base(), [[2, 2, 'flame'], [0, 0, 'spot'], [4, 5, 'dryice'], [4, 6, 'bar']]);
    const score = scoreVenue(s.venue.cells, 'normal');
    expect(score.hazardCells).toEqual([cell(2, 2)]);
    expect(score.hazards).toBe(1);
  });

  it('조명 옆 연출 ×1.25, 대칭 스피커 ×1.2, 안전바 없는 연출 안전 −2', () => {
    const s = scoreVenue(withCells(base(), [[2, 2, 'spot'], [2, 3, 'confetti'], [1, 3, 'bar'], [1, 1, 'speaker'], [1, 6, 'speaker']]).venue.cells, 'normal');
    expect(s.glam).toBe(1 + 3 * 1.25);
    expect(s.sound).toBe(2 * 1.2);
    expect(s.hazards).toBe(0);
    const r = scoreVenue(withCells(base(), [[2, 2, 'confetti']]).venue.cells, 'normal');
    expect(r.safety).toBe(-2);
  });
});

describe('내 무대: 열림과 해금', () => {
  it('팬 1,000명부터 열리고 그전에는 모든 초안 명령이 막힌다', () => {
    expect(venueUnlocked(V.unlockFans - 1)).toBe(false);
    expect(venueUnlocked(V.unlockFans)).toBe(true);
    const locked = base({ fans: V.unlockFans - 1 });
    expect(failReason(placeDevice(locked, 0, 'spot'))).toBe('venue_locked');
    expect(failReason(clearVenue(locked))).toBe('venue_locked');
    expect(failReason(setVenueName(locked, '이름'))).toBe('venue_locked');
    expect(failReason(setVenueTheme(locked, 'dark'))).toBe('venue_locked');
    expect(failReason(playOwnVenue(locked, T0))).toBe('venue_locked');
    expect(failReason(applyVenueVisit(locked, 3))).toBe('venue_locked');
  });

  it('처음에는 조명·스피커·안전바 세 가지만 쓴다', () => {
    expect(unlockedDevices(base()).map((d) => d.id).sort()).toEqual(['bar', 'speaker', 'spot']);
  });

  it('공연장을 처음 클리어하면 그 장치가 열린다', () => {
    const s = base({ concerts: cleared('club', 'hall') });
    const ids = unlockedDevices(s).map((d) => d.id);
    expect(ids).toContain('micstand');
    expect(ids).toContain('mirrorball');
    expect(ids).not.toContain('laser');
    const mirrorball = VENUE_DEVICES.find((d) => d.id === 'mirrorball')!;
    expect(deviceUnlocked(s, mirrorball)).toBe(true);
  });

  it('모든 공연장을 클리어하면 15종이 모두 열린다', () => {
    expect(unlockedDevices(base({ concerts: cleared(...STAGE_IDS) }))).toHaveLength(15);
  });
});

describe('내 무대: 초안 명령', () => {
  it('열린 장치를 칸에 놓고 같은 칸에 다른 장치를 놓으면 바뀐다', () => {
    let s = ok(placeDevice(base(), 5, 'spot')).state;
    expect(s.venue.cells[5]).toBe('spot');
    s = ok(placeDevice(s, 5, 'speaker')).state;
    expect(s.venue.cells[5]).toBe('speaker');
    expect(placedCount(s.venue.cells)).toBe(1);
  });

  it('null이면 칸을 비운다', () => {
    const s = ok(placeDevice(ok(placeDevice(base(), 5, 'spot')).state, 5, null)).state;
    expect(s.venue.cells[5]).toBeNull();
  });

  it('범위 밖 칸·모르는 장치는 거절한다', () => {
    expect(failReason(placeDevice(base(), -1, 'spot'))).toBe('venue_invalid');
    expect(failReason(placeDevice(base(), VENUE_CELLS, 'spot'))).toBe('venue_invalid');
    expect(failReason(placeDevice(base(), 1.5, 'spot'))).toBe('venue_invalid');
    expect(failReason(placeDevice(base(), 0, 'rocket' as VenueDeviceId))).toBe('venue_invalid');
  });

  it('아직 열리지 않은 장치는 거절한다', () => {
    expect(failReason(placeDevice(base(), 0, 'laser'))).toBe('venue_device_locked');
    expect(ok(placeDevice(base({ concerts: cleared('solo') }), 0, 'laser')).state.venue.cells[0]).toBe('laser');
  });

  it('장치마다 최대 개수를 넘기지 못한다(다른 칸을 치우면 놓을 수 있다)', () => {
    let s = base();
    for (let i = 0; i < 6; i++) s = ok(placeDevice(s, i, 'spot')).state;
    expect(failReason(placeDevice(s, 6, 'spot'))).toBe('venue_limit');
    // 이미 같은 장치가 있는 칸은 그대로 두는 것이라 한도에 걸리지 않는다
    expect(placeDevice(s, 0, 'spot').ok).toBe(true);
    s = ok(placeDevice(s, 0, null)).state;
    expect(placeDevice(s, 6, 'spot').ok).toBe(true);
  });

  it('모두 치우기는 이름·분위기를 그대로 둔다', () => {
    let s = ok(setVenueName(base(), '내 무대')).state;
    s = ok(setVenueTheme(s, 'dark')).state;
    s = ok(placeDevice(s, 3, 'spot')).state;
    const after = ok(clearVenue(s)).state;
    expect(placedCount(after.venue.cells)).toBe(0);
    expect(after.venue.name).toBe('내 무대');
    expect(after.venue.theme).toBe('dark');
  });

  it('분위기는 normal·dark만 받는다', () => {
    expect(failReason(setVenueTheme(base(), 'x' as 'normal'))).toBe('venue_invalid');
  });

  it('이름은 제어 문자를 공백으로 바꾸고 최대 길이에서 자른다', () => {
    expect(cleanVenueName('가\n나')).toBe('가 나');
    expect([...cleanVenueName('가'.repeat(40))]).toHaveLength(V.nameMax);
    expect(cleanVenueName('😀'.repeat(20))).toBe('😀'.repeat(V.nameMax));
    expect(submitName('  새벽   라이브  ')).toBe('새벽 라이브');
  });
});

describe('내 무대: 올리기 조건', () => {
  it('이름이 짧거나 길거나 장치가 없으면 이유를 알려 준다', () => {
    let s = base();
    expect(uploadIssue(s)).toBe('name');
    s = ok(setVenueName(s, '무대')).state;
    expect(uploadIssue(s)).toBe('empty');
    s = ok(placeDevice(s, 0, 'spot')).state;
    expect(uploadIssue(s)).toBeNull();
    expect(uploadIssue(ok(setVenueName(s, '가')).state)).toBe('name');
    expect(uploadIssue(ok(setVenueName(s, '   ')).state)).toBe('name');
    expect(uploadIssue({ ...s, fans: 10 })).toBe('locked');
  });
});

describe('내 무대: 공연 보상', () => {
  const stage = (over: Partial<GameState> = {}): GameState => withCells(base(over), [[0, 0, 'spot'], [1, 0, 'speaker'], [2, 0, 'bar']]);

  it('장치가 없는 무대에서는 공연할 수 없다', () => {
    expect(failReason(playOwnVenue(base(), T0))).toBe('venue_empty');
  });

  it('코인 = 인세 300초 분량 × 무대 배율, 쿨다운은 30분이다', () => {
    const s = stage();
    const grade = scoreVenue(s.venue.cells, s.venue.theme).grade;
    const r = ok(playOwnVenue(s, T0));
    const expected = Math.floor(royaltyRate(s) * V.ownSecs * (1 + V.gradeMultStep * grade));
    expect(r.coins).toBe(expected);
    expect(r.coins).toBe(Math.floor(ownPlayCoins(s)));
    expect(r.grade).toBe(grade);
    expect(r.state.coins).toBeCloseTo(s.coins + expected, 5);
    expect(r.state.venue.ownAt).toBe(T0);
    expect(failReason(playOwnVenue(r.state, T0 + V.ownCooldownMs - 1))).toBe('venue_cooldown');
    expect(ownPlayWaitMs(r.state.venue, T0 + V.ownCooldownMs - 60_000)).toBe(60_000);
    expect(playOwnVenue(r.state, T0 + V.ownCooldownMs).ok).toBe(true);
  });

  it('등급이 높을수록 코인이 늘어난다', () => {
    const low = stage();
    const high = withCells(base(), [
      [0, 0, 'wire'], [0, 1, 'wire'], [0, 2, 'laser'], [0, 3, 'laser'], [0, 4, 'mirrorball'], [0, 5, 'mirrorball'], [0, 6, 'spot'],
      [2, 0, 'subwoofer'], [2, 1, 'subwoofer'], [2, 2, 'micstand'], [2, 3, 'micstand'], [2, 4, 'micstand'], [2, 5, 'micstand'],
    ]);
    expect(ownPlayCoins(high)).toBeGreaterThan(ownPlayCoins(low));
  });

  it('남의 무대 공연 코인 = 인세 180초 분량 × (0.8 + 0.1 × 등급)', () => {
    const s = base();
    const rate = royaltyRate(s);
    expect(visitCoins(s, 0)).toBe(Math.floor(rate * 180 * 0.8));
    expect(visitCoins(s, 5)).toBe(Math.floor(rate * 180 * 1.3));
    const r = ok(applyVenueVisit(s, 3));
    expect(r.coins).toBe(visitCoins(s, 3));
    expect(r.state.coins).toBeCloseTo(s.coins + r.coins, 5);
  });

  it('서버가 이상한 등급을 줘도 0~5로 잘라서 계산한다', () => {
    const s = base();
    expect(ok(applyVenueVisit(s, 99)).grade).toBe(5);
    expect(ok(applyVenueVisit(s, -3)).grade).toBe(0);
    expect(ok(applyVenueVisit(s, Number.NaN)).grade).toBe(0);
  });

  it('지난주 인기 보상은 다이아로 더해지고 상한을 넘지 않는다', () => {
    const s = base({ diamonds: 10 });
    expect(ok(applyVenueClaim(s, 30)).state.diamonds).toBe(40);
    expect(ok(applyVenueClaim(s, 5000)).diamonds).toBe(50);
    expect(ok(applyVenueClaim(s, -4)).diamonds).toBe(0);
  });
});

describe('내 무대: 저장', () => {
  const rt = (s: GameState): Record<string, unknown> => JSON.parse(JSON.stringify(s)) as Record<string, unknown>;

  it('새 게임은 빈 무대로 시작한다', () => {
    expect(createInitialState(T0).venue).toEqual(emptyVenue());
  });

  it('저장하고 읽으면 이름·분위기·칸·공연 시각이 그대로다', () => {
    let s = ok(setVenueName(base(), '새벽 라이브')).state;
    s = ok(setVenueTheme(s, 'dark')).state;
    s = ok(placeDevice(s, 7, 'spot')).state;
    s = ok(placeDevice(s, 8, 'bar')).state;
    s = { ...s, venue: { ...s.venue, ownAt: T0 - 1000 } };
    const v = ok(validateState(rt(s)));
    expect(v.state.venue).toEqual(s.venue);
  });

  it('venue가 없는 예전 저장은 빈 무대로 읽는다', () => {
    const raw = rt(base());
    delete raw.venue;
    expect(ok(validateState(raw)).state.venue).toEqual(emptyVenue());
  });

  it('모르는 장치·최대 개수를 넘은 장치는 빈 칸으로, 48칸 뒤는 버린다', () => {
    const raw = rt(base());
    const cells: unknown[] = Array.from({ length: 60 }, () => null);
    cells[0] = 'rocket';
    for (let i = 1; i <= 8; i++) cells[i] = 'spot'; // 최대 6개
    cells[55] = 'bar';
    raw.venue = { name: '무대', theme: 'normal', cells, ownAt: 0 };
    const v = ok(validateState(raw)).state.venue;
    expect(v.cells).toHaveLength(48);
    expect(v.cells[0]).toBeNull();
    expect(v.cells.filter((c) => c === 'spot')).toHaveLength(6);
    expect(v.cells.filter((c) => c === 'bar')).toHaveLength(0);
  });

  it('내 무대 공연 시각은 정산 시각을 넘지 못한다', () => {
    const raw = rt(base());
    raw.venue = { name: '무대', theme: 'normal', cells: emptyCells(), ownAt: T0 + 9 * 3600_000 };
    expect(ok(validateState(raw)).state.venue.ownAt).toBe(T0);
  });

  it('모양이 완전히 틀린 venue는 거절한다', () => {
    const raw = rt(base());
    expect(validateState({ ...raw, venue: 'x' }).ok).toBe(false);
    expect(validateState({ ...raw, venue: { cells: 'x' } }).ok).toBe(false);
    expect(validateState({ ...raw, venue: { name: 3 } }).ok).toBe(false);
    expect(validateState({ ...raw, venue: { theme: 'neon' } }).ok).toBe(false);
  });
});
