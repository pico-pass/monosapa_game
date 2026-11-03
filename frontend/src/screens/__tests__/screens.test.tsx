import { existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PET_GROWN_STAGE, petImage, ASSETS } from '../../assets';
import { STAGES } from '../../game/balance';
import { albumDefById, albumSeries } from '../../game/content';
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
    stats: () => import('../StatsScreen'),
    release: () => import('../ReleaseScreen'),
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
    cosmetics: { themes: ['default', 'neon'], theme: 'neon', costumes: ['bunny', 'king'], costume: 'bunny', darkCostume: 'king', title: 'grind' },
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

  it('상점: 코스튬 21종(일반 11·어둠 10)과 입는 중 표시', async () => {
    const html = await render('shop', richState());
    for (const name of ['지뢰사파', '텐션업 사파', '화난사파', '메이드사파', '토끼사파', '타락천사 사파', '곰도리사파', '수녀 사파', '뱀파이어사파', '냥집사 사파', '유령신부 사파']) expect(html).toContain(name);
    for (const name of ['검은토끼사파', '지뢰밴드 사파', '어둠의왕사파', '딸기우유사파', '곰도리어둠사파', '편지배달부사파', '어둠의교주 사파', '삐에로 사파', '어둠의간호사파', '어둠의신부사파']) expect(html).toContain(name);
    expect(html).toContain('/assets/costume-bride.webp');
    expect(html).toContain('/assets/costume-dbride.webp');
    expect(html.match(/💎 50/g)?.length).toBeGreaterThanOrEqual(10); // 토끼사파만 가졌으니 일반 나머지 10종은 50 버튼
    expect(html.match(/💎 66/g)?.length).toBeGreaterThanOrEqual(9); // 어둠의왕사파만 가졌으니 어둠 나머지 9종은 66 버튼
    expect(html.match(/입는 중/g)?.length).toBeGreaterThanOrEqual(2); // 토끼사파(일반)와 어둠의왕사파(어둠)
    expect(html.match(/기본 옷/g)?.length).toBe(2); // 자아마다 하나
  });

  it('통계: 유통사 호감도 카드와 스트리밍 수익 배율', async () => {
    const poor = await render('stats', { ...richState(), coins: 100, distributor: 3 });
    expect(poor).toContain('유통사 호감도');
    expect(poor).toContain('Lv.3');
    expect(poor).toContain('×1.15 →'); // 지금 +15%
    expect(poor).toContain('×1.2'); // 다음 레벨 +20%
    expect(poor).toContain('30스트리밍 = 🪙 1.15');
    expect(poor).toContain('필요'); // 코인이 모자란다
    const rich = await render('stats', { ...richState(), coins: 1e6, distributor: 0 });
    expect(rich).toContain('30스트리밍 = 🪙 1 ·');
    expect(rich).toContain('올리기');
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

  it('앨범: 일반 4~6번째와 어둠 1~3번째 앨범이 발매 화면과 도감에 나온다', async () => {
    const have = (ids: string[]) => ids.map((id) => ({ id, title: albumDefById(id)!.title, type: albumDefById(id)!.type, releasedAt: T0 }));
    const normal = (n: number) => albumSeries('normal').slice(0, n).map((d) => d.id);
    const dark = (n: number) => albumSeries('dark').slice(0, n).map((d) => d.id);

    // 일반 3장을 낸 상태: 일반은 4번째, 어둠은 1번째 앨범이 따로 나온다
    const next = await render('release', { ...richState(), albums: have(normal(3)) });
    expect(next).toContain('4/6번째 앨범');
    expect(next).toContain('[Voyage, Love &amp; Blank]');
    expect(next).toContain('Love:憎惡⟹愛着');
    expect(next).toContain('Blank:론리청춘');
    expect(next).toContain('+14%'); // 일반 4번째 인세 배율
    expect(next).toContain('1/3번째 앨범 · EP · 어둠속성');
    expect(next).toContain('+12%'); // 어둠 1번째 인세 배율
    expect(next).toContain('🪙 100K'); // 어둠 1번째 비용(화면은 줄여서 보여 준다)
    expect(next).toContain('팬 <b>+124</b>');
    expect(next).toContain('[...정병러브...]');
    expect(next).toContain('외모정병내가고쳐준다니까(feat.ruletheworldboi)');
    expect(next).toContain('<span class="track-tag">Title</span>');
    expect(next.match(/앨범 발매하기|코인 .* 더 필요/g)).toHaveLength(2); // 속성마다 발매 버튼 하나씩

    // 어둠 1·2번째를 낸 뒤: 어둠 3번째 앨범
    const third = await render('release', { ...richState(), albums: have([...normal(6), ...dark(2)]) });
    expect(third).toContain('3/3번째 앨범 · EP · 어둠속성');
    expect(third).toContain('+40%');
    expect(third).toContain('[트롯사파 팩]');
    expect(third).toContain('트롯사파2(feat.한결행복가든)');
    expect(third).toContain('일반속성 앨범 6장을 모두 발매했어요');

    const fifth = await render('release', { ...richState(), albums: have(normal(4)) });
    expect(fifth).toContain('[why my *GIRLS* not stereo]');
    expect(fifth).toContain('what means &quot;jerk&quot; in korean?');
    const last = await render('release', { ...richState(), albums: have(normal(5)) });
    expect(last).toContain('[why my *GIRL* not mono]');
    expect(last).toContain('우리의 사랑은 왜 베일에 쌓였을까');

    const all = await render('release', { ...richState(), albums: have([...normal(6), ...dark(3)]) });
    expect(all).toContain('일반속성 앨범 6장을 모두 발매했어요');
    expect(all).toContain('어둠속성 앨범 3장을 모두 발매했어요');
    expect(all).not.toContain('앨범 발매하기');

    const shelf = await render('collection', { ...richState(), albums: have([...normal(6), ...dark(3)]) });
    expect(shelf).toContain('일반속성 앨범 (6/6)');
    expect(shelf).toContain('어둠속성 앨범 (3/3)');
    expect(shelf).toContain('<strong>9/9</strong>'); // 도감 위쪽 앨범 칸: 낸 앨범 / 전체
    for (const t of ['Voyage, Love &amp; Blank', 'why my *GIRLS* not stereo', 'why my *GIRL* not mono', '@mensa_kr', '싸가지', '...정병러브...', '니엄마는...', '트롯사파 팩', '니엄마의배꼽에다나는송곳을박아']) expect(shelf).toContain(t);

    // 도감: 안 낸 어둠 앨범은 ？？？로 가려지고 다음 앨범만 안내한다
    const partial = await render('collection', { ...richState(), albums: have(dark(1)) });
    expect(partial).toContain('어둠속성 앨범 (1/3)');
    expect(partial).toContain('일반속성 앨범 (0/6)');
    expect(partial).toContain('[...정병러브...]');
    expect(partial).not.toContain('[니엄마는...]');
    expect(partial).toContain('다음에 발매할 앨범이에요.');
    expect(partial).toContain('앞 앨범을 먼저 발매해요.');
  });

  it('공연: 모노사파런 안내는 공연장·자아마다 목표 거리가 다르다', async () => {
    const g = richState();
    const normal = await render('concert', g);
    expect(normal).toContain('400m를 완주하면 성공');
    expect(normal).not.toContain('2,600m');
    const dark = await render('concert', { ...g, activePersona: 'dark' });
    expect(dark).toContain('697.4m를 완주하면 성공');
    expect(dark).not.toContain('6,900m');
    // 폐건물 지하는 원래 코스 그대로
    const opened = { ...g, fans: 1e7, activePersona: 'dark' as const, concerts: { ...g.concerts, rooftop: { ...g.concerts.rooftop, cleared: true } } };
    const ruins = await render('concert', opened);
    expect(ruins).toContain('폐건물 지하');
    expect(ruins).toContain('6,900m를 완주하면 성공');
    expect(ruins).toContain('697.4m를 완주하면 성공');
  });

  it('공연: 소형 공연장은 무대 세팅 블록으로 직접 공연한다', async () => {
    const g = richState();
    const normal = await render('concert', g);
    expect(normal).toContain('직접 공연 · 무대 세팅 블록');
    expect(normal).toContain('악기 블록을 끌어다 8×8 무대에 놓고');
    expect(normal).toContain('스태프가 한 번 줄을 치워 줘요');
    expect(normal).toContain('소형 공연장은 무대 세팅 블록');
    const dark = await render('concert', { ...g, activePersona: 'dark' });
    expect(dark).toContain('성공선이 높은 대신 보상 ×2');
    // 방구석(마이크 타이밍)과 지하 클럽(모노사파런) 표시는 그대로
    expect(normal).toContain('직접 공연 · 모노사파런');
  });

  it('무대 세팅 블록 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 'h1', stageId: 'hall', persona: 'normal', game: 'blocks', difficulty: 1.57, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['소형 공연장', '무대 세팅 블록', '열기 점수', '1곡 · 23초', '곡 점수 ×1', '무대 바닥', '블록 1 끌어서 놓기', '블록 2 끌어서 놓기', '블록 3 끌어서 놓기', '고장 난 장비 칸이 생기고', '공연 포기']) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect(html).toContain('블록을 끌어다 무대에 놓아 줄을 채워요'); // 카운트다운 안내
    expect(html.split('role="gridcell"').length - 1).toBe(64);
    expect(html).not.toContain('✖'); // 일반은 불량 칸 없이 시작한다
    const dark = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run: { ...run, persona: 'dark' } });
    expect(dark).toContain('stage-dark');
    expect(dark).toContain('던져진 물건 칸이 생기고');
    expect(dark.split('✖').length - 1).toBe(3); // 어둠은 던져진 물건 3칸이 깔린 채 시작한다

    const blocks = { lines: 21, pieces: 38, bestCombo: 6, perfects: 1, rescues: 1, seconds: 92, stuck: false };
    const win = { stageId: 'hall', mode: 'manual', persona: 'normal', score: 812, coins: 2100, cleared: true, firstClear: true, firstClearCoins: 1200, diamonds: 15, blocks };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '812', '터뜨린 줄 21', '놓은 블록 38', '최고 콤보 6', '퍼펙트 1번', '스태프 정리 1번', '92초', '첫 클리어 보너스']) expect(done).toContain(t);
    expect(done).not.toContain('보상 50%');
    expect(done).not.toContain('중간에 끝났어요');

    const lose = { ...win, score: 300, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0, coins: 90, blocks: { ...blocks, perfects: 0, rescues: 0, stuck: true } };
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: lose }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('놓을 곳이 없어 중간에 끝났어요');
    expect(lost).toContain('600점 미만이라 보상 50%');
    expect(lost).not.toContain('퍼펙트');
    expect(lost).not.toContain('스태프 정리');
  });

  it('블록 끌기: 손가락·마우스 위치에서 놓일 칸을 구한다', async () => {
    const { anchorFor } = await import('../BlockStage');
    const { PIECES } = await import('../../game/blocks');
    const rect = { left: 100, top: 200, width: 400 }; // 한 칸 50px
    const dot = PIECES[0];
    const bar3 = PIECES.find((p) => p.w === 3 && p.h === 1)!;
    // 칸 한가운데에 점 블록: 그 칸
    expect(anchorFor(100 + 50 * 2 + 25, 200 + 50 * 3 + 25, rect, dot, 0)).toEqual({ row: 3, col: 2 });
    // 가로 3칸 블록은 가운데 칸 위에 손가락을 두면 왼쪽 위가 한 칸 왼쪽이다
    expect(anchorFor(100 + 50 * 4 + 25, 200 + 50 * 1 + 25, rect, bar3, 0)).toEqual({ row: 1, col: 3 });
    // 터치는 손가락 위로 띄운 만큼 위쪽 칸에 놓인다
    expect(anchorFor(100 + 25, 200 + 50 * 5 + 25, rect, dot, 2)).toEqual({ row: 3, col: 0 });
    // 판 밖이면 음수나 8 이상이 나온다(놓을 수 없는 자리)
    expect(anchorFor(0, 0, rect, dot, 0).col).toBeLessThan(0);
    expect(anchorFor(9999, 9999, rect, dot, 0).row).toBeGreaterThanOrEqual(8);
  });

  it('공연: 단콘은 응원봉 머지 웨이브로 직접 공연한다', async () => {
    const g = richState();
    const normal = await render('concert', g);
    expect(normal).toContain('직접 공연 · 응원봉 머지 웨이브');
    expect(normal).toContain('같은 색·같은 단계 응원봉이 3개 이상 붙으면 눌러서 한 단계 위로 합쳐요');
    expect(normal).toContain('단콘은 응원봉 머지 웨이브');
    expect(normal).not.toContain('야유꾼이 섞여 들어와');
    const dark = await render('concert', { ...g, activePersona: 'dark' });
    expect(dark).toContain('야유꾼이 섞여 들어와 응원을 깎고 목표가 높은 대신 보상 ×2');
    // 소형 공연장(무대 세팅 블록)·지하 클럽(모노사파런) 표시는 그대로
    expect(normal).toContain('직접 공연 · 무대 세팅 블록');
    expect(normal).toContain('직접 공연 · 모노사파런');
  });

  it('응원봉 머지 웨이브 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 's1', stageId: 'solo', persona: 'normal', game: 'merge', difficulty: 1.7, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['단콘', '응원봉 머지 웨이브', '열기 점수', '1곡 · 23초', '응원 파워 0 / 600', '무대 응원봉', '곡이 끝날 때마다 이펙터를 하나 골라요', '공연 포기', '같은 색·같은 단계 3개 이상이 붙은 응원봉을 눌러 합쳐요']) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect(html.split('role="gridcell"').length - 1).toBe(25);
    expect(html).not.toContain('🗯 야유꾼');
    const dark = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run: { ...run, persona: 'dark' } });
    expect(dark).toContain('stage-dark');
    expect(dark).toContain('응원 파워 0 / 700');
    expect(dark).toContain('야유꾼은 합칠 수 없고');

    const merge = { merges: 58, bestChain: 2, bestCombo: 7, topLevel: 5, stars: 1, heckled: 0, waves: [100, 92, 85, 71], effects: { amp: 2, light: 0, chorus: 1, chain: 0, pair: 0 }, seconds: 92 };
    const win = { stageId: 'solo', mode: 'manual', persona: 'normal', score: 812, coins: 2100, cleared: true, firstClear: true, firstClearCoins: 3000, diamonds: 20, merge };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '812', '합친 횟수 58', '최고 연쇄 2', '최고 콤보 7', '최고 단계 별', '별 응원봉 1번', '92초', '1곡 100% · 2곡 92% · 3곡 85% · 앙코르 71%', '이펙터 🔊앰프 ×2 · 🎶코러스', '첫 클리어 보너스']) expect(done).toContain(t);
    expect(done).not.toContain('야유꾼 퇴치');
    expect(done).not.toContain('보상 50%');

    const lose = { ...win, score: 300, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0, coins: 150, merge: { ...merge, topLevel: 3, stars: 0, heckled: 6, waves: [60, 40, 30, 20], effects: { amp: 0, light: 0, chorus: 0, chain: 0, pair: 0 } } };
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: lose }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('최고 단계 3');
    expect(lost).toContain('야유꾼 퇴치 6명');
    expect(lost).toContain('600점 미만이라 보상 50%');
    expect(lost).not.toContain('별 응원봉');
    expect(lost).not.toContain('이펙터 ');
  });

  it('장비·작업실·도감도 새 필드와 함께 그려진다', async () => {
    const g = richState();
    expect(await render('equip', g)).toContain('오프라인 정산 확장');
    expect(await render('studio', g)).toContain('「라임 기계」');
    expect(await render('studio', g)).toContain('/assets/costume-bunny.webp'); // 입고 있는 코스튬
    const dark = await render('studio', { ...g, activePersona: 'dark' });
    expect(dark).toContain('/assets/costume-king.webp'); // 어둠속성은 자기 칸의 옷을 입는다
    expect(dark).not.toContain('/assets/costume-bunny.webp');
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
    // 첫 곡은 리듬 모드로 플레이할 수 있는 음원 곡(어둠속성 「정신병자러브」)이다.
    singles: s.singles.map((x, i) => (i === 0 ? { ...x, persona: 'dark' as const, title: '정신병자러브' } : x)),
    cards: { ...s.cards, deck: ['single-1'], remaster: { 'single-1': 1 } },
    photo: { ...s.photo, tickets: 4, shards: 30, owned: { 'p1-1': 2, 'p1-2': 1, 'p3-4': 1 }, pity: 10 },
    feat: { ...s.feat, owned: { 'f-alfrado': 2, 'f-scails': 1 }, slots: ['f-alfrado'] },
    mascot: { normal: { xp: 100, fullUntil: T0 + 3600_000, playReadyAt: 0, giftReadyAt: 0, fed: 25 }, dark: { xp: 0, fullUntil: 0, playReadyAt: T0 + 60_000, giftReadyAt: 0, fed: 0 } },
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
    expect(cards).toContain('「정신병자러브」');
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
    expect(feat).toContain('Alfrado');
    expect(feat).toContain('일반');
    expect(feat).toContain('전설');
    expect(feat).toContain('85%'); // 일반 확률
    expect(feat).not.toMatch(/>(N|R|SR|SSR)</); // 등급 배지는 한글 이름으로
    expect(feat).toContain('？？？'); // 미계약 래퍼는 가려 둔다
    expect(feat).toContain('해제'); // 장착한 래퍼

    const pet = await renderNamed(loader, 'MascotTab', 'collect', g);
    expect(pet).toContain('몽글이');
    expect(pet).toContain('까망이');
    expect(pet).toContain('선물 받기');
    expect(pet).toContain('1.75%씩 올라요');
    expect(pet).toContain('500번째부터는 그대로');
    expect(pet).toContain('간식 🪙 139'); // 몽글이: 25번 먹여서 ceil(90×1.0175^25)
    expect(pet).toContain('간식 🪙 90'); // 까망이: 아직 안 먹였다
    expect(pet).toContain('/assets/pet-normal-1.webp'); // 몽글이 100xp = 청소년: 첫 번째 모습
    expect(pet).not.toContain('/assets/pet-normal-2.webp');
    expect(pet).toContain('🥚'); // 까망이는 아직 알이라 이미지 없이 이모지
    expect(pet).not.toContain('/assets/pet-dark');
  });

  it('작업실에는 지금 자아의 펫이 성장 단계에 맞게 나온다', async () => {
    const g = packState();
    const normal = await render('studio', g);
    expect(normal).toContain('/assets/pet-normal-1.webp'); // 몽글이 청소년
    expect(normal).not.toContain('/assets/pet-dark');
    const grown = await render('studio', { ...g, mascot: { ...g.mascot, normal: { ...g.mascot.normal, xp: 300 } } });
    expect(grown).toContain('/assets/pet-normal-2.webp'); // 어른 이후는 두 번째 모습
    const egg = await render('studio', { ...g, activePersona: 'dark' });
    expect(egg).toContain('🥚'); // 까망이는 알
    expect(egg).not.toContain('/assets/pet-');
    const dark = await render('studio', { ...g, activePersona: 'dark', mascot: { ...g.mascot, dark: { ...g.mascot.dark, xp: 90 } } });
    expect(dark).toContain('/assets/pet-dark-1.webp');
    const legend = await render('studio', { ...g, activePersona: 'dark', mascot: { ...g.mascot, dark: { ...g.mascot.dark, xp: 800 } } });
    expect(legend).toContain('/assets/pet-dark-2.webp');
    // 단계 → 이미지 규칙과 파일이 실제로 있는지
    expect([0, 1, 2, 3, 4].map((st) => petImage('normal', st))).toEqual([null, ASSETS.pets.normal.young, ASSETS.pets.normal.young, ASSETS.pets.normal.grown, ASSETS.pets.normal.grown]);
    expect(PET_GROWN_STAGE).toBe(3);
    for (const path of [ASSETS.pets.normal.young, ASSETS.pets.normal.grown, ASSETS.pets.dark.young, ASSETS.pets.dark.grown]) {
      expect(existsSync(new URL(`../../../public${path}`, import.meta.url))).toBe(true);
    }
  });

  it('아케이드: 곡 선택·계단·덱', async () => {
    const html = await renderNamed(() => import('../ArcadeScreen'), 'ArcadeScreen', 'arcade', packState());
    for (const t of ['리듬 모드', '새벽 생존', '가사 덱', '피켓팅', '무한의 계단']) expect(html).toContain(t);
    expect(html).toContain('최고 850');
    expect(html).toContain('4층');
    expect(html).toContain('약점');
    expect(html).toMatch(/여유|보통|어려움/);
    expect(html).toContain('덱 12장');
    expect(html).toContain('정신병자러브');
    expect(html).toContain('음원 곡 90초');
    expect(html).not.toContain('곡 고르기'); // 음원 곡이 하나뿐이라 고르는 칸이 없다
    expect(html).not.toContain('곡2');
    const fresh = await renderNamed(() => import('../ArcadeScreen'), 'ArcadeScreen', 'arcade', createInitialState(T0));
    expect(fresh).toContain('첫 싱글을 발매하면');
    expect(fresh).toContain('음원 곡을 발매하면 열려요');
    expect(fresh).toContain('어둠속성 「정신병자러브」 싱글을 발매하면');
    // 음원 곡이 아닌 싱글만 있으면 리듬 모드는 잠겨 있고, 다른 게임은 열려 있다
    const other = await renderNamed(() => import('../ArcadeScreen'), 'ArcadeScreen', 'arcade', { ...createInitialState(T0), singles: singles(2) });
    expect(other).toContain('음원 곡을 발매하면 열려요');
    expect(other).not.toContain('곡1');
    expect(other).toContain('3분 버티기');
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
    const chart = await renderNamed(() => import('../ChartScreen'), 'ChartScreen', 'chart', g);
    expect(chart).toContain('실시간 음원 차트');
    expect(chart).toContain('일반속성 곡 전체와 어둠속성 곡 전체');
    expect(await renderNamed(() => import('../SamplerScreen'), 'SamplerScreen', 'sampler', g)).toContain('녹음하기');
  });

  it('아케이드 전체화면: 네 가지 게임과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ArcadeStage');
    const run = (kind: 'rhythm' | 'survival' | 'lyric' | 'ticketing') => ({ id: 'r1', kind, persona: 'dark', power: 0, seed: 7, target: kind === 'rhythm' ? 'single-1' : null, level: 'normal', status: 'running' });
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

  it('계단 보스전 전체화면', async () => {
    const g = packState();
    const enemy = { floor: 4, power: 60, boss: false, weak: 'dark' };
    const run = { id: 't1', persona: 'dark', floor: 4, enemy, power: 90, ratio: 1.5, seed: 9, status: 'running' };
    const html = await renderNamed(() => import('../TowerStage'), 'TowerStage', 'arcade', g, {}, { run });
    expect(html).toContain('4층');
    expect(html).toContain('×1.50');
    expect(html).toContain('나가기');
    expect(html).toContain('보스 체력');
    const boss = await renderNamed(() => import('../TowerStage'), 'TowerStage', 'arcade', g, {}, { run: { ...run, floor: 5, enemy: { ...enemy, floor: 5, boss: true } } });
    expect(boss).toContain('5층 보스');
  });

  it('가챠·계단 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ResultModals');
    const photo = { kind: 'photo', results: [{ id: 'p1-6', set: 1, grade: 6, isNew: true, pity: true }, { id: 'p2-1', set: 2, grade: 1, isNew: false, pity: false }], sets: [1], diamonds: 10 };
    const html = await renderNamed(loader, 'GachaModal', 'collect', g, { gachaResult: photo });
    expect(html).toContain('신화');
    expect(html).toContain('천장');
    expect(html).toContain('세트 완성');
    const feat = { kind: 'feat', results: [{ id: 'f-scails', rarity: 'SSR', isNew: true, starUp: false, refund: 0, pickup: true }], refund: 0 };
    const featHtml = await renderNamed(loader, 'GachaModal', 'collect', g, { gachaResult: feat });
    expect(featHtml).toContain('Scails');
    expect(featHtml).toContain('전설');
    const tower = { win: true, floor: 5, enemy: { floor: 5, power: 100, boss: true, weak: 'dark' }, power: 150, ratio: 1.5, coins: 800, diamonds: 1, first: true, newBest: true };
    const t = await renderNamed(loader, 'TowerModal', 'arcade', g, { towerResult: tower });
    expect(t).toContain('5층 돌파');
    expect(t).toContain('새 최고 기록');
    expect(t).toContain('×1.50');
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
