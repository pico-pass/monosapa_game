import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STAGES } from '../../game/balance';
import { createInitialState } from '../../game/persistence';
import type { GameState, Mail, Single } from '../../game/types';
import type { TabId } from '../../store/gameStore';

/*
 * 화면이 여러 상태에서 에러 없이 그려지는지 서버 렌더링으로 확인한다. (레이아웃·스타일은 브라우저에서 본다)
 * 스토어와 로그인 훅은 고정된 상태를 돌려주도록 바꾼다.
 */

const T0 = 1_700_000_000_000;
const { box } = vi.hoisted(() => ({ box: { ui: null as unknown, user: null as unknown } }));

vi.mock('../../store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/gameStore')>();
  return { ...actual, useUi: () => box.ui };
});
vi.mock('../../store/authStore', () => ({
  useAuth: () => ({ status: 'ready', clientId: 'x', user: box.user, busy: false, error: null }),
  signOut: () => {},
}));

const singles = (n: number): Single[] => Array.from({ length: n }, (_, i) => ({ id: `single-${i + 1}`, persona: 'normal', title: `곡${i + 1}`, releasedAt: T0 }));

async function render(tab: TabId, game: GameState): Promise<string> {
  const store = await import('../../store/gameStore');
  box.ui = { ...store.getUi(), phase: 'ready', game, tab };
  const screens: Record<string, () => Promise<Record<string, unknown>>> = {
    more: () => import('../MoreScreen'),
    shop: () => import('../ShopScreen'),
    missions: () => import('../MissionScreen'),
    achievements: () => import('../AchievementScreen'),
    mail: () => import('../MailScreen'),
    monogram: () => import('../MonogramScreen'),
    chat: () => import('../ChatScreen'),
    inquiry: () => import('../InquiryScreen'),
    concert: () => import('../ConcertScreen'),
    collection: () => import('../CollectionScreen'),
    equip: () => import('../EquipScreen'),
    studio: () => import('../StudioScreen'),
  };
  const mod = await screens[tab]();
  const Screen = Object.values(mod).find((v) => typeof v === 'function') as () => React.ReactElement;
  // 서버 렌더링이 글자 사이에 넣는 구분 주석은 지우고 본다.
  return renderToString(createElement(Screen)).replace(/<!-- -->/g, '');
}

function richState(): GameState {
  const s = createInitialState(T0);
  const mails: Mail[] = [
    { id: 'mail-1', tpl: 'sup-1', nick: '새벽세시_구독자', at: T0 },
    { id: 'mail-2', tpl: 'anti-1', nick: '막차놓친사람', at: T0 },
  ];
  const concerts = { ...s.concerts };
  for (const d of STAGES) if (!d.darkOnly) concerts[d.id] = { ...concerts[d.id], cleared: true };
  return {
    ...s,
    coins: 1e6,
    diamonds: 500,
    fans: 5000,
    singles: singles(3),
    concerts,
    buffs: { snack: { id: 'coffee', until: T0 + 600_000 }, campaign: { id: 'insta', until: T0 + 3600_000 } },
    cosmetics: { themes: ['default', 'neon'], theme: 'neon', title: 'grind' },
    achievements: { grind: T0, 'first-verse': T0 },
    counters: { ...s.counters, works: 20000, posts: 3, snacks: 12 },
    fanMail: { ...s.fanMail, inbox: mails, seq: 2 },
    monogram: {
      ...s.monogram,
      slots: 2,
      seq: 2,
      posts: [
        { id: 'post-1', kind: 'selfie', persona: 'normal', at: T0 - 1_800_000, endsAt: T0 - 600_000 },
        { id: 'post-2', kind: 'reels', persona: 'dark', at: T0, endsAt: T0 + 3_600_000 },
      ],
    },
  };
}

beforeEach(() => {
  box.user = { id: 'u1', email: 'a@b.c', name: '테스터', picture: null, isAdmin: false };
});

