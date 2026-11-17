import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BALANCE, STAGE_IDS } from '../../game/balance';
import { createInitialState } from '../../game/persistence';
import type { ConcertRecord, GameState, StageId, VenueDeviceId } from '../../game/types';
import { emptyCells } from '../../game/venue';
import type { MyVenueBody, MyVenueData, VenueBrief, VenueListData } from '../../platform/venues';

/* 내 무대 화면: 꾸미기·둘러보기·내 무대·공연 연출이 값에 맞게 그려지는지 서버 렌더링으로 확인한다(순수 화면 조각을 직접 그린다). */

const { box } = vi.hoisted(() => ({ box: { ui: null as unknown } }));
vi.mock('../../store/gameStore', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../store/gameStore')>()), useUi: () => box.ui }));

const V = BALANCE.venue;
const T0 = new Date(2026, 10, 18, 12, 0, 0).getTime();
const game = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), fans: 50_000, lastSettledAt: T0, ...over });
const clearedStages = (...ids: StageId[]): GameState['concerts'] => {
  const c = { ...createInitialState(T0).concerts };
  for (const id of ids) c[id] = { ...(c[id] as ConcertRecord), cleared: true };
  return c;
};
const cellsOf = (placed: [number, number, VenueDeviceId][]) => {
  const cells = emptyCells();
  for (const [r, c, id] of placed) cells[r * V.w + c] = id;
  return cells;
};
const withVenue = (over: Partial<GameState['venue']>, rest: Partial<GameState> = {}): GameState => {
  const g = game(rest);
  return { ...g, venue: { ...g.venue, ...over } };
};

async function html(name: string, props: Record<string, unknown>): Promise<string> {
  const mod = (await import('../VenueScreen')) as Record<string, unknown>;
  const C = mod[name] as (p: Record<string, unknown>) => React.ReactElement;
  return renderToString(createElement(C, props)).replace(/<!-- -->/g, '');
}

const noop = () => {};
const buildProps = (g: GameState, over: Record<string, unknown> = {}) => ({ game: g, now: T0, sel: 'spot', busy: false, uploaded: null, onSel: noop, onCell: noop, onName: noop, onTheme: noop, onClear: noop, onUpload: noop, onOwn: noop, ...over });

const body = (over: Partial<MyVenueBody> = {}): MyVenueBody => ({ id: 'v1', name: '새벽 라이브', theme: 'normal', cells: cellsOf([[0, 0, 'spot'], [1, 0, 'speaker']]), score: 2, grade: 0, likes: 4, plays: 9, hidden: false, editedAt: T0, ...over });
const mineData = (over: Partial<MyVenueData> = {}): MyVenueData => ({ venue: body(), weekly: { week: 100, rank: null, diamonds: null, claimed: false }, visitsLeft: 3, ...over });
const brief = (over: Partial<VenueBrief> = {}): VenueBrief => ({
  id: 'b1',
  owner: { uid: 'u2', name: '다른팬', picture: null, avatar: 'normal' },
  name: '지하 라이브하우스',
  theme: 'dark',
  cells: cellsOf([[0, 0, 'spot'], [1, 0, 'speaker'], [2, 0, 'bar'], [0, 1, 'candle']]),
  score: 31.5,
  grade: 2,
  likes: 7,
  plays: 42,
  liked: false,
  mine: false,
  visitedToday: false,
  ...over,
});
const list = (venues: VenueBrief[], over: Partial<VenueListData> = {}): VenueListData => ({ venues, page: 0, hasMore: false, visitsLeft: 3, ...over });
const browseProps = (l: VenueListData | null, over: Record<string, unknown> = {}) => ({ list: l, sort: 'popular', error: null, busy: false, game: game(), onSort: noop, onVisit: noop, onLike: noop, onReport: noop, onOwner: noop, onMore: noop, ...over });

