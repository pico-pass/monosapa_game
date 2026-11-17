import { describe, expect, it } from 'vitest';
import {
  AWARD_PERSONAS,
  AWARD_RETENTION_SECONDS,
  HOUR_MS,
  SNAPSHOT_TOP,
  hourOf,
  pointRows,
  rankPoints,
  type SnapshotEntry,
  AWARD_CATEGORIES,
  AWARD_YEAR,
  CANDIDATES_PER_CATEGORY,
  SCORE_CATEGORIES,
  VOTE_CATEGORIES,
  VOTE_MIN_ACCOUNT_DAYS,
  VOTE_MIN_FANS,
  VOTE_REWARD,
  WINNER_REWARDS,
  candidatesOf,
  claimItemsOf,
  firstSingleAt,
  isAwardCategory,
  isRookie,
  isVoteCategory,
  phaseOf,
  rankScores,
  resultsOf,
  rewardFor,
  scheduleOf,
  tallyKey,
  trophyId,
  voteGate,
  type CandidateRow,
  type SongTotal,
} from '../rules.js';

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

/* ---------- 시상식: 일정·순위·투표·보상 ---------- */

const song = (uid: string, n: number, over: Partial<SongTotal> = {}): SongTotal => ({
  persona: 'normal',
  key: `u:${uid}:s${n}`,
  uid,
  title: `${uid}의 곡${n}`,
  artist: uid,
  points: 100,
  hours: 10,
  revivals: 0,
  ...over,
});
const none = new Set<string>();

