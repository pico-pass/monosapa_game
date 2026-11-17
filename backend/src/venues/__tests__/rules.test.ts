import { describe, expect, it } from 'vitest';
import {
  DEVICES,
  DEVICE_IDS,
  GRADE_CAP_MISSING,
  GRADE_MIN,
  HAZARD_PENALTY,
  LIGHT_FX_MULT,
  RENT_DAILY_MAX,
  RENT_FEE,
  SPEAKER_SYMMETRY_MULT,
  VENUE_CELLS,
  VENUE_H,
  VENUE_W,
  WEEKLY_REWARDS,
  cellsFromStored,
  cellsToStored,
  gradeMult,
  parseCells,
  rankWeekly,
  scoreVenue,
  type Cells,
  type DeviceId,
} from '../rules.js';

const empty = (): Cells => Array.from({ length: VENUE_CELLS }, () => null);
const at = (r: number, c: number) => r * VENUE_W + c;
const build = (placed: [number, number, DeviceId][]): Cells => {
  const cells = empty();
  for (const [r, c, id] of placed) cells[at(r, c)] = id;
  return cells;
};

describe('무대 장치 표와 그리드', () => {
  it('8열 × 6행 = 48칸이다', () => {
    expect(VENUE_W).toBe(8);
    expect(VENUE_H).toBe(6);
    expect(VENUE_CELLS).toBe(48);
  });

  it('장치는 15종이고 기본값은 1~3, 최대 개수는 한 무대 칸 수 안이다', () => {
    expect(DEVICE_IDS).toHaveLength(15);
    for (const id of DEVICE_IDS) {
      expect(DEVICES[id].base, id).toBeGreaterThanOrEqual(1);
      expect(DEVICES[id].base, id).toBeLessThanOrEqual(3);
      expect(DEVICES[id].max, id).toBeGreaterThanOrEqual(1);
    }
    expect(DEVICE_IDS.reduce((n, id) => n + DEVICES[id].max, 0)).toBeGreaterThan(VENUE_CELLS / 2);
  });

  it('등급 경계는 오름차순이고 E는 0점부터다', () => {
    expect(GRADE_MIN).toHaveLength(6);
    expect(GRADE_MIN[0]).toBe(0);
    for (let i = 1; i < GRADE_MIN.length; i++) expect(GRADE_MIN[i]).toBeGreaterThan(GRADE_MIN[i - 1]);
  });

  it('서버가 정하는 값: 대관료·하루 상한·주간 보상', () => {
    expect(RENT_FEE).toBe(1);
    expect(RENT_DAILY_MAX).toBe(5);
    expect(WEEKLY_REWARDS).toEqual([30, 20, 10]);
  });
});

describe('칸 읽기·쓰기', () => {
  it('올바른 48칸은 그대로 읽는다', () => {
    const cells = build([[0, 0, 'spot'], [5, 7, 'bar']]);
    expect(parseCells(cells)).toEqual(cells);
  });

  it('길이가 48이 아니거나 배열이 아니면 거절한다', () => {
    expect(parseCells(null)).toBeNull();
    expect(parseCells('spot')).toBeNull();
    expect(parseCells(empty().slice(1))).toBeNull();
    expect(parseCells([...empty(), null])).toBeNull();
  });

  it('모르는 장치·빈 문자열·숫자가 있으면 거절한다', () => {
    const a = empty();
    a[3] = 'rocket' as DeviceId;
    expect(parseCells(a)).toBeNull();
    const b = empty();
    (b as unknown[])[3] = '';
    expect(parseCells(b)).toBeNull();
    const c = empty();
    (c as unknown[])[3] = 7;
    expect(parseCells(c)).toBeNull();
    const d = empty();
    d[0] = 'toString' as DeviceId;
    expect(parseCells(d)).toBeNull();
  });

  it('장치별 최대 개수를 넘으면 거절한다', () => {
    const cells = empty();
    for (let i = 0; i <= DEVICES.coffin.max; i++) cells[i] = 'coffin';
    expect(parseCells(cells)).toBeNull();
    const ok = empty();
    for (let i = 0; i < DEVICES.coffin.max; i++) ok[i] = 'coffin';
    expect(parseCells(ok)).not.toBeNull();
  });

  it('저장 문자열(빈 칸 = 빈 문자열)과 서로 바뀐다', () => {
    const cells = build([[2, 3, 'laser'], [4, 4, 'led']]);
    expect(cellsFromStored(cellsToStored(cells))).toEqual(cells);
    expect(cellsToStored(cells)[at(2, 3)]).toBe('laser');
    expect(cellsToStored(cells)[0]).toBe('');
  });

  it('저장값이 이상하면(모르는 장치·짧은 배열) 빈 칸으로 읽는다', () => {
    expect(cellsFromStored(undefined)).toEqual(empty());
    const stored = ['spot', 'rocket', 'speaker'];
    const cells = cellsFromStored(stored);
    expect(cells).toHaveLength(48);
    expect(cells.slice(0, 3)).toEqual(['spot', null, 'speaker']);
  });
});