describe('내 무대 화면: 바닥', () => {
  it('48칸이 그려지고 칸마다 행·열·장치 이름이 읽힌다', async () => {
    const out = await html('VenueGrid', { cells: cellsOf([[0, 0, 'spot'], [5, 7, 'bar']]), theme: 'normal', onCell: noop });
    expect(out.match(/class="vn-cell/g)).toHaveLength(48);
    expect(out).toContain('aria-label="1행 1열 스포트라이트"');
    expect(out).toContain('aria-label="6행 8열 안전바"');
    expect(out).toContain('aria-label="3행 4열 빈 칸"');
  });

  it('위험한 칸에는 경고가 붙고 눌리지 않는 미리보기는 버튼이 아니다', async () => {
    const out = await html('VenueGrid', { cells: cellsOf([[2, 2, 'flame']]), hazards: [2 * V.w + 2], theme: 'normal', onCell: noop });
    expect(out).toContain('(위험)');
    expect(out).toContain('vn-bad');
    const mini = await html('VenueGrid', { cells: cellsOf([[2, 2, 'flame']]), theme: 'dark', mini: true });
    expect(mini).not.toContain('<button');
    expect(mini).toContain('vn-mini');
    expect(mini).toContain('data-theme="dark"');
  });
});

describe('내 무대 화면: 꾸미기', () => {
  it('처음 상태: 등급 E·0점, 열린 장치 3종만 눌리고 나머지는 잠겨 있다', async () => {
    const out = await html('BuildPanel', buildProps(game()));
    expect(out).toContain('aria-label="무대 등급 E"');
    expect(out).toContain('0점 · 무대 배율 ×1.00');
    expect(out).toContain('스포트라이트');
    expect(out).toContain('지하 클럽 클리어'); // 마이크 스탠드 해금 조건
    expect(out).toContain('🔒');
    expect(out.match(/vn-device vn-locked/g)).toHaveLength(12);
    expect(out).toContain('0/6'); // 스포트라이트 최대 6개
  });

  it('공연장을 클리어하면 장치가 열린다', async () => {
    const all = await html('BuildPanel', buildProps(game({ concerts: clearedStages(...STAGE_IDS) })));
    expect(all).not.toContain('vn-locked');
    expect(all).not.toContain('🔒');
  });

  it('점수·등급·다음 등급까지 남은 점수가 보인다', async () => {
    const g = withVenue({ cells: cellsOf([[0, 0, 'spot'], [1, 0, 'speaker'], [2, 0, 'bar']]) });
    const out = await html('BuildPanel', buildProps(g));
    expect(out).toContain('3점 · 무대 배율 ×1.00');
    expect(out).toContain('다음 등급 D까지 5점');
  });

  it('조명이나 음향이 없으면 C까지라는 안내, 위험한 연출은 경고가 뜬다', async () => {
    const g = withVenue({ cells: cellsOf([[0, 0, 'flame']]) }, { concerts: clearedStages('medium') });
    const out = await html('BuildPanel', buildProps(g));
    expect(out).toContain('조명이 없어요');
    expect(out).toContain('음향이 없어요');
    expect(out).toContain('위험한 연출 장치 1곳');
    expect(out).toContain('안전 −2');
    const fine = await html('BuildPanel', buildProps(withVenue({ cells: cellsOf([[0, 0, 'spot'], [1, 0, 'speaker']]) })));
    expect(fine).not.toContain('조명이 없어요');
    expect(fine).not.toContain('위험한 연출');
  });

  it('올리기 버튼은 이름·장치 조건을 채워야 눌리고, 올린 무대와 같으면 알려 준다', async () => {
    const empty = await html('BuildPanel', buildProps(game()));
    expect(empty).toMatch(/<button[^>]*disabled[^>]*>⬆️ 서버에 올리기/);
    expect(empty).toContain('무대 이름을 지으면 올릴 수 있어요');
    const named = await html('BuildPanel', buildProps(withVenue({ name: '새벽 라이브' })));
    expect(named).toContain('장치를 하나 이상 놓으면 올릴 수 있어요');
    const g = withVenue({ name: '새벽 라이브', cells: cellsOf([[0, 0, 'spot'], [1, 0, 'speaker']]) });
    const ready = await html('BuildPanel', buildProps(g));
    expect(ready).not.toMatch(/<button[^>]*disabled[^>]*>⬆️ 서버에 올리기/);
    const same = await html('BuildPanel', buildProps(g, { uploaded: body() }));
    expect(same).toContain('✔ 올린 무대와 같아요');
    const changed = await html('BuildPanel', buildProps(g, { uploaded: body({ cells: emptyCells() }) }));
    expect(changed).toContain('바뀐 무대 올리기');
  });

  it('내 무대 공연: 장치가 없으면 막히고, 쿨다운 중이면 남은 분, 아니면 받을 코인이 보인다', async () => {
    const none = await html('BuildPanel', buildProps(game()));
    expect(none).toMatch(/<button[^>]*disabled[^>]*>🎤 내 무대 공연</);
    const g = withVenue({ cells: cellsOf([[0, 0, 'spot'], [1, 0, 'speaker']]), ownAt: T0 - 10 * 60_000 });
    const cooling = await html('BuildPanel', buildProps(g));
    expect(cooling).toContain('20분 뒤');
    const ready = await html('BuildPanel', buildProps(withVenue({ cells: cellsOf([[0, 0, 'spot'], [1, 0, 'speaker']]), ownAt: 0 })));
    expect(ready).toContain('내 무대 공연 🪙 +');
    expect(ready).not.toContain('분 뒤');
  });

  it('어둠 무대에서만 분위기가 반영된다는 안내가 일반 무대에 뜬다', async () => {
    const cells = cellsOf([[0, 0, 'candle']]);
    const normal = await html('BuildPanel', buildProps(withVenue({ cells, theme: 'normal' }, { concerts: clearedStages('rooftop') })));
    expect(normal).toContain('분위기 장치는 어둠 무대에서만');
    const dark = await html('BuildPanel', buildProps(withVenue({ cells, theme: 'dark' }, { concerts: clearedStages('rooftop') })));
    expect(dark).not.toContain('분위기 장치는 어둠 무대에서만 점수에');
  });
});

describe('내 무대 화면: 둘러보기', () => {
  it('불러오기 전에는 불러오는 중, 비어 있으면 안내가 보인다', async () => {
    expect(await html('BrowsePanel', browseProps(null))).toContain('불러오는 중');
    expect(await html('BrowsePanel', browseProps(list([])))).toContain('아직 올라온 무대가 없어요');
    expect(await html('BrowsePanel', browseProps(list([]), { sort: 'friends' }))).toContain('친구가 올린 무대가 아직 없어요');
  });

  it('무대 카드: 이름·주인·등급·점수·공연 수·좋아요·공연 코인이 보인다', async () => {
    const out = await html('BrowsePanel', browseProps(list([brief()])));
    expect(out).toContain('지하 라이브하우스');
    expect(out).toContain('다른팬');
    expect(out).toContain('aria-label="등급 C"');
    expect(out).toContain('31.5점 · 공연 42회');
    expect(out).toContain('aria-label="좋아요 7개"');
    expect(out).toContain('🎤 공연하러 가기');
    expect(out).toContain('aria-label="어둠 무대"');
    expect(out).toContain('오늘 3곳 더 갈 수 있어요');
    expect(out).toContain(`하루 ${V.visitsPerDay}곳까지`);
    expect(out).toContain(`대관료 💎${V.rentFee}`);
  });

  it('내 무대·오늘 이미 공연한 무대·한도가 찬 날은 공연 버튼이 막힌다', async () => {
    const mine = await html('BrowsePanel', browseProps(list([brief({ mine: true })])));
    expect(mine).toContain('내 무대예요');
    expect(mine).not.toContain('aria-label="무대 신고"');
    const visited = await html('BrowsePanel', browseProps(list([brief({ visitedToday: true })])));
    expect(visited).toContain('오늘 공연했어요');
    const full = await html('BrowsePanel', browseProps(list([brief()], { visitsLeft: 0 })));
    expect(full).toContain('오늘은 더 못 가요');
    expect(full).toMatch(/<button[^>]*disabled[^>]*>오늘은 더 못 가요/);
  });

  it('좋아요 상태와 남의 무대 신고 버튼, 더 보기가 나온다', async () => {
    const liked = await html('BrowsePanel', browseProps(list([brief({ liked: true })], { hasMore: true })));
    expect(liked).toContain('❤️ 7');
    expect(liked).toContain('vn-liked');
    expect(liked).toContain('aria-label="무대 신고"');
    expect(liked).toContain('더 보기');
    const plain = await html('BrowsePanel', browseProps(list([brief()])));
    expect(plain).toContain('🤍 7');
    expect(plain).not.toContain('더 보기');
  });

  it('정렬 탭 세 가지와 현재 정렬 표시', async () => {
    const out = await html('BrowsePanel', browseProps(list([]), { sort: 'new' }));
    for (const t of ['🔥 인기', '🆕 새 무대', '👥 친구']) expect(out).toContain(t);
    expect(out).toMatch(/aria-pressed="true">🆕 새 무대/);
  });

  it('오류 메시지를 그대로 보여 준다', async () => {
    expect(await html('BrowsePanel', browseProps(null, { error: '서버에 연결하지 못했어요.' }))).toContain('서버에 연결하지 못했어요.');
  });
});

describe('내 무대 화면: 내 무대 탭', () => {
  const props = (data: MyVenueData | null, over: Record<string, unknown> = {}) => ({ game: game(), data, busy: false, onClaim: noop, onBuild: noop, ...over });

  it('불러오기 전, 올린 무대가 없을 때', async () => {
    expect(await html('MinePanel', props(null))).toContain('불러오는 중');
    const none = await html('MinePanel', props(mineData({ venue: null })));
    expect(none).toContain('아직 올린 무대가 없어요');
    expect(none).toContain('무대 꾸미러 가기');
  });

  it('올린 무대의 이름·등급·공연·좋아요·대관료 안내가 보인다', async () => {
    const out = await html('MinePanel', props(mineData(), {}));
    expect(out).toContain('새벽 라이브');
    expect(out).toContain('🎤 공연 9회');
    expect(out).toContain('❤️ 좋아요 4');
    expect(out).toContain(`대관료 💎${V.rentFee}`);
    expect(out).toContain(`하루 최대 ${V.rentDailyMax}번`);
  });

  it('초안이 올린 무대와 다르면 알려 준다', async () => {
    const g = withVenue({ name: '다른 이름', cells: cellsOf([[0, 0, 'spot']]) });
    expect(await html('MinePanel', props(mineData(), { game: g }))).toContain('올린 무대와 달라요');
    const same = withVenue({ name: '새벽 라이브', cells: body().cells });
    expect(await html('MinePanel', props(mineData(), { game: same }))).not.toContain('올린 무대와 달라요');
  });

  it('숨겨진 무대는 안내가 뜬다', async () => {
    const out = await html('MinePanel', props(mineData({ venue: body({ hidden: true, name: '' }) })));
    expect(out).toContain('운영팀 조치로 숨겨졌어요');
    expect(out).toContain('이름이 지워졌어요');
  });

  it('주간 인기 보상: 받을 수 있으면 버튼, 받았으면 표시, 아니면 안내', async () => {
    const claimable = await html('MinePanel', props(mineData({ weekly: { week: 100, rank: 2, diamonds: 20, claimed: false } })));
    expect(claimable).toContain('지난주 2위 보상 💎 20 받기');
    expect(claimable).toContain(V.weeklyRewards.join('·'));
    const claimed = await html('MinePanel', props(mineData({ weekly: { week: 100, rank: 1, diamonds: null, claimed: true } })));
    expect(claimed).toContain('지난주 보상을 받았어요 (1위)');
    expect(claimed).not.toContain('받기');
    const none = await html('MinePanel', props(mineData()));
    expect(none).toContain('순위권에 들지 못했어요');
  });
});

describe('내 무대 화면: 공연 연출', () => {
  const show = (over: Record<string, unknown> = {}) => ({ title: '지하 라이브하우스', cells: brief().cells, theme: 'dark', grade: 3, lines: ['🪙 +1,234', '주인에게 대관료 💎1이 갔어요.'], phase: 'playing', ...over });

  it('연출 중에는 장치가 반짝이고 결과는 아직 안 보인다', async () => {
    const out = await html('ShowModal', { show: show(), onClose: noop });
    expect(out).toContain('공연 중');
    expect(out).toContain('vn-lit-on');
    expect(out).not.toContain('🪙 +1,234');
  });

  it('끝나면 등급·배율·코인·대관료 안내가 보이고 닫을 수 있다', async () => {
    const out = await html('ShowModal', { show: show({ phase: 'done' }), onClose: noop });
    expect(out).toContain('공연 끝');
    expect(out).toContain('무대 등급 <b>B</b> (×1.15)');
    expect(out).toContain('🪙 +1,234');
    expect(out).toContain('주인에게 대관료');
    expect(out).not.toContain('vn-lit-on');
    expect(out).toContain('확인');
  });
});

describe('내 무대 화면: 전체', () => {
  it('팬이 모자라면 잠겨 있고 열릴 팬 수를 알려 준다', async () => {
    box.ui = { phase: 'ready', game: game({ fans: 100 }), tab: 'venue', toasts: [] };
    const mod = await import('../VenueScreen');
    const out = renderToString(createElement(mod.VenueScreen)).replace(/<!-- -->/g, '');
    expect(out).toContain('내 무대');
    expect(out).toContain(`팬 ${V.unlockFans.toLocaleString('ko-KR')}명부터 내 무대를 꾸밀 수 있어요`);
    expect(out).not.toContain('장치 상자');
  });
});
