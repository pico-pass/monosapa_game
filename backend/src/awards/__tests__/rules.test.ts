import { describe, expect, it } from 'vitest';
import { AWARD_PERSONAS, AWARD_RETENTION_SECONDS, HOUR_MS, SNAPSHOT_TOP, hourOf, pointRows, rankPoints, type SnapshotEntry } from '../rules.js';

const entry = (rank: number, over: Partial<SnapshotEntry> = {}): SnapshotEntry => ({ rank, key: `u:a:s${rank}`, uid: 'a', title: `곡${rank}`, artist: '래퍼', revival: false, ...over });

describe('시상식 집계: 순위 점수', () => {
  it('1위 30점부터 30위 1점까지 한 점씩 줄고 그 밖은 0점이다', () => {
    expect(SNAPSHOT_TOP).toBe(30);
    expect(rankPoints(1)).toBe(30);
    expect(rankPoints(2)).toBe(29);
    expect(rankPoints(30)).toBe(1);
    expect(rankPoints(31)).toBe(0);
    expect(rankPoints(0)).toBe(0);
    expect(rankPoints(-3)).toBe(0);
    expect(rankPoints(1.5)).toBe(0);
    expect(rankPoints(Number.NaN)).toBe(0);
  });

  it('상위 30곡의 점수 합은 465점이다', () => {
    let sum = 0;
    for (let r = 1; r <= SNAPSHOT_TOP; r++) sum += rankPoints(r);
    expect(sum).toBe(465);
  });
});

describe('시상식 집계: 정시와 날짜', () => {
  it('같은 정시 안의 시각은 같은 번호이고 한 시간 뒤는 하나 늘어난다', () => {
    const t = Date.UTC(2026, 10, 16, 5, 0, 0);
    expect(hourOf(t)).toBe(hourOf(t + 59 * 60_000 + 59_000));
    expect(hourOf(t + HOUR_MS)).toBe(hourOf(t) + 1);
  });

  it('날짜는 한국 시간으로 바뀐다(UTC 15시가 한국 0시)', () => {
    const lastHourKst = hourOf(Date.UTC(2026, 11, 31, 14, 0, 0)); // 한국 12월 31일 23시
    const firstHourKst = hourOf(Date.UTC(2026, 11, 31, 15, 0, 0)); // 한국 1월 1일 0시
    expect(pointRows(lastHourKst, 'normal', [entry(1)])[0].filter.day).toBe('2026-12-31');
    expect(pointRows(firstHourKst, 'normal', [entry(1)])[0].filter.day).toBe('2027-01-01');
  });
});

describe('시상식 집계: 정시 한 번을 더하기 행으로', () => {
  const hour = hourOf(Date.UTC(2026, 10, 16, 3, 0, 0));

  it('곡마다 점수·1시간·역주행 여부가 한 줄이 된다', () => {
    const rows = pointRows(hour, 'dark', [entry(1, { revival: true }), entry(2), entry(30)]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      filter: { day: '2026-11-16', persona: 'dark', key: 'u:a:s1' },
      inc: { points: 30, hours: 1, revivals: 1 },
      set: { uid: 'a', title: '곡1', artist: '래퍼' },
    });
    expect(rows[1].inc).toEqual({ points: 29, hours: 1, revivals: 0 });
    expect(rows[2].inc).toEqual({ points: 1, hours: 1, revivals: 0 });
  });

  it('30위 밖이거나 순위가 이상한 줄은 버린다', () => {
    const rows = pointRows(hour, 'normal', [entry(1), entry(31), entry(0), entry(-1), entry(2.5)]);
    expect(rows.map((r) => r.filter.key)).toEqual(['u:a:s1']);
  });

  it('같은 곡이 두 줄이면 먼저 나온 순위만 쓰고 키가 빈 줄은 버린다', () => {
    const rows = pointRows(hour, 'normal', [entry(3, { key: 'u:x:1' }), entry(5, { key: 'u:x:1' }), entry(6, { key: '' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].inc.points).toBe(rankPoints(3));
  });

  it('너무 긴 제목·활동명은 200자로 줄인다', () => {
    const rows = pointRows(hour, 'normal', [entry(1, { title: 'ㅋ'.repeat(500), artist: 'ㅎ'.repeat(500) })]);
    expect(rows[0].set.title).toHaveLength(200);
    expect(rows[0].set.artist).toHaveLength(200);
  });

  it('차트가 비어 있으면 행이 없다', () => {
    expect(pointRows(hour, 'normal', [])).toEqual([]);
  });

  it('두 속성을 따로 센다', () => {
    expect(AWARD_PERSONAS).toEqual(['normal', 'dark']);
    const a = pointRows(hour, 'normal', [entry(1)])[0];
    const b = pointRows(hour, 'dark', [entry(1)])[0];
    expect(a.filter.persona).toBe('normal');
    expect(b.filter.persona).toBe('dark');
  });

  it('같은 입력은 늘 같은 행을 만든다', () => {
    const list = [entry(1), entry(2, { revival: true })];
    expect(pointRows(hour, 'normal', list)).toEqual(pointRows(hour, 'normal', list));
  });
});

describe('시상식 집계: 보관', () => {
  it('연 단위 시상식까지 쓰게 400일 보관한다', () => {
    expect(AWARD_RETENTION_SECONDS).toBe(400 * 24 * 3600);
  });
});
