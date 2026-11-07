import { existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PET_GROWN_STAGE, petImage, ASSETS } from '../../assets';
import { BALANCE, NURTURE_TEMP_OPEN, STAGES } from '../../game/balance';
import { albumDefById, albumSeries } from '../../game/content';
import { createInitialState } from '../../game/persistence';
import type { GameState, Mail, Single } from '../../game/types';
import { closeTempOpenStages, reopenTempOpenStages } from '../../game/__tests__/tempOpen';
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
    nurture: () => import('../NurtureScreen'),
    friends: () => import('../FriendsScreen'),
    dm: () => import('../DmScreen'),
    postbox: () => import('../MailboxScreen'),
    admin: () => import('../AdminScreen'),
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

afterEach(reopenTempOpenStages);

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

  it('공연: 유니버스 페스티벌 전에는 ???, 클리어 후에는 비밀 공연장이 보이고 일반속성이면 안내', async () => {
    closeTempOpenStages(); // 임시 개방과 상관없이 원래 조건을 본다
    const fresh = createInitialState(T0);
    const before = await render('concert', { ...fresh, fans: 1e7 });
    expect(before).toContain('???');
    expect(before).toContain('유니버스 페스티벌');
    expect(before).not.toContain('폐건물 지하공연');
    // 월클만 클리어해서는 비밀 공연장이 열리지 않는다
    const worldOnly = await render('concert', { ...fresh, fans: 1e7, concerts: { ...fresh.concerts, world: { ...fresh.concerts.world, cleared: true } } });
    expect(worldOnly).toContain('???');
    expect(worldOnly).not.toContain('폐건물 지하공연');
    const after = await render('concert', richState());
    expect(after).toContain('폐건물 지하공연');
    expect(after).toContain('어둠속성으로만 입장해요');
    expect(after).not.toContain('???');
    expect(after).not.toContain('다크웹 라이브공연'); // 앞 공연장을 클리어해야 다음이 보인다
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
    // 비밀 공연장은 모노사파런을 쓰지 않는다
    expect(dark).toContain('폐건물 지하공연');
    expect(dark).not.toContain('6,900m');
  });

  it('공연: 비밀 공연장 3곳은 각각 정전 속 박자·후원 채팅 스와이프·삼도천 징검다리로 직접 공연한다', async () => {
    closeTempOpenStages();
    const g = richState();
    const done = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    const opened = { ...g, fans: 1e7, activePersona: 'dark' as const, concerts: { ...g.concerts, rooftop: done, ruins: done } };
    const html = await render('concert', opened);
    for (const t of ['폐건물 지하공연', '직접 공연 · 정전 속 박자', '노트는 판정선 가까이 와야만 보이고', '다크웹 라이브공연', '직접 공연 · 후원 채팅 스와이프', '검열 규칙이 늘어나고', '저세상 공연페스티벌', '직접 공연 · 삼도천 징검다리', '도깨비불은 따끔']) expect(html).toContain(t);
    expect(html).toContain('팬 5.00M명');
    expect(html).toContain('어둠속성만 입장하는 공연장이라 보상 ×2');
    // 앞 공연장을 클리어하기 전에는 다음 공연장이 보이지 않는다
    const first = await render('concert', { ...g, fans: 1e7, activePersona: 'dark' as const });
    expect(first).toContain('폐건물 지하공연');
    expect(first).not.toContain('다크웹 라이브공연');
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
    for (const t of ['단콘', '응원봉 머지 웨이브', '열기 점수', '1곡 · 23초', `응원 파워 0 / ${BALANCE.merge.persona.normal.goals[0]}`, '무대 응원봉', '곡이 끝날 때마다 이펙터를 하나 골라요', '공연 포기', '같은 색·같은 단계 3개 이상이 붙은 응원봉을 눌러 합쳐요']) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect(html.split('role="gridcell"').length - 1).toBe(25);
    expect(html).not.toContain('🗯 야유꾼');
    const dark = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run: { ...run, persona: 'dark' } });
    expect(dark).toContain('stage-dark');
    expect(dark).toContain(`응원 파워 0 / ${BALANCE.merge.persona.dark.goals[0]}`);
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

  it('공연: 중형 공연장은 음파 튕기기로 직접 공연한다', async () => {
    const g = { ...richState(), fans: 20_000 };
    const normal = await render('concert', g);
    expect(normal).toContain('직접 공연 · 음파 튕기기');
    expect(normal).toContain('중형 공연장은 음파 튕기기');
    expect(normal).toContain('손가락으로 음파를 쏠 방향을 정하면');
    expect(normal).not.toContain('음파를 삼키는 방음벽이 섞이고');
    const dark = await render('concert', { ...g, activePersona: 'dark' });
    expect(dark).toContain('음파를 삼키는 방음벽이 섞이고 관객이 단단한 대신 보상 ×2');
    // 다른 공연장 표시는 그대로
    expect(normal).toContain('직접 공연 · 응원봉 머지 웨이브');
    expect(normal).toContain('직접 공연 · 무대 세팅 블록');
  });

  it('음파 튕기기 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 'b1', stageId: 'medium', persona: 'normal', game: 'bounce', difficulty: 1.7, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['중형 공연장', '음파 튕기기', '열기 점수', '1곡 · 23초', `응원 ${0} / ${BALANCE.bounce.persona.normal.goals[0]}`, '음파 0개', '3층(맨 뒷줄) ×4', '1층 ×1', '곡이 끝날 때마다 이펙터를 하나 골라요', '공연 포기', '손가락을 움직여 음파를 쏠 방향을 정해요']) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect(html).toContain('viewBox="0 0 700 1060"');
    expect((html.match(/data-cell="/g) ?? []).length).toBeGreaterThan(10);
    expect(html).not.toContain('방음벽은 부서지기 전까지');
    const dark = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run: { ...run, persona: 'dark' } });
    expect(dark).toContain('stage-dark');
    expect(dark).toContain(`응원 0 / ${BALANCE.bounce.persona.dark.goals[0]}`);
    expect(dark).toContain('방음벽은 부서지기 전까지');

    const bounce = { broken: 212, back: 31, booms: 9, shots: 218, peakBalls: 11, waves: [100, 92, 85, 71], effects: { amp: 2, rate: 0, split: 1, pierce: 0, echo: 0 }, seconds: 92 };
    const win = { stageId: 'medium', mode: 'manual', persona: 'normal', score: 812, coins: 4100, cleared: true, firstClear: true, firstClearCoins: 7500, diamonds: 30, bounce };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '812', '깬 관객 212명', '맨 뒷줄(3층) 31명', '폭죽 9번', '쏜 음파 218개', '최대 동시 11개', '92초', '1곡 100% · 2곡 92% · 3곡 85% · 앙코르 71%', '이펙터 🔊앰프 ×2 · 🔀분열', '첫 클리어 보너스']) expect(done).toContain(t);
    expect(done).not.toContain('보상 50%');

    const lose = { ...win, score: 300, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0, coins: 150, bounce: { ...bounce, waves: [60, 40, 30, 20], effects: { amp: 0, rate: 0, split: 0, pierce: 0, echo: 0 } } };
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: lose }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('600점 미만이라 보상 50%');
    expect(lost).not.toContain('이펙터 ');
  });

  it('공연: 중대형 공연장은 돌발 사고 막기로 직접 공연한다', async () => {
    const g = { ...richState(), fans: 60_000 };
    const normal = await render('concert', g);
    expect(normal).toContain('직접 공연 · 돌발 사고 막기');
    expect(normal).toContain('위에서 내려오는 사고(하울링·낙하 소품·합선·난입 관객)를 스태프가 자동으로 막아요');
    expect(normal).not.toContain('정전이 불을 꺼서');
    const dark = await render('concert', { ...g, activePersona: 'dark' });
    expect(dark).toContain('정전이 불을 꺼서 그 줄 스태프를 느리게 만드는 대신 보상 ×2');
    // 다른 공연장 표시는 그대로
    expect(normal).toContain('직접 공연 · 음파 튕기기');
    expect(normal).toContain('직접 공연 · 응원봉 머지 웨이브');
  });

  it('돌발 사고 막기 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 'd1', stageId: 'large', persona: 'normal', game: 'defense', difficulty: 1.7, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['중대형 공연장', '돌발 사고 막기', '열기 점수', '1곡 · 준비 중', `💰 예산 ${BALANCE.defense.startMoney}`, '막은 비율 0%', '무대 앞 — 여기까지 오면 사고!', '1곡 사고 예보', '하울링', '낙하 소품', '1곡 시작', '음향팀', '무대팀', '조명팀', '안전팀', '공연 포기', `다음 고용 비용 ${BALANCE.defense.hireBase}`]) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect(html).toContain('viewBox="0 0 500 850"');
    expect((html.match(/data-slot="/g) ?? []).length).toBe(15);
    expect(html).not.toContain('정전');
    const dark = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run: { ...run, persona: 'dark' } });
    expect(dark).toContain('stage-dark');
    expect(dark).toContain('정전 ×');
    expect(dark).toContain('정전이 살아 있는 줄 아래 스태프는 공격이 느려져요');

    const defense = { blocked: 41, leaked: 17, hires: 16, merges: 9, topRank: 3, taps: 33, waves: [96, 94, 60, 52], seconds: 94 };
    const win = { stageId: 'large', mode: 'manual', persona: 'normal', score: 750, coins: 9100, cleared: true, firstClear: true, firstClearCoins: 18000, diamonds: 40, defense };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '750', '막은 사고 41건', '놓친 사고 17건', '고용 16명', '승급 9번', '최고 직급 팀장', '직접 막기 33번', '94초', '1곡 96% · 2곡 94% · 3곡 60% · 앙코르 52%', '첫 클리어 보너스']) expect(done).toContain(t);
    expect(done).not.toContain('보상 50%');

    const lose = { ...win, score: 300, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0, coins: 450, defense: { ...defense, merges: 0, topRank: 1, waves: [60, 30, 20, 10] } };
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: lose }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('600점 미만이라 보상 50%');
    expect(lost).toContain('최고 직급 신입');
  });

  it('공연: 대형 콘서트는 무대 서바이버로 직접 공연한다', async () => {
    const g = { ...richState(), fans: 200_000 };
    const normal = await render('concert', g);
    expect(normal).toContain('직접 공연 · 무대 서바이버');
    expect(normal).toContain('손가락을 끌어 무대를 움직이며 몰려오는 파파라치 드론을 피해요');
    expect(normal).not.toContain('폭죽 탄막을 쏘는 엘리트 드론이 나오고');
    const dark = await render('concert', { ...g, activePersona: 'dark' });
    expect(dark).toContain('폭죽 탄막을 쏘는 엘리트 드론이 나오고 목표가 낮은 대신 보상 ×2');
    expect(normal).toContain('직접 공연 · 돌발 사고 막기');
  });

  it('무대 서바이버 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 's1', stageId: 'arena', persona: 'normal', game: 'survivor', difficulty: 1.7, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['대형 콘서트', '무대 서바이버', '열기 점수', '1곡 · 23초', `응원 0 / ${BALANCE.survivor.persona.normal.goals[0]}`, 'Lv.1', '🔦 스포트라이트 1', '💡 조명 1', '공연 포기', '손가락(마우스)을 끌어서 움직여요']) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect(html).toContain('viewBox="0 0 700 950"');
    expect(html).not.toContain('엘리트 드론은 멀리서');
    const dark = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run: { ...run, persona: 'dark' } });
    expect(dark).toContain('stage-dark');
    expect(dark).toContain(`응원 0 / ${BALANCE.survivor.persona.dark.goals[0]}`);
    expect(dark).toContain('엘리트 드론은 멀리서 폭죽 탄막을 쏴요');

    const survivor = { kills: 144, gems: 187, level: 9, heartsLeft: 2, died: false, weapons: { spot: 4, orbit: 3, laser: 2, firework: 0 }, passives: { speed: 1, magnet: 0, amp: 2, heart: 1 }, waves: [100, 96, 88, 71], seconds: 92 };
    const win = { stageId: 'arena', mode: 'manual', persona: 'normal', score: 889, coins: 9100, cleared: true, firstClear: true, firstClearCoins: 45000, diamonds: 50, survivor };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '889', '쓰러뜨린 드론 144대', '모은 응원 187', '레벨 9', '남은 하트 2개', '92초', '1곡 100% · 2곡 96% · 3곡 88% · 앙코르 71%', '🔦스포트라이트 4', '💡조명 3', '⚡레이저 2', '👟발걸음 1', '📣열기 증폭 2', '❤️하트 1', '첫 클리어 보너스']) expect(done).toContain(t);
    expect(done).not.toContain('🎆폭죽');
    expect(done).not.toContain('보상 50%');

    const lose = { ...win, score: 310, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0, coins: 500, survivor: { ...survivor, died: true, heartsLeft: 0, waves: [90, 60, 0, 0] } };
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: lose }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('무대에서 쓰러졌어요');
    expect(lost).toContain('600점 미만이라 보상 50%');
  });

  it('공연: 월클 콘서트는 월드투어 인크리멘탈로 직접 공연한다', async () => {
    const g = { ...richState(), fans: 1_000_000 };
    const normal = await render('concert', g);
    expect(normal).toContain('직접 공연 · 월드투어 인크리멘탈');
    expect(normal).toContain('무대를 눌러 팬을 모으고, 팬으로 대륙 응원단을 사서 자동으로 팬이 늘게 해요');
    expect(normal).not.toContain('비용이 비싸고 별빛 하나의 효과가 약하지만');
    const dark = await render('concert', { ...g, activePersona: 'dark' });
    expect(dark).toContain('비용이 비싸고 별빛 하나의 효과가 약하지만 목표가 낮고 보상 ×2');
    expect(normal).toContain('직접 공연 · 무대 서바이버');
  });

  it('월드투어 인크리멘탈 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 'w1', stageId: 'world', persona: 'normal', game: 'prestige', difficulty: 1.7, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['월클 콘서트', '월드투어 인크리멘탈', '열기 점수', '1곡 · 23초', `목표 ${BALANCE.prestige.persona.normal.goals[0]}`, '별빛 0', '영구 배율 ×1.00', '아시아 응원단', '오세아니아 응원단', '탭 강화', '합창', '곡이 끝날 때마다 영구 퍼크를 하나 골라요', '공연 포기', '무대를 눌러 팬을 모으고']) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect(html).not.toContain('어둠은 비용이 비싸고');
    const dark = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run: { ...run, persona: 'dark' } });
    expect(dark).toContain('stage-dark');
    expect(dark).toContain('어둠은 비용이 비싸고 별빛 하나의 효과가 약해요');

    const prestige = { produced: 70_000_000, stars: 27, mult: 5.05, taps: 530, goldens: 9, perks: { tapx: 1, autox: 2, seed: 0, discount: 0, luck: 0, star: 1 }, waves: [100, 96, 88, 71], seconds: 92 };
    const win = { stageId: 'world', mode: 'manual', persona: 'normal', score: 889, coins: 90000, cleared: true, firstClear: true, firstClearCoins: 120000, diamonds: 80, prestige };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '889', '만든 팬 70.0M명', '별빛 27', '영구 배율 ×5.05', '탭 530번', '월드 스포트라이트 9번', '92초', '1곡 100% · 2곡 96% · 3곡 88% · 앙코르 71%', '🎤팬서비스', '🌍월드 응원단 ×2', '✨별빛 증폭', '첫 클리어 보너스']) expect(done).toContain(t);
    expect(done).not.toContain('보상 50%');

    const lose = { ...win, score: 200, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0, coins: 1000, prestige: { ...prestige, perks: { tapx: 0, autox: 0, seed: 0, discount: 0, luck: 0, star: 0 }, waves: [50, 20, 0, 0] } };
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: lose }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('600점 미만이라 보상 50%');
    expect(lost).not.toContain('영구 퍼크 ');
  });

  it('정전 속 박자 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 'b1', stageId: 'rooftop', persona: 'dark', game: 'blackout', difficulty: 1.9, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['폐건물 지하공연', '정전 속 박자', '열기 점수', '1곡 1/4', '콤보 0', '시야 0.52초', `박자 ${BALANCE.blackout.bpm[0]}`, '1번 레인 (D)', '4번 레인 (K)', '불이 나가서 노트가 안 보여요', '공연 포기']) expect(html).toContain(t);
    expect(html).toContain('stage-dark');

    const blackout = { perfect: 150, good: 20, miss: 12, stray: 9, bestCombo: 61, notes: 182, waves: [100, 96, 88, 71], seconds: 92 };
    const win = { stageId: 'rooftop', mode: 'manual', persona: 'dark', score: 889, coins: 400000, cleared: true, firstClear: true, firstClearCoins: 1200000, diamonds: 200, blackout };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '889', 'Perfect 150 · Good 20 · Miss 12 · 헛손질 9 · 최고 콤보 61 · 노트 182개 · 92초', '곡별 달성 1곡 100% · 2곡 96% · 3곡 88% · 앙코르 71%', '첫 클리어 보너스', '💎 다이아']) expect(done).toContain(t);
    expect(done).not.toContain('보상 50%');
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: { ...win, score: 300, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0 } }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('600점 미만이라 보상 50%');
  });

  it('후원 채팅 스와이프 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 's1', stageId: 'ruins', persona: 'dark', game: 'swipe', difficulty: 2, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['다크웹 라이브공연', '후원 채팅 스와이프', '열기 점수', '1곡 1/4', '악플은 차단', `목표 ${BALANCE.swipe.goals[0]}`, '◀ 차단', '수락 ▶', '🚫 차단', '✅ 수락', '글을 오른쪽으로 밀면 수락', '공연 포기']) expect(html).toContain(t);
    expect(html).not.toContain('링크가 든 글은 차단');

    const swipe = { handled: 88, right: 80, wrong: 6, timeouts: 2, blocked: 41, accepted: 47, bestCombo: 23, waves: [100, 100, 93, 71], seconds: 92 };
    const win = { stageId: 'ruins', mode: 'manual', persona: 'dark', score: 941, coins: 900000, cleared: true, firstClear: true, firstClearCoins: 4000000, diamonds: 300, swipe };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '941', '넘긴 글 88개 · 정답 80 · 오답 6 · 놓침 2 · 수락 47 / 차단 41 · 최고 콤보 23 · 92초', '열기 목표 1곡 100% · 2곡 100% · 3곡 93% · 앙코르 71%', '첫 클리어 보너스']) expect(done).toContain(t);
  });

  it('삼도천 징검다리 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 't1', stageId: 'garage', persona: 'dark', game: 'stones', difficulty: 2.1, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['저세상 공연페스티벌', '삼도천 징검다리', '열기 점수', `${BALANCE.stones.bpm[0]}bpm`, `목표 ${BALANCE.stones.goals[0]}`, '물살 4칸 뒤', '❤️❤️❤️❤️❤️', '앞 줄의 돌', '공연 포기']) expect(html).toContain(t);

    const stones = { hops: 150, onBeat: 118, good: 20, bestStreak: 31, lotuses: 9, splashes: 2, burns: 1, swept: 1, rows: 150, heartsLeft: 1, died: false, waves: [100, 100, 91, 64], seconds: 92 };
    const win = { stageId: 'garage', mode: 'manual', persona: 'dark', score: 889, coins: 2000000, cleared: true, firstClear: true, firstClearCoins: 10000000, diamonds: 400, stones };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '889', '도착한 줄 150 · 뛴 횟수 150 · PERFECT 118 · GOOD 20 · 최고 박자 연속 31 · 연꽃 9개 · 남은 하트 1개 · 92초', '풍덩 2번 · 도깨비불 1번 · 물살에 쓸림 1번', '열기 목표 1곡 100% · 2곡 100% · 3곡 91% · 앙코르 64%', '첫 클리어 보너스']) expect(done).toContain(t);
    const dead = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: { ...win, score: 300, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0, stones: { ...stones, died: true, heartsLeft: 0 } } }, { run: { ...run, status: 'finished' } });
    expect(dead).toContain('물에 잠겼어요');
  });

  it('은하 노선 잇기 전체화면과 결과 창', async () => {
    const g = packState();
    const loader = () => import('../ConcertStage');
    const run = { id: 'u1', stageId: 'universe', persona: 'normal', game: 'galaxy', difficulty: 2.8, taskGrowth: 1.25, status: 'running' };
    const html = await renderNamed(loader, 'ConcertStage', 'concert', g, {}, { run });
    for (const t of ['유니버스 페스티벌', '은하 노선 잇기', '열기 점수', '1곡 1/4', '불만 0', `목표 ${BALANCE.galaxy.persona.normal.goals[0]}`, '노선 0/2 · 예비 셔틀 1대', '아직 노선이 없어요', '➕ 새 노선으로 잇기', '관객은 자기와 다른 모양의 정거장', '공연 포기']) expect(html).toContain(t);
    expect(html).toContain('stage-normal');
    expect((html.match(/data-station=/g) ?? []).length).toBe(3);

    const galaxy = { delivered: 280, spawned: 407, complaints: 3, transfers: 46, stations: 9, lines: 5, shuttles: 3, waves: [100, 96, 88, 71], seconds: 92 };
    const win = { stageId: 'universe', mode: 'manual', persona: 'normal', score: 889, coins: 80000, cleared: true, firstClear: true, firstClearCoins: 400000, diamonds: 120, galaxy };
    const done = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: win }, { run: { ...run, status: 'finished' } });
    for (const t of ['공연 성공!', '889', '도착한 관객 280/407명 · 갈아탄 횟수 46 · 불만 3번 · 정거장 9곳 · 노선 5개 · 셔틀 3대 추가 · 92초', '열기 목표 1곡 100% · 2곡 96% · 3곡 88% · 앙코르 71%', '첫 클리어 보너스', '💎 다이아']) expect(done).toContain(t);
    expect(done).not.toContain('보상 50%');
    const lost = await renderNamed(loader, 'ConcertStage', 'concert', g, { concertResult: { ...win, score: 300, cleared: false, firstClear: false, firstClearCoins: 0, diamonds: 0 } }, { run: { ...run, status: 'finished' } });
    expect(lost).toContain('아쉬운 공연…');
    expect(lost).toContain('600점 미만이라 보상 50%');
  });

  it('공연: 유니버스 페스티벌은 일반·어둠 모두 은하 노선 잇기로 직접 공연하고 어둠은 보상 ×2', async () => {
    const g = richState();
    const normal = await render('concert', { ...g, fans: 1e6 });
    for (const t of ['유니버스 페스티벌', '직접 공연 · 은하 노선 잇기', '정거장(●▲■★)을 끌어서 이어 노선을 만들고', '팬 500K명']) expect(normal).toContain(t);
    expect(normal).not.toContain('어둠은 정거장이 더 빨리 붐벼서');
    const dark = await render('concert', { ...g, fans: 1e6, activePersona: 'dark' as const });
    expect(dark).toContain('어둠은 정거장이 더 빨리 붐벼서 목표가 높은 대신 보상 ×2');
  });

  it('장비·작업실·도감도 새 필드와 함께 그려진다', async () => {
    closeTempOpenStages();
    const g = richState();
    expect(await render('equip', g)).toContain('오프라인 정산 확장');
    expect(await render('studio', g)).toContain('「라임 기계」');
    expect(await render('studio', g)).toContain('/assets/costume-bunny.webp'); // 입고 있는 코스튬
    const dark = await render('studio', { ...g, activePersona: 'dark' });
    expect(dark).toContain('/assets/costume-king.webp'); // 어둠속성은 자기 칸의 옷을 입는다
    expect(dark).not.toContain('/assets/costume-bunny.webp');
    // 도감도 비밀 공연장은 유니버스 페스티벌을 클리어한 뒤에만 보여 준다.
    expect(await render('collection', g)).toContain('폐건물 지하공연');
    expect(await render('collection', createInitialState(T0))).not.toContain('폐건물 지하공연');
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

  it('랭킹: 육성 탭과 내 육성 레벨 안내', async () => {
    const g = packState();
    const loader = () => import('../RankingScreen');
    expect(await renderNamed(loader, 'RankingScreen', 'ranking', g)).toContain('육성');
    const trained = await renderNamed(loader, 'NurtureBoard', 'ranking', g, {}, { normal: 12, dark: 7, trained: true });
    expect(trained).toContain('일반 Lv.12 · 어둠 Lv.7');
    expect(trained).toContain('불러오는 중');
    expect(await renderNamed(loader, 'NurtureBoard', 'ranking', g, {}, { normal: 1, dark: 1, trained: false })).toContain('한 번이라도 돌보면 순위에 올라요');
  });

  it('프로필 접속 상태: 접속 중 또는 n분 전 접속', async () => {
    const g = packState();
    const loader = () => import('../../components/parts');
    const on = await renderNamed(loader, 'Presence', 'ranking', g, {}, { agoMs: 30_000 });
    expect(on).toContain('presence-on');
    expect(on).toContain('접속 중');
    const off = await renderNamed(loader, 'Presence', 'ranking', g, {}, { agoMs: 17 * 60_000 });
    expect(off).not.toContain('presence-on');
    expect(off).toContain('17분 전 접속');
  });
});