describe('점수', () => {
  it('빈 무대는 0점 E이고 조명·음향 부족으로 막힌 것은 아니다', () => {
    const s = scoreVenue(empty(), 'normal');
    expect(s.total).toBe(0);
    expect(s.grade).toBe(0);
    expect(s.devices).toBe(0);
    expect(s.capped).toBe(false);
  });

  it('조명·스피커·안전바는 기본값이 능력치에 그대로 더해진다', () => {
    const s = scoreVenue(build([[0, 0, 'spot'], [0, 1, 'mirrorball'], [5, 0, 'speaker'], [3, 3, 'bar']]), 'normal');
    expect(s.glam).toBe(3);
    expect(s.sound).toBe(1);
    expect(s.safety).toBe(1);
    expect(s.total).toBe(5);
    expect(s.lights).toBe(2);
    expect(s.sounds).toBe(1);
  });

  it('조명 상하좌우에 붙은 연출은 ×1.25이다(대각선은 아니다)', () => {
    const adjacent = scoreVenue(build([[2, 2, 'spot'], [2, 3, 'confetti'], [1, 3, 'bar']]), 'normal');
    expect(adjacent.glam).toBe(1 + 3 * LIGHT_FX_MULT);
    const diagonal = scoreVenue(build([[2, 2, 'spot'], [3, 3, 'confetti'], [2, 3, 'bar']]), 'normal');
    expect(diagonal.glam).toBe(1 + 3);
  });

  it('조명 둘이 한 연출 옆에 있어도 배율은 한 번만 붙는다', () => {
    const s = scoreVenue(build([[2, 1, 'spot'], [2, 3, 'spot'], [2, 2, 'flame'], [1, 2, 'bar']]), 'normal');
    expect(s.glam).toBe(1 + 1 + 2 * LIGHT_FX_MULT);
  });

  it('좌우 대칭 자리의 스피커 쌍은 각각 ×1.2, 한쪽만 있으면 ×1이다', () => {
    const pair = scoreVenue(build([[1, 1, 'speaker'], [1, 6, 'speaker']]), 'normal');
    expect(pair.sound).toBe(2 * SPEAKER_SYMMETRY_MULT);
    const lone = scoreVenue(build([[1, 1, 'speaker'], [1, 5, 'speaker']]), 'normal');
    expect(lone.sound).toBe(2);
    // 스피커가 아닌 음향 장치는 대칭이어도 배율이 없다
    const subs = scoreVenue(build([[1, 1, 'subwoofer'], [1, 6, 'subwoofer']]), 'normal');
    expect(subs.sound).toBe(6);
  });

  it('주변 8칸(대각선 포함)에 안전바가 없는 연출은 위험하고 안전 −2씩이다', () => {
    const risky = scoreVenue(build([[2, 2, 'flame'], [4, 4, 'flame']]), 'normal');
    expect(risky.hazards).toBe(2);
    expect(risky.safety).toBe(-2 * HAZARD_PENALTY);
    const diagonalBar = scoreVenue(build([[2, 2, 'flame'], [3, 3, 'bar']]), 'normal');
    expect(diagonalBar.hazards).toBe(0);
    expect(diagonalBar.safety).toBe(1);
    const farBar = scoreVenue(build([[2, 2, 'flame'], [4, 4, 'bar']]), 'normal');
    expect(farBar.hazards).toBe(1);
  });

  it('총점은 0 아래로 내려가지 않는다', () => {
    const s = scoreVenue(build([[0, 0, 'flame'], [2, 2, 'flame'], [4, 4, 'flame']]), 'normal');
    expect(s.total).toBe(Math.max(0, s.glam + s.sound + s.safety + s.mood));
    expect(s.total).toBeGreaterThanOrEqual(0);
  });

  it('분위기 장치는 어둠 무대에서만 점수에 들어간다', () => {
    const cells = build([[0, 0, 'candle'], [0, 1, 'coffin']]);
    expect(scoreVenue(cells, 'normal').mood).toBe(0);
    expect(scoreVenue(cells, 'dark').mood).toBe(4);
  });

  it('같은 칸·테마면 항상 같은 결과다', () => {
    const cells = build([[0, 0, 'spot'], [0, 1, 'flame'], [1, 1, 'bar'], [3, 3, 'speaker'], [3, 4, 'speaker']]);
    expect(scoreVenue(cells, 'dark')).toEqual(scoreVenue(cells, 'dark'));
  });
});

