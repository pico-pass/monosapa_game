import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { trophyIdOf, type AwardCategory } from '../../game/balance';
import type { AwardItem, AwardResult, AwardRow, AwardsData } from '../../platform/awards';

/* 시상식 화면: 서버가 준 값을 단계마다 그대로 보여 주는지 서버 렌더링으로 확인한다(순수 화면 AwardsView를 직접 그린다). */

vi.mock('../../store/gameStore', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../store/gameStore')>()) }));

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 3);

const row = (rank: number, over: Partial<AwardRow> = {}): AwardRow => ({ rank, title: `곡${rank}`, artist: `가수${rank}`, value: 720 - rank * 10, mine: false, reward: 0, ...over });
const data = (over: Partial<AwardsData> = {}): AwardsData => ({
  period: '2026',
  phase: 'collecting',
  now: NOW,
  voteFrom: NOW + 33 * DAY,
  announceAt: NOW + 41 * DAY,
  claimUntil: NOW + 72 * DAY,
  rookieFrom: NOW + 10 * DAY,
  standings: null,
  ballot: null,
  canVote: false,
  voteBlocked: null,
  results: null,
  items: [],
  canClaim: false,
  trophies: [],
  ...over,
});

async function view(d: AwardsData, extra: Record<string, unknown> = {}): Promise<string> {
  const { AwardsView } = await import('../AwardsScreen');
  const props = { data: d, trophies: [], title: null, seen: {}, busy: false, onVote: () => {}, onClaim: () => {}, onSeen: () => {}, onTitle: () => {}, ...extra };
  return renderToString(createElement(AwardsView, props as never)).replace(/<!-- -->/g, '');
}

const standings = (mine: AwardRow | null = null) =>
  (['song-normal', 'song-dark', 'rookie', 'revival', 'longrun'] as AwardCategory[]).map((category) => ({ category, top: [row(1), row(2, { mine: category === 'rookie' })], mine: category === 'longrun' ? mine : null }));

const results = (over: Partial<Record<AwardCategory, AwardRow[]>> = {}): AwardResult[] =>
  (['song-normal', 'song-dark', 'rookie', 'revival', 'longrun', 'fan-normal', 'fan-dark'] as AwardCategory[]).map((category) => ({
    category,
    rows: over[category] ?? (category === 'song-normal' ? [row(1, { reward: 100 }), row(2, { reward: 50 }), row(3, { reward: 30 })] : [row(1, { reward: 30 })]),
  }));

describe('시상식 화면: 집계 중', () => {
  it('일정 문구와 부문별 중간 순위가 보이고 투표·결과는 없다', async () => {
    const html = await view(data({ standings: standings(row(7, { mine: true })) }));
    expect(html).toContain('집계 중');
    expect(html).toContain('투표까지 33일');
    expect(html).toContain('지금까지의 순위');
    for (const name of ['올해의 노래 · 일반', '올해의 노래 · 어둠', '신인상', '역주행상', '롱런상']) expect(html).toContain(name);
    expect(html).toContain('aria-label="내 순위"'); // 상위 밖의 내 곡
    expect(html).toContain('내 곡');
    expect(html).not.toContain('팬 투표상 · 일반');
    expect(html).not.toContain('시상식 결과');
  });

  it('집계된 곡이 없으면 안내가 보인다', async () => {
    const html = await view(data({ standings: standings().map((s) => ({ ...s, top: [] })) }));
    expect(html).toContain('아직 집계된 곡이 없어요');
  });
});

describe('시상식 화면: 투표 중', () => {
  const ballot = (votedKey: string | null = null) => [
    { category: 'fan-normal' as const, votedKey, candidates: [{ key: 'k1', title: '후보1', artist: '가수1', points: 1000, mine: false }, { key: 'k2', title: '내곡', artist: '나', points: 900, mine: true }] },
    { category: 'fan-dark' as const, votedKey: null, candidates: [] },
  ];

  it('투표할 수 있으면 남의 곡에만 투표 버튼이 있고 내 곡에는 없다', async () => {
    const html = await view(data({ phase: 'voting', canVote: true, ballot: ballot(), standings: standings() }));
    expect(html).toContain('투표 중');
    expect(html).toContain('결과 발표까지 41일');
    expect(html).toContain('팬 투표상 · 일반');
    expect(html).toContain('후보1');
    expect((html.match(/>투표</g) ?? []).length).toBe(1);
    expect(html).toContain('아직 후보가 없어요'); // 어둠 부문
    expect(html).toContain('지금까지의 순위'); // 투표 중에도 다른 부문의 중간 순위
  });

  it('이미 투표했으면 내 표가 표시되고 다른 후보에는 버튼이 없다', async () => {
    const html = await view(data({ phase: 'voting', canVote: true, ballot: ballot('k1') }));
    expect(html).toContain('✔ 내 표');
    expect(html).toContain('✔ 투표했어요');
    expect(html).not.toContain('>투표<');
  });

  it('자격이 없으면 이유가 보이고 투표 버튼이 없다', async () => {
    const html = await view(data({ phase: 'voting', canVote: false, voteBlocked: '팬이 1,000명 이상이어야 투표할 수 있어요.', ballot: ballot() }));
    expect(html).toContain('팬이 1,000명 이상이어야 투표할 수 있어요.');
    expect(html).not.toContain('>투표<');
  });
});