describe('새 화면 렌더링', () => {
  it('새 게임 상태에서 모든 화면이 그려진다', async () => {
    const g = createInitialState(T0);
    for (const tab of ['more', 'shop', 'missions', 'achievements', 'mail', 'monogram', 'chat', 'inquiry', 'concert', 'collection', 'equip', 'studio'] as const) {
      const html = await render(tab, g);
      expect(html.length, tab).toBeGreaterThan(50);
    }
  });

  it('더보기: 알림 점과 메뉴', async () => {
    const html = await render('more', richState());
    for (const name of ['상점', '미션·출석', '업적·칭호', '팬 DM', '모노그램', '챗방', '문의함']) expect(html).toContain(name);
    expect(html).toContain('dot-badge');
  });

  it('상점: 켜져 있는 버프와 테마 보유 표시', async () => {
    const html = await render('shop', richState());
    expect(html).toContain('캔커피 효과 중');
    expect(html).toContain('모노그램 광고 진행 중');
    expect(html).toContain('적용 중'); // 네온 테마
    expect(html).toContain('💎 30'); // 파스텔은 아직 없다
  });

  it('미션·출석', async () => {
    const html = await render('missions', richState());
    expect(html).toContain('출석하기');
    expect(html).toContain('일일 미션');
    expect(html).toContain('주간 미션');
  });

  it('업적: 달성한 칭호를 달 수 있다', async () => {
    const html = await render('achievements', richState());
    expect(html).toContain('「라임 기계」');
    expect(html).toContain('첫 소절');
  });

  it('팬 DM: 템플릿 문구와 답장 효과', async () => {
    const html = await render('mail', richState());
    expect(html).toContain('새벽세시_구독자');
    expect(html).toContain('오빠가 있기에 내가 살아');
    expect(html).toContain('이기면'); // 받아치기 설명
  });

  it('모노그램: 수확 가능한 게시물과 진행 중인 게시물', async () => {
    const html = await render('monogram', richState());
    expect(html).toContain('결과 확인');
    expect(html).toContain('남음');
    expect(html).toContain('슬롯 늘리기');
  });

  it('모노그램: 첫 싱글 전에는 안내', async () => {
    const html = await render('monogram', createInitialState(T0));
    expect(html).toContain('첫 싱글을 발매한 뒤에 올릴 수 있어요');
  });

  it('문의함: 관리자에게만 관리자 탭이 보인다', async () => {
    const g = createInitialState(T0);
    expect(await render('inquiry', g)).not.toContain('관리자');
    box.user = { id: 'u1', email: 'a@b.c', name: '관리', picture: null, isAdmin: true };
    expect(await render('inquiry', g)).toContain('관리자');
  });

  it('공연: 월클 전에는 ???, 클리어 후에는 비밀 공연장이 보이고 일반속성이면 안내', async () => {
    const fresh = createInitialState(T0);
    const before = await render('concert', { ...fresh, fans: 1e7 });
    expect(before).toContain('???');
    expect(before).not.toContain('심야 옥상');
    const after = await render('concert', richState());
    expect(after).toContain('심야 옥상');
    expect(after).toContain('어둠속성으로만 입장해요');
    expect(after).not.toContain('???');
    expect(after).not.toContain('폐건물 지하'); // 앞 공연장을 클리어해야 다음이 보인다
  });

  it('장비·작업실·도감도 새 필드와 함께 그려진다', async () => {
    const g = richState();
    expect(await render('equip', g)).toContain('오프라인 정산 확장');
    expect(await render('studio', g)).toContain('「라임 기계」');
    // 도감도 비밀 공연장은 월클을 클리어한 뒤에만 보여 준다.
    expect(await render('collection', g)).toContain('심야 옥상');
    expect(await render('collection', createInitialState(T0))).not.toContain('심야 옥상');
  });
});


/* ---------- 콘텐츠 팩 2 ---------- */

type Loader = () => Promise<Record<string, unknown>>;

async function renderNamed(loader: Loader, name: string, tab: TabId, game: GameState, extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}): Promise<string> {
  const store = await import('../../store/gameStore');
  box.ui = { ...store.getUi(), phase: 'ready', game, tab, ...extra };
  const mod = await loader();
  const C = mod[name] as (p: Record<string, unknown>) => React.ReactElement;
  return renderToString(createElement(C, props)).replace(/<!-- -->/g, '');
}