describe('등급', () => {
  /** 조명 7개와 음향 6개로 점수 29를 만든다 */
  function withTotal(): Cells {
    return build([
      [0, 0, 'wire'], [0, 1, 'wire'], [0, 2, 'laser'], [0, 3, 'laser'], [0, 4, 'mirrorball'], [0, 5, 'mirrorball'], [0, 6, 'spot'],
      [2, 0, 'subwoofer'], [2, 1, 'subwoofer'], [2, 2, 'micstand'], [2, 3, 'micstand'], [2, 4, 'micstand'], [2, 5, 'micstand'],
    ]);
  }

  it('점수가 경계 이상이면 그 등급이다', () => {
    const s = scoreVenue(withTotal(), 'normal');
    let expected = 0;
    GRADE_MIN.forEach((min, i) => {
      if (s.total >= min) expected = i;
    });
    expect(s.grade).toBe(expected);
    // 조명 6+4+4+1 = 15, 음향 6+8 = 14
    expect(s.total).toBe(29);
    expect(s.grade).toBe(2);
  });

  it('조명이 없으면 점수가 높아도 C까지다', () => {
    // 음향·연출·안전바만으로 높은 점수를 만든다(조명 없음)
    const cells = build([
      [0, 0, 'subwoofer'], [0, 1, 'subwoofer'], [0, 2, 'micstand'], [0, 3, 'micstand'], [0, 4, 'micstand'], [0, 5, 'micstand'],
      [1, 0, 'confetti'], [1, 1, 'confetti'], [1, 2, 'confetti'], [1, 3, 'led'], [1, 4, 'led'], [1, 5, 'dryice'], [1, 6, 'dryice'], [1, 7, 'dryice'],
      [2, 0, 'bar'], [2, 1, 'bar'], [2, 2, 'bar'], [2, 3, 'bar'], [2, 4, 'bar'], [2, 5, 'bar'], [2, 6, 'flame'], [2, 7, 'flame'], [3, 6, 'flame'], [3, 7, 'flame'],
      [4, 0, 'speaker'], [4, 7, 'speaker'], [4, 1, 'speaker'], [4, 6, 'speaker'], [4, 2, 'speaker'], [4, 5, 'speaker'],
    ]);
    const s = scoreVenue(cells, 'normal');
    expect(s.lights).toBe(0);
    expect(s.total).toBeGreaterThanOrEqual(GRADE_MIN[GRADE_CAP_MISSING + 1]);
    expect(s.grade).toBe(GRADE_CAP_MISSING);
    expect(s.capped).toBe(true);
  });

  it('음향이 없어도 C까지다', () => {
    const cells = build([
      [0, 0, 'wire'], [0, 1, 'wire'], [0, 2, 'laser'], [0, 3, 'laser'], [0, 4, 'laser'], [0, 5, 'laser'], [0, 6, 'mirrorball'], [0, 7, 'mirrorball'],
      [1, 0, 'mirrorball'], [1, 1, 'mirrorball'], [1, 2, 'spot'], [1, 3, 'spot'], [1, 4, 'spot'], [1, 5, 'spot'], [1, 6, 'spot'], [1, 7, 'spot'],
      [3, 0, 'confetti'], [3, 1, 'confetti'], [3, 2, 'confetti'], [3, 3, 'led'], [3, 4, 'led'], [3, 5, 'flame'], [3, 6, 'flame'], [3, 7, 'flame'],
      [2, 0, 'bar'], [2, 1, 'bar'], [2, 2, 'bar'], [2, 3, 'bar'], [2, 4, 'bar'], [2, 5, 'bar'], [4, 0, 'dryice'], [4, 1, 'dryice'], [4, 2, 'dryice'], [4, 3, 'flame'],
    ]);
    const s = scoreVenue(cells, 'normal');
    expect(s.sounds).toBe(0);
    expect(s.total).toBeGreaterThanOrEqual(GRADE_MIN[GRADE_CAP_MISSING + 1]);
    expect(s.grade).toBe(GRADE_CAP_MISSING);
  });

  it('무대 배율은 1 + 0.05 × 등급 번호다', () => {
    expect(gradeMult(0)).toBe(1);
    expect(gradeMult(5)).toBeCloseTo(1.25, 10);
  });
});

describe('지난주 인기 무대 순위', () => {
  const rows = [
    { id: 'a', n: 9 },
    { id: 'b', n: 7 },
    { id: 'c', n: 7 },
    { id: 'd', n: 3 },
    { id: 'e', n: 1 },
  ];
  const all = new Set(['a', 'b', 'c', 'd', 'e']);

  it('위에서 3곳에 30·20·10 보상이 붙는다', () => {
    expect(rankWeekly(rows, all)).toEqual([
      { id: 'a', rank: 1, n: 9, diamonds: 30 },
      { id: 'b', rank: 2, n: 7, diamonds: 20 },
      { id: 'c', rank: 3, n: 7, diamonds: 10 },
    ]);
  });

  it('숨겨진 무대는 건너뛰고 다음 무대가 올라온다', () => {
    expect(rankWeekly(rows, new Set(['a', 'c', 'd'])).map((r) => `${r.rank}:${r.id}`)).toEqual(['1:a', '2:c', '3:d']);
  });

  it('좋아요가 없으면 순위에 오르지 않고 3곳을 넘기지 않는다', () => {
    expect(rankWeekly([{ id: 'a', n: 0 }], all)).toEqual([]);
    expect(rankWeekly([], all)).toEqual([]);
    expect(rankWeekly(rows.concat([{ id: 'f', n: 1 }]), new Set([...all, 'f']))).toHaveLength(3);
  });
});