describe('친구·우편함·프로필·관리자', () => {
  it('친구: 내 친구 코드 카드와 코드로 찾기, 안내 문구', async () => {
    box.user = { id: 'u1', email: 'a@b.c', name: '테스터', picture: null, isAdmin: false, friendCode: 'ABCD2345' };
    const html = await render('friends', richState());
    expect(html).toContain('ABCD2345');
    expect(html).toContain('친구 코드로 찾기');
    expect(html).toContain('하루에 한 번 서로에게');
    expect(html).toContain('프로필 설정');
    expect(html).toContain('불러오는 중');
  });

  it('우편함: 30일 보관과 받지 않은 다이아 안내', async () => {
    const html = await render('postbox', richState());
    expect(html).toContain('우편함');
    expect(html).toContain('30일 동안 보관');
    expect(html).toContain('불러오는 중');
  });

  it('개인 채팅: 상대를 고르지 않았으면 친구 목록으로 안내한다', async () => {
    const html = await render('dm', richState());
    expect(html).toContain('대화할 친구를 골라 주세요');
    expect(html).toContain('친구 목록으로');
  });

  it('관리자 화면은 관리자 계정에만 보인다', async () => {
    expect(await render('admin', richState())).toContain('관리자만 볼 수 있는 화면');
    box.user = { id: 'u1', email: 'a@b.c', name: '관리', picture: null, isAdmin: true };
    const html = await render('admin', richState());
    for (const w of ['신고 처리', '우편 보내기', '제한 중']) expect(html, w).toContain(w);
    expect(html).not.toContain('관리자만 볼 수 있는 화면');
  });

  it('더보기: 친구·우편함 메뉴가 있고 관리자 메뉴는 관리자에게만 보인다', async () => {
    const normal = await render('more', richState());
    for (const w of ['친구', '우편함']) expect(normal, w).toContain(w);
    expect(normal).not.toContain('신고 처리');
    box.user = { id: 'u1', email: 'a@b.c', name: '관리', picture: null, isAdmin: true };
    expect(await render('more', richState())).toContain('신고 처리');
  });

  it('프로필 창: 불러오는 동안 제목이 나온다', async () => {
    const loader = () => import('../ProfileSheet');
    expect(await renderNamed(loader, 'ProfileSheet', 'ranking', richState(), {}, { uid: 'x', edit: false })).toContain('프로필');
    expect(await renderNamed(loader, 'ProfileSheet', 'ranking', richState(), {}, { uid: 'x', edit: true })).toContain('프로필 설정');
  });

  it('신고창: 대상 이름과 사유 목록, 개인채팅 안내', async () => {
    const loader = () => import('../../components/ReportDialog');
    const chat = await renderNamed(loader, 'ReportDialog', 'chat', richState(), {}, { target: { kind: 'chat', refId: 'm1', label: '밤새는사람' } });
    expect(chat).toContain('밤새는사람');
    expect(chat).toContain('챗방 메시지');
    for (const w of ['욕설·비방', '도배·광고', '음란·불쾌한 내용', '혐오·차별', '기타']) expect(chat, w).toContain(w);
    expect(chat).not.toContain('앞선 대화');
    const dm = await renderNamed(loader, 'ReportDialog', 'chat', richState(), {}, { target: { kind: 'dm', refId: 'm2', label: '친구' } });
    expect(dm).toContain('개인채팅 메시지');
    expect(dm).toContain('앞선 대화');
  });

  it('설정: 로그인했으면 프로필 설정 버튼이 있다', async () => {
    box.user = { id: 'u1', email: 'a@b.c', name: '테스터', picture: null, isAdmin: false, displayName: '닉네임이다', avatar: 'google' };
    const html = await renderNamed(() => import('../SettingsSheet'), 'SettingsSheet', 'studio', richState());
    expect(html).toContain('프로필 설정');
    expect(html).toContain('닉네임이다');
  });
});