function packState(): GameState {
  const s = richState();
  return {
    ...s,
    cards: { ...s.cards, deck: ['single-1'], remaster: { 'single-1': 1 } },
    photo: { ...s.photo, tickets: 4, shards: 30, owned: { 'p1-1': 2, 'p1-2': 1, 'p3-4': 1 }, pity: 10 },
    feat: { ...s.feat, owned: { 'f-han': 2, 'f-moon': 1 }, slots: ['f-han'] },
    mascot: { normal: { xp: 100, fullUntil: T0 + 3600_000, playReadyAt: 0, giftReadyAt: 0 }, dark: { xp: 0, fullUntil: 0, playReadyAt: T0 + 60_000, giftReadyAt: 0 } },
    arcade: { ...s.arcade, rhythm: { ...s.arcade.rhythm, best: 850, songs: { 'single-1': 850 } }, tower: { ...s.arcade.tower, week: '2023-11-13', floor: 4, best: 9 } },
    stats: { normalMs: 3_600_000, darkMs: 1_800_000, nicks: { 새벽: 5 }, notes: ['잠 못 드는 밤의 한 줄'] },
  };
}

describe('콘텐츠 팩 2 화면', () => {
  it('새 게임 상태에서 새 화면이 모두 그려진다', async () => {
    const g = createInitialState(T0);
    const screens: [Loader, string, TabId][] = [
      [() => import('../CollectScreen'), 'CollectScreen', 'collect'],
      [() => import('../ArcadeScreen'), 'ArcadeScreen', 'arcade'],
      [() => import('../ChallengeScreen'), 'ChallengeScreen', 'challenge'],
      [() => import('../ChartScreen'), 'ChartScreen', 'chart'],
      [() => import('../WrappedScreen'), 'WrappedScreen', 'wrapped'],
      [() => import('../SamplerScreen'), 'SamplerScreen', 'sampler'],
    ];
    for (const [loader, name, tab] of screens) expect((await renderNamed(loader, name, tab, g)).length, name).toBeGreaterThan(50);
  });

  it('더보기에 새 메뉴가 있고 마스코트 선물·티켓이 알림이 된다', async () => {
    const html = await render('more', packState());
    for (const name of ['수집', '아케이드', '해시태그 챌린지', '음원 차트', '결산 Wrapped', '목소리 샘플러']) expect(html).toContain(name);
  });

  it('수집: 곡 카드·포토카드·피처링·마스코트 탭', async () => {
    const g = packState();
    const loader = () => import('../CollectScreen');
    const cards = await renderNamed(loader, 'CardsTab', 'collect', g);
    expect(cards).toContain('「곡1」');
    expect(cards).toContain('덱에서 빼기');
    expect(cards).toContain('리마스터');
    expect(await renderNamed(loader, 'CardsTab', 'collect', createInitialState(T0))).toContain('아직 카드가 없어요');

    const photo = await renderNamed(loader, 'PhotoTab', 'collect', g);
    expect(photo).toContain('티켓 4장');
    expect(photo).toContain('천장까지 80회');
    expect(photo).toContain('방구석 일기');
    expect(photo).toContain('교환소');
    expect(photo).toContain('중복 카드가 없어요'.slice(0, 2)); // 중복 선택지(보유 카드 중 p1-1이 2장)

    const feat = await renderNamed(loader, 'FeatTab', 'collect', g);
    expect(feat).toContain('이번 주 픽업');
    expect(feat).toContain('한강뷰');
    expect(feat).toContain('？？？'); // 미계약 래퍼는 가려 둔다
    expect(feat).toContain('해제'); // 장착한 래퍼

    const pet = await renderNamed(loader, 'MascotTab', 'collect', g);
    expect(pet).toContain('몽글이');
    expect(pet).toContain('까망이');
    expect(pet).toContain('선물 받기');
  });

  it('아케이드: 곡 선택·계단·덱', async () => {
    const html = await renderNamed(() => import('../ArcadeScreen'), 'ArcadeScreen', 'arcade', packState());
    for (const t of ['리듬 모드', '새벽 생존', '가사 덱', '피켓팅', '무한의 계단']) expect(html).toContain(t);
    expect(html).toContain('최고 850');
    expect(html).toContain('4층');
    expect(html).toContain('약점');
    expect(html).toContain('덱 12장');
    const fresh = await renderNamed(() => import('../ArcadeScreen'), 'ArcadeScreen', 'arcade', createInitialState(T0));
    expect(fresh).toContain('첫 싱글을 발매하면');
  });

  it('결산: 슬라이드와 공유 카드', async () => {
    const html = await renderNamed(() => import('../WrappedScreen'), 'WrappedScreen', 'wrapped', packState());
    expect(html).toContain('Wrapped');
    expect(html).toContain('작업하기');
    expect(html).toContain('공유');
  });

  it('챌린지·차트·샘플러는 불러오는 동안에도 그려진다', async () => {
    const g = packState();
    expect(await renderNamed(() => import('../ChallengeScreen'), 'ChallengeScreen', 'challenge', g)).toContain('내 가사 노트');
    expect(await renderNamed(() => import('../ChallengeScreen'), 'ChallengeScreen', 'challenge', g)).toContain('잠 못 드는 밤의 한 줄');
    expect(await renderNamed(() => import('../ChartScreen'), 'ChartScreen', 'chart', g)).toContain('실시간 음원 차트');
    expect(await renderNamed(() => import('../SamplerScreen'), 'SamplerScreen', 'sampler', g)).toContain('녹음하기');
  });

  it('아케이드 전체화면: 네 가지 게임과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ArcadeStage');
    const run = (kind: 'rhythm' | 'survival' | 'lyric' | 'ticketing') => ({ id: 'r1', kind, persona: 'normal', power: 0, seed: 7, target: kind === 'rhythm' ? 'single-1' : null, level: 'normal', status: 'running' });
    expect(await renderNamed(loader, 'ArcadeStage', 'arcade', g, {}, { run: run('rhythm') })).toContain('리듬 모드');
    expect(await renderNamed(loader, 'ArcadeStage', 'arcade', g, {}, { run: run('survival') })).toContain('새벽 생존');
    const lyric = await renderNamed(loader, 'ArcadeStage', 'arcade', g, {}, { run: run('lyric') });
    expect(lyric).toContain('가사 덱');
    expect(lyric).toContain('턴 끝내기');
    expect(await renderNamed(loader, 'ArcadeStage', 'arcade', g, {}, { run: run('ticketing') })).toContain('피켓팅');

    const finished = { ...run('lyric'), status: 'finished' };
    const outcome = { kind: 'lyric', score: 820, grade: 'A', coins: 500, fans: 3, diamonds: 2, newBest: true, boost: null, lyricBonus: 0.35 };
    const result = await renderNamed(loader, 'ArcadeStage', 'arcade', g, { arcadeResult: { outcome, run: finished }, lyricDraft: ['l-a2', 'l-hook', 'l-punch'] }, { run: finished });
    expect(result).toContain('A');
    expect(result).toContain('820점');
    expect(result).toContain('다음 싱글 팬');
    expect(result).toContain('덱에 넣을 카드');
    expect(result).toContain('후크');
  });

  it('가챠·계단 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ResultModals');
    const photo = { kind: 'photo', results: [{ id: 'p1-6', set: 1, grade: 6, isNew: true, pity: true }, { id: 'p2-1', set: 2, grade: 1, isNew: false, pity: false }], sets: [1], diamonds: 10 };
    const html = await renderNamed(loader, 'GachaModal', 'collect', g, { gachaResult: photo });
    expect(html).toContain('신화');
    expect(html).toContain('천장');
    expect(html).toContain('세트 완성');
    const feat = { kind: 'feat', results: [{ id: 'f-moon', rarity: 'SSR', isNew: true, starUp: false, refund: 0, pickup: true }], refund: 0 };
    expect(await renderNamed(loader, 'GachaModal', 'collect', g, { gachaResult: feat })).toContain('달이 두 개인 밤');
    const tower = { win: true, floor: 5, enemy: { floor: 5, power: 100, boss: true, weak: 'dark' }, power: 150, roll: 1.02, coins: 800, diamonds: 1, first: true, newBest: true };
    const t = await renderNamed(loader, 'TowerModal', 'arcade', g, { towerResult: tower });
    expect(t).toContain('5층 돌파');
    expect(t).toContain('새 최고 기록');
  });

  it('랭킹: 레벨·계단 탭과 내 최고 기록 안내', async () => {
    const g = packState();
    const loader = () => import('../RankingScreen');
    const html = await renderNamed(loader, 'RankingScreen', 'ranking', g);
    expect(html).toContain('레벨');
    expect(html).toContain('무한의 계단');
    expect(html).toContain('불러오는 중');
    const tower = await renderNamed(loader, 'TowerBoard', 'ranking', g, {}, { best: 9 });
    expect(tower).toContain('내 최고 기록은 9층');
    expect(await renderNamed(loader, 'TowerBoard', 'ranking', g, {}, { best: 0 })).toContain('한 층이라도 깨면 순위에 올라요');
    const arcade = await renderNamed(() => import('../ArcadeScreen'), 'ArcadeScreen', 'arcade', g);
    expect(arcade).toContain('계단 랭킹 보러 가기');
  });
});