describe('시상식 화면: 결과 발표', () => {
  const items: AwardItem[] = [
    { id: 'win:song-normal', kind: 'win', category: 'song-normal', rank: 1, diamonds: 100, trophy: trophyIdOf(2026, 'song-normal'), claimed: false },
    { id: 'vote:fan-normal', kind: 'vote', category: 'fan-normal', rank: null, diamonds: 2, trophy: null, claimed: false },
  ];

  it('아직 보지 않은 부문은 밑자리부터 가려져 있고 발표 버튼이 보인다', async () => {
    const html = await view(data({ phase: 'announced', results: results() }), { seen: { 'song-normal': 1 } });
    expect(html).toContain('결과 발표');
    expect(html).toContain('2026 시상식 결과');
    expect(html).toContain('❔ 발표 전');
    expect(html).toContain('곡3'); // 3위는 이미 공개
    expect(html).not.toContain('곡2');
    expect(html).toContain('2위 발표 보기');
    expect(html).toContain('1위 발표 보기'); // 다른 부문(한 자리뿐)
    expect(html).toContain('전부 공개');
  });

  it('모두 공개했으면 수상곡·보상이 보이고 내 곡이면 축하가 나온다', async () => {
    const seen = Object.fromEntries(['song-normal', 'song-dark', 'rookie', 'revival', 'longrun', 'fan-normal', 'fan-dark'].map((c) => [c, c === 'song-normal' ? 3 : 1]));
    const html = await view(data({ phase: 'announced', results: results({ rookie: [row(1, { mine: true, reward: 50 })] }) }), { seen });
    expect(html).not.toContain('❔ 발표 전');
    expect(html).not.toContain('전부 공개');
    expect(html).toContain('💎100');
    expect(html).toContain('🎉 축하해요! 내 곡이 신인상에 이름을 올렸어요.');
  });

  it('받을 보상이 있으면 합계 버튼이, 다 받았으면 받음 표시가 보인다', async () => {
    const open = await view(data({ phase: 'announced', results: results(), items, canClaim: true }));
    expect(open).toContain('내 시상식 보상');
    expect(open).toContain('🏆 올해의 노래 · 일반 1위');
    expect(open).toContain('🗳️ 팬 투표상 · 일반 투표 참여');
    expect(open).toContain('모두 받기 💎 102');
    const done = await view(data({ phase: 'announced', results: results(), items: items.map((i) => ({ ...i, claimed: true })), canClaim: false }));
    expect(done).toContain('보상을 모두 받았어요');
    expect(done).not.toContain('모두 받기');
  });

  it('보상 기간이 끝나면 결과는 보이지만 받을 수 없다는 안내가 나온다', async () => {
    const html = await view(data({ phase: 'closed', results: results(), items, canClaim: false }));
    expect(html).toContain('시상식 종료');
    expect(html).toContain('보상을 받을 수 있는 기간이 지났어요');
    expect(html).not.toContain('모두 받기');
    expect(html).toContain('2026 시상식 결과');
  });

  it('투표가 없어 비어 있는 팬 투표상은 안내가 나온다', async () => {
    const html = await view(data({ phase: 'announced', results: results({ 'fan-normal': [], 'fan-dark': [] }) }));
    expect(html).toContain('투표가 없어서 수상곡이 없어요');
  });
});

describe('시상식 화면: 내 트로피', () => {
  it('트로피가 있으면 칭호로 달 수 있고 달린 것은 눌려 있다', async () => {
    const html = await view(data({ phase: 'announced', results: results() }), { trophies: [trophyIdOf(2026, 'rookie'), trophyIdOf(2026, 'song-dark')], title: trophyIdOf(2026, 'rookie') });
    expect(html).toContain('내 트로피');
    expect(html).toContain('「2026 신인상」');
    expect(html).toContain('「2026 올해의 노래·어둠」');
    expect(html).toContain('⚡ 전투력 +5%');
    expect(html).toMatch(/aria-pressed="true"[^>]*>「2026 신인상」/);
  });

  it('트로피가 없으면 이 칸이 없다', async () => {
    expect(await view(data({ standings: standings() }))).not.toContain('내 트로피');
  });
});

describe('시상식 화면: 남은 시간', () => {
  it('하루 이상이면 일, 그보다 짧으면 시간으로 보인다', async () => {
    const { leftText } = await import('../AwardsScreen');
    expect(leftText(2 * DAY)).toBe('2일');
    expect(leftText(2 * DAY - 1)).toBe('2일');
    expect(leftText(DAY - 1)).toBe('24시간');
    expect(leftText(3600_000 * 5 - 1)).toBe('5시간');
    expect(leftText(10)).toBe('1시간');
    expect(leftText(-5)).toBe('1시간');
  });
});