describe('모노사파 육성 화면', () => {
  const open = (patch: Partial<GameState> = {}): GameState => ({ ...richState(), fans: BALANCE.nurture.unlockFans, ...patch });

  it.skipIf(NURTURE_TEMP_OPEN)('팬이 모자라면 잠금 안내와 남은 조건을 보여 준다', async () => {
    const html = await render('nurture', open({ fans: 5000 }));
    expect(html).toContain('팬 80.0K명부터 열려요');
    expect(html).not.toContain('밥주기');
  });

  it.runIf(NURTURE_TEMP_OPEN)('임시 개방 중에는 팬이 모자라도 열리고 안내 문구가 붙는다', async () => {
    const html = await render('nurture', open({ fans: 5000 }));
    expect(html).toContain('임시로 열려 있어요');
    expect(html).toContain('팬 80.0K명부터예요');
    expect(html).toContain('밥주기');
    expect(await render('nurture', open())).not.toContain('임시로 열려 있어요');
  });

  it('일반: 게이지 네 가지와 행동 네 가지가 나온다', async () => {
    const html = await render('nurture', open({ activePersona: 'normal' }));
    for (const w of ['포만감', '기분', '피로도', '청결도', '밥주기', '놀아주기', '씻겨주기', '잠자기', 'Lv 1']) expect(html, w).toContain(w);
    expect(html).not.toContain('카스레몬');
  });

  it('어둠: 쾌락지수 게이지와 술 8단계·놀기 11단계가 레벨 잠금과 함께 나온다', async () => {
    const html = await render('nurture', open({ activePersona: 'dark' }));
    for (const w of ['쾌락지수', '카스레몬', '테라', '새로', '참이슬(빨뚜)', '양주', '고량주(96°)', '퍼플드링크', '디스코팡팡', '클럽', '떡치기', '오디', '브액', 'LSD', '캔디', 'PCP', '펜타닐', '아이스', 'Lv 38']) {
      expect(html, w).toContain(w);
    }
    expect(html).not.toContain('밥주기');
  });

  it('일반·어둠 모노사파 그림이 각각 보이고, 입은 코스튬이 있으면 그 모습이다', async () => {
    // richState는 코스튬을 입고 있어서 기본 옷 상태로 바꿔 본다
    const plain = (persona: 'normal' | 'dark'): GameState => {
      const g = open({ activePersona: persona });
      return { ...g, cosmetics: { ...g.cosmetics, costume: null, darkCostume: null } };
    };
    const normal = await render('nurture', plain('normal'));
    expect(normal).toContain('class="nurture-sapa-img" src="/assets/mono-normal.webp"');
    // 위쪽 탭에는 두 자아의 얼굴이 모두 나온다
    expect(normal).toContain('class="nurture-thumb" src="/assets/mono-dark.png"');
    const dark = await render('nurture', plain('dark'));
    expect(dark).toContain('class="nurture-sapa-img" src="/assets/mono-dark.png"');
    expect(dark).toContain('class="nurture-thumb" src="/assets/mono-normal.webp"');
    const g = plain('normal');
    const dressed = await render('nurture', { ...g, cosmetics: { ...g.cosmetics, costumes: ['maid'], costume: 'maid' } });
    expect(dressed).toContain('class="nurture-sapa-img" src="/assets/costume-maid.webp"');
  });

  it('자는 중에는 남은 시간과 깨우기가 보이고, 하단 더보기에 육성 항목이 있다', async () => {
    const g = open({ activePersona: 'normal', nurture: { ...open().nurture, normal: { ...open().nurture.normal, at: T0, sleepUntil: T0 + 3600_000 } }, lastSettledAt: T0 });
    const html = await render('nurture', g);
    expect(html).toContain('자는 중');
    expect(html).toContain('깨우기');
    expect(await render('more', g)).toContain('모노사파 육성');
  });
});