describe('시상식: 일정과 단계', () => {
  const s = scheduleOf(2026);
  it('투표는 12월 24일 0시, 발표는 1월 1일 0시, 보상은 2월 1일 0시까지(모두 한국 시간)다', () => {
    expect(new Date(s.voteFrom).toISOString()).toBe('2026-12-23T15:00:00.000Z');
    expect(new Date(s.announceAt).toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(new Date(s.claimUntil).toISOString()).toBe('2027-01-31T15:00:00.000Z');
    expect(new Date(s.rookieFrom).toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(s.fromDay).toBe('2026-01-01');
    expect(s.toDay).toBe('2026-12-31');
    expect(s.candidatesDay).toBe('2026-12-23');
  });

  it('단계는 경계 시각에서 정확히 바뀐다', () => {
    expect(AWARD_YEAR).toBe(2026);
    expect(phaseOf(s.voteFrom - 1)).toBe('collecting');
    expect(phaseOf(s.voteFrom)).toBe('voting');
    expect(phaseOf(s.announceAt - 1)).toBe('voting');
    expect(phaseOf(s.announceAt)).toBe('announced');
    expect(phaseOf(s.claimUntil - 1)).toBe('announced');
    expect(phaseOf(s.claimUntil)).toBe('closed');
    expect(phaseOf(Date.UTC(2026, 10, 17))).toBe('collecting');
  });
});

describe('시상식: 부문과 보상표', () => {
  it('부문은 점수 5개와 투표 2개다', () => {
    expect(SCORE_CATEGORIES).toEqual(['song-normal', 'song-dark', 'rookie', 'revival', 'longrun']);
    expect(VOTE_CATEGORIES).toEqual(['fan-normal', 'fan-dark']);
    expect(AWARD_CATEGORIES.length).toBe(7);
    expect(isAwardCategory('rookie')).toBe(true);
    expect(isAwardCategory('nope')).toBe(false);
    expect(isVoteCategory('fan-dark')).toBe(true);
    expect(isVoteCategory('song-dark')).toBe(false);
  });

  it('보상은 설계표와 같고 시상대 밖은 0이다', () => {
    expect(WINNER_REWARDS['song-normal']).toEqual([100, 50, 30]);
    expect(WINNER_REWARDS['fan-dark']).toEqual([50, 30, 20]);
    expect(rewardFor('rookie', 1)).toBe(50);
    expect(rewardFor('rookie', 2)).toBe(0);
    expect(rewardFor('revival', 1)).toBe(30);
    expect(rewardFor('song-dark', 3)).toBe(30);
    expect(rewardFor('song-dark', 4)).toBe(0);
    expect(rewardFor('song-dark', 0)).toBe(0);
    expect(VOTE_REWARD).toBe(2);
  });

  it('트로피 ID는 해와 부문으로 정한다', () => {
    expect(trophyId(2026, 'song-normal')).toBe('trophy-2026-song-normal');
    expect(trophyId(2026, 'fan-dark')).toBe('trophy-2026-fan-dark');
  });
});

describe('시상식: 신인 가리기', () => {
  it('첫 싱글 시각은 저장의 싱글 중 가장 이른 발매 시각이다', () => {
    expect(firstSingleAt({ singles: [{ releasedAt: 300 }, { releasedAt: 100 }, { releasedAt: 200 }] })).toBe(100);
    expect(firstSingleAt({ singles: [{ releasedAt: 'x' }, { releasedAt: -5 }, { releasedAt: Number.NaN }, null, 3] })).toBeNull();
    expect(firstSingleAt({ singles: [] })).toBeNull();
    expect(firstSingleAt({})).toBeNull();
    expect(firstSingleAt(null)).toBeNull();
  });

  it('첫 싱글이 기준 시각과 같거나 늦으면 신인이다', () => {
    const from = scheduleOf().rookieFrom;
    expect(isRookie(from, from)).toBe(true);
    expect(isRookie(from + 1, from)).toBe(true);
    expect(isRookie(from - 1, from)).toBe(false);
    expect(isRookie(null, from)).toBe(false);
  });
});

describe('시상식: 부문별 순위', () => {
  it('올해의 노래는 속성마다 점수 순이고 같으면 시간·곡 키 순이다', () => {
    const totals = [
      song('a', 1, { points: 300 }),
      song('b', 1, { points: 300, hours: 20 }),
      song('c', 1, { points: 300, hours: 20 }),
      song('d', 1, { persona: 'dark', points: 999 }),
    ];
    const r = rankScores(totals, none);
    expect(r['song-normal'].map((x) => x.song.uid)).toEqual(['b', 'c', 'a']);
    expect(r['song-normal'].map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(r['song-dark'].map((x) => x.song.uid)).toEqual(['d']);
  });

  it('한 계정은 한 부문에 곡 하나만 올라가고 가장 앞선 곡이 대표가 된다', () => {
    const totals = [song('a', 1, { points: 100 }), song('a', 2, { points: 500 }), song('a', 3, { points: 400 }), song('b', 1, { points: 200 })];
    const r = rankScores(totals, none)['song-normal'];
    expect(r.map((x) => [x.song.uid, x.song.key])).toEqual([
      ['a', 'u:a:s2'],
      ['b', 'u:b:s1'],
    ]);
  });

  it('롱런상은 시간 수, 역주행상은 역주행 시간 수로 정하고 역주행이 없는 곡은 빼며 올해의 노래 1위 곡은 두 부문에서 제외한다', () => {
    const totals = [
      song('top', 1, { points: 900, hours: 500, revivals: 48 }), // 일반 1위: 롱런·역주행에서 빠진다
      song('x', 1, { points: 200, hours: 300, revivals: 0 }),
      song('y', 1, { points: 150, hours: 200, revivals: 24 }),
      song('z', 1, { points: 120, hours: 100, revivals: 72 }),
      song('darktop', 1, { persona: 'dark', points: 800, hours: 450, revivals: 96 }),
    ];
    const r = rankScores(totals, none);
    expect(r.longrun.map((x) => x.song.uid)).toEqual(['x', 'y', 'z']);
    expect(r.longrun[0].value).toBe(300);
    expect(r.revival.map((x) => x.song.uid)).toEqual(['z', 'y']);
    expect(r.revival[0].value).toBe(72);
    expect(r['song-normal'][0].song.uid).toBe('top');
  });

  it('신인상은 신인 계정의 곡만 두 속성을 합쳐 점수로 겨룬다', () => {
    const totals = [song('old', 1, { points: 900 }), song('new1', 1, { points: 50 }), song('new2', 1, { persona: 'dark', points: 80 })];
    const r = rankScores(totals, new Set(['new1', 'new2']));
    expect(r.rookie.map((x) => x.song.uid)).toEqual(['new2', 'new1']);
    expect(rankScores(totals, none).rookie).toEqual([]);
  });

  it('입력 순서가 달라도 같은 순위다', () => {
    const totals = [song('a', 1, { points: 10 }), song('b', 1, { points: 10 }), song('c', 1, { points: 10 }), song('d', 1, { points: 11 })];
    const a = rankScores(totals, none);
    const b = rankScores([...totals].reverse(), none);
    expect(b).toEqual(a);
  });
});

describe('시상식: 팬 투표상 후보', () => {
  it('속성마다 누적 점수 상위 10곡(계정당 하나)이 후보가 된다', () => {
    const totals: SongTotal[] = [];
    for (let i = 0; i < 15; i++) totals.push(song(`n${i}`, 1, { points: 1000 - i }));
    for (let i = 0; i < 4; i++) totals.push(song(`d${i}`, 1, { persona: 'dark', points: 500 - i }));
    totals.push(song('n0', 2, { points: 5 })); // 같은 계정의 두 번째 곡은 후보가 아니다
    const c = candidatesOf(totals);
    const normal = c.filter((x) => x.category === 'fan-normal');
    const dark = c.filter((x) => x.category === 'fan-dark');
    expect(CANDIDATES_PER_CATEGORY).toBe(10);
    expect(normal.length).toBe(10);
    expect(normal[0].uid).toBe('n0');
    expect(normal[9].uid).toBe('n9');
    expect(new Set(normal.map((x) => x.uid)).size).toBe(10);
    expect(dark.map((x) => x.uid)).toEqual(['d0', 'd1', 'd2', 'd3']);
  });

  it('집계 자료가 비어 있으면 후보도 없다', () => {
    expect(candidatesOf([])).toEqual([]);
  });
});

describe('시상식: 발표 결과', () => {
  const totals = [
    song('a', 1, { points: 900, hours: 400 }),
    song('b', 1, { points: 700, hours: 300 }),
    song('c', 1, { points: 500, hours: 600, revivals: 24 }),
    song('d', 1, { points: 300, hours: 100, revivals: 48 }),
    song('e', 1, { persona: 'dark', points: 400 }),
  ];
  const candidates = candidatesOf(totals);
  const rows = (cat: string, results: ReturnType<typeof resultsOf>) => results.filter((r) => r.category === cat);

  it('올해의 노래는 시상대 3자리까지, 신인상·역주행상·롱런상은 1위만 나온다', () => {
    const res = resultsOf(totals, new Set(['d']), candidates, new Map());
    expect(rows('song-normal', res).map((r) => [r.rank, r.uid, r.value])).toEqual([
      [1, 'a', 900],
      [2, 'b', 700],
      [3, 'c', 500],
    ]);
    expect(rows('song-dark', res).map((r) => r.uid)).toEqual(['e']);
    expect(rows('rookie', res).map((r) => r.uid)).toEqual(['d']);
    expect(rows('longrun', res).map((r) => [r.uid, r.value])).toEqual([['c', 600]]); // a(1위 곡)는 제외
    expect(rows('revival', res).map((r) => [r.uid, r.value])).toEqual([['d', 48]]);
  });

  it('팬 투표상은 득표 순이고 득표가 없으면 시상대가 비며 동점은 점수·곡 키 순이다', () => {
    expect(rows('fan-normal', resultsOf(totals, none, candidates, new Map()))).toEqual([]);
    const tallies = new Map<string, number>([
      [tallyKey('fan-normal', 'u:c:s1'), 5],
      [tallyKey('fan-normal', 'u:a:s1'), 5],
      [tallyKey('fan-normal', 'u:b:s1'), 9],
      [tallyKey('fan-normal', 'u:d:s1'), 1],
      [tallyKey('fan-dark', 'u:e:s1'), 2],
    ]);
    const res = resultsOf(totals, none, candidates, tallies);
    expect(rows('fan-normal', res).map((r) => [r.rank, r.uid, r.value])).toEqual([
      [1, 'b', 9],
      [2, 'a', 5], // 5표 동점: 점수가 더 높은 a
      [3, 'c', 5],
    ]);
    expect(rows('fan-dark', res).map((r) => [r.uid, r.value])).toEqual([['e', 2]]);
  });

  it('후보가 아닌 곡에 쌓인 표는 세지 않는다', () => {
    const res = resultsOf(totals, none, candidates, new Map([[tallyKey('fan-normal', 'u:ghost:s1'), 99]]));
    expect(rows('fan-normal', res)).toEqual([]);
  });

  it('같은 입력은 같은 결과다', () => {
    const t = new Map([[tallyKey('fan-normal', 'u:a:s1'), 3]]);
    expect(resultsOf(totals, none, candidates, t)).toEqual(resultsOf([...totals].reverse(), none, [...candidates].reverse() as CandidateRow[], t));
  });
});

describe('시상식: 받을 보상', () => {
  const res = resultsOf(
    [song('a', 1, { points: 900 }), song('b', 1, { points: 700 }), song('c', 1, { points: 500 })],
    new Set(['b']),
    [],
    new Map(),
  );

  it('수상 보상은 시상대에 오른 부문마다 하나씩이고 트로피는 1위에게만 붙는다', () => {
    const a = claimItemsOf(2026, 'a', res, []);
    expect(a.find((i) => i.category === 'song-normal')).toEqual({ id: 'win:song-normal', kind: 'win', category: 'song-normal', rank: 1, diamonds: 100, trophy: 'trophy-2026-song-normal' });
    const b = claimItemsOf(2026, 'b', res, []);
    expect(b.find((i) => i.category === 'song-normal')).toMatchObject({ rank: 2, diamonds: 50, trophy: null });
    expect(b.find((i) => i.category === 'rookie')).toMatchObject({ rank: 1, diamonds: 50, trophy: 'trophy-2026-rookie' });
    expect(claimItemsOf(2026, 'nobody', res, [])).toEqual([]);
  });

  it('투표 참여 보상은 투표한 부문마다 다이아 2개이고 모르는 부문은 무시한다', () => {
    const v = claimItemsOf(2026, 'nobody', res, ['fan-normal', 'fan-dark', 'song-normal', 'x']);
    expect(v.map((i) => [i.id, i.diamonds, i.trophy])).toEqual([
      ['vote:fan-normal', 2, null],
      ['vote:fan-dark', 2, null],
    ]);
  });

  it('보상 키는 사람·부문마다 겹치지 않는다', () => {
    const items = claimItemsOf(2026, 'a', res, ['fan-normal']);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe('시상식: 투표 자격', () => {
  const now = Date.UTC(2026, 11, 25);
  const day = 24 * 3600_000;
  it('가입 7일 이상·팬 1,000명 이상만 통과한다', () => {
    expect(VOTE_MIN_ACCOUNT_DAYS).toBe(7);
    expect(VOTE_MIN_FANS).toBe(1000);
    expect(voteGate(now - 7 * day, 1000, now)).toBeNull();
    expect(voteGate(now - 7 * day + 1, 5000, now)).toBe('young');
    expect(voteGate(now - 30 * day, 999, now)).toBe('fans');
    expect(voteGate(null, 5000, now)).toBe('young');
    expect(voteGate(now - 30 * day, Number.NaN, now)).toBe('fans');
  });
});
