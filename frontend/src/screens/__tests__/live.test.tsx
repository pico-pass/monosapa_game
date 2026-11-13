import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LIVE_DAILY_CAP } from '../../../../backend/src/live/rules';
import { FANDOM } from '../../../../realtime/src/fandom/world';
import { QUIZ } from '../../../../realtime/src/lyric/quiz';
import type { FandomSnapshot, LyricRecord, ServerMsg } from '../../../../realtime/src/protocol';
import { liveUrl } from '../../platform/live';
import { FANDOM_FIRST_TIER, drawFandom } from '../live/FandomLive';
import { LyricBoard } from '../live/LyricLive';
import { fandomReduce, initialFandom } from '../live/fandomState';
import { lerpView, toView, viewAt, type FandomViewData } from '../live/fandomView';
import { RecordCard, RecordLine } from '../live/LyricRecord';
import { initialLyric, lyricReduce, type LyricState } from '../live/lyricState';
import { FANDOM_REWARD_TEXT, QUIZ_REWARD_TEXT } from '../live/text';
import { LiveScreen } from '../LiveScreen';

const html = (el: React.ReactElement): string => renderToString(el).replace(/<!-- -->/g, '');

/** 메시지를 차례로 먹여 상태를 만든다(받은 시각은 메시지마다 1000ms씩 늘어난다) */
const lyricAfter = (msgs: ServerMsg[], at = 0): LyricState => msgs.reduce((s, m, i) => lyricReduce(s, m, at + i * 0), initialLyric);

describe('라이브 소켓 주소', () => {
  it('https면 wss, http면 ws, 호스트는 지금 페이지와 같다', () => {
    expect(liveUrl({ protocol: 'https:', host: 'monogame69.net' })).toBe('wss://monogame69.net/rt');
    expect(liveUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/rt');
  });
});

const RECORD: LyricRecord = {
  games: 12,
  multiGames: 9,
  wins: 3,
  totalCorrect: 41,
  bestScore: 1280,
  bestCorrect: 8,
  recent: [
    { at: 1_700_000_000_000, rank: 2, players: 3, score: 700, correct: 4, rounds: 7, multi: true },
    { at: 1_700_100_000_000, rank: 1, players: 1, score: 1280, correct: 8, rounds: 9, multi: false },
  ],
};

describe('가사 빈칸 속도전 상태', () => {
  const players = [
    { uid: 'a', name: '에이' },
    { uid: 'b', name: '비' },
  ];

  it('대기실 → 문제 → 힌트·맞힌 사람·내 결과 → 공개 → 끝 순서로 바뀐다', () => {
    let s = lyricReduce(initialLyric, { t: 'hello', uid: 'a', name: '에이' }, 0);
    s = lyricReduce(s, { t: 'l.lobby', players, startsInMs: 12_000, solo: false }, 1000);
    expect(s.view).toMatchObject({ k: 'lobby', startsAt: 13_000, solo: false });
    s = lyricReduce(s, { t: 'l.q', round: 1, before: '하나 ', after: ' 셋', len: 2, endsInMs: 20_000 }, 14_000);
    expect(s.view).toMatchObject({ k: 'question', round: 1, endsAt: 34_000, totalMs: 20_000, hint: null, wrong: 0, me: null });
    s = lyricReduce(s, { t: 'l.hint', first: '둘' }, 20_000);
    s = lyricReduce(s, { t: 'l.me', ok: false, gain: 0 }, 21_000);
    s = lyricReduce(s, { t: 'l.ok', uid: 'b', name: '비', gain: 130, place: 1 }, 22_000);
    s = lyricReduce(s, { t: 'l.me', ok: true, gain: 115 }, 23_000);
    expect(s.view).toMatchObject({ hint: '둘', wrong: 1, me: { ok: true, gain: 115 }, solved: [{ uid: 'b', place: 1 }] });
    s = lyricReduce(s, { t: 'l.reveal', line: '하나 둘 셋', answer: '둘', board: [{ uid: 'a', name: '에이', score: 115, gain: 115 }], nextInMs: 5000, last: false }, 24_000);
    expect(s.view).toMatchObject({ k: 'reveal', round: 1, answer: '둘', nextAt: 29_000, last: false });
    s = lyricReduce(s, { t: 'l.end', rows: [{ uid: 'a', name: '에이', score: 900, rank: 1, reward: 5, correct: 6 }], rewarded: true, rounds: 9 }, 99_000);
    expect(s.view).toMatchObject({ k: 'end', rewarded: true, rounds: 9 });
    s = lyricReduce(s, { t: 'reward', diamonds: 5, capped: false }, 99_500);
    expect(s.reward).toEqual({ diamonds: 5, capped: false });
    // 같은 방에서 다시 시작하면 보상 표시는 지워진다
    s = lyricReduce(s, { t: 'l.lobby', players, startsInMs: 12_000, solo: false }, 120_000);
    expect(s.reward).toBeNull();
  });

  it('판 기록이 오면 결과에 붙고, 새 판이 시작되면 결과용 기록은 지워지지만 최근 기록은 남는다', () => {
    let s = lyricReduce(initialLyric, { t: 'l.end', rows: [{ uid: 'a', name: '에이', score: 900, rank: 1, reward: 5, correct: 6 }], rewarded: true, rounds: 9 }, 0);
    expect(s.record).toBeNull();
    s = lyricReduce(s, { t: 'l.record', record: RECORD, best: { score: true, correct: false } }, 1);
    expect(s.record).toEqual({ record: RECORD, best: { score: true, correct: false } });
    expect(s.mine).toBe(RECORD);
    s = lyricReduce(s, { t: 'l.lobby', players, startsInMs: 12_000, solo: false }, 2);
    expect(s.record).toBeNull();
    expect(s.mine).toBe(RECORD);
  });

  it('상황에 맞지 않는 메시지는 무시하고, 거절 이유는 말로 바꾼다', () => {
    expect(lyricReduce(initialLyric, { t: 'l.hint', first: 'x' }, 0)).toBe(initialLyric);
    expect(lyricReduce(initialLyric, { t: 'l.ok', uid: 'b', name: '비', gain: 1, place: 1 }, 0)).toBe(initialLyric);
    expect(lyricReduce(initialLyric, { t: 'err', code: 'full' }, 0).error).toContain('자리가 없어요');
    expect(lyricReduce(initialLyric, { t: 'err', code: 'bad' }, 0).error).toBeNull();
    expect(lyricReduce({ ...initialLyric, view: { k: 'end', rows: [], rewarded: false, rounds: 1 } }, { t: 'left' }, 0).view).toEqual({ k: 'wait' });
  });
});

describe('가사 빈칸 속도전 화면', () => {
  const base = lyricAfter([{ t: 'hello', uid: 'a', name: '에이' }]);
  const noop = () => undefined;
  const render = (state: LyricState, now = 0) => html(createElement(LyricBoard, { state, now, onAnswer: noop, onAgain: noop, onExit: noop }));

  it('대기실: 참가자와 남은 시간, 혼자면 보상 없음 안내', () => {
    const s = lyricReduce(base, { t: 'l.lobby', players: [{ uid: 'a', name: '에이' }], startsInMs: 12_000, solo: true }, 0);
    const t = render(s, 2000);
    expect(t).toContain('대기실');
    expect(t).toContain('10초 뒤 시작');
    expect(t).toContain('에이');
    expect(t).toContain('보상은 다른 팬과 함께한 판에만');
  });

  it('문제: 빈칸 칸 수만큼 상자와 입력창, 맞히면 점수', () => {
    let s = lyricReduce(base, { t: 'l.q', round: 3, before: '하나 ', after: ' 셋', len: 3, endsInMs: 20_000 }, 0);
    let t = render(s, 5000);
    expect(t).toContain('3번째 문제');
    expect(t).not.toContain('/8');
    expect(t).toContain('15초');
    expect((t.match(/class="live-box"/g) ?? []).length).toBe(3);
    expect(t).toContain('정답 입력');
    expect(t).toContain('하나 ');
    s = lyricReduce(s, { t: 'l.hint', first: '둘' }, 0);
    expect(render(s, 5000)).toContain('>둘</i>');
    s = lyricReduce(s, { t: 'l.me', ok: true, gain: 120 }, 0);
    s = lyricReduce(s, { t: 'l.ok', uid: 'a', name: '에이', gain: 120, place: 1 }, 0);
    t = render(s, 6000);
    expect(t).toContain('정답! +120점');
    expect(t).toContain('1번째 · 에이');
    expect(t).toContain('disabled');
  });

  it('공개와 결과: 정답을 표시하고 순위·보상 안내를 보여 준다', () => {
    let s = lyricReduce(base, { t: 'l.q', round: 1, before: '하나 ', after: ' 셋', len: 1, endsInMs: 20_000 }, 0);
    s = lyricReduce(s, { t: 'l.reveal', line: '하나 둘 셋', answer: '둘', board: [{ uid: 'a', name: '에이', score: 130, gain: 130 }], nextInMs: 5000, last: false }, 0);
    const rev = render(s, 1000);
    expect(rev).toContain('<mark class="live-answer">둘</mark>');
    expect(rev).toContain('4초 뒤 다음');
    expect(rev).not.toContain('여기서 끝나요');
    const lastRev = lyricReduce(s, { t: 'l.reveal', line: '하나 둘 셋', answer: '둘', board: [{ uid: 'a', name: '에이', score: 130, gain: 0 }], nextInMs: 5000, last: true }, 0);
    expect(render(lastRev, 1000)).toContain('4초 뒤 결과');
    expect(render(lastRev, 1000)).toContain('아무도 못 맞혀서 여기서 끝나요');
    const end = lyricReduce(s, { t: 'l.end', rows: [{ uid: 'a', name: '에이', score: 900, rank: 1, reward: 5, correct: 6 }, { uid: 'b', name: '비', score: 100, rank: 2, reward: 0, correct: 1 }], rewarded: true, rounds: 7 }, 0);
    expect(render(end)).toContain('7문제까지 이어졌어요');
    expect(render(end)).toContain('보상 💎5을 우편함으로 보내는 중');
    expect(render(lyricReduce(end, { t: 'reward', diamonds: 5, capped: false }, 0))).toContain('보상 💎5을 우편함으로 보냈어요');
    expect(render(lyricReduce(end, { t: 'reward', diamonds: 0, capped: true }, 0))).toContain('오늘 라이브 보상 한도');
    expect(render(lyricReduce(end, { t: 'reward', diamonds: 3, capped: true }, 0))).toContain('오늘 한도까지만');
    const solo = lyricReduce(s, { t: 'l.end', rows: [{ uid: 'a', name: '에이', score: 900, rank: 1, reward: 0, correct: 2 }], rewarded: false, rounds: 2 }, 0);
    expect(render(solo)).toContain('혼자 시작한 판은 보상이 없어요');
    expect(render(end)).toContain('한 판 더');
  });
});

describe('가사 빈칸 속도전 내 기록 화면', () => {
  it('한 줄 요약은 한 판이라도 했을 때만 보인다', () => {
    expect(html(createElement(RecordLine, { record: null }))).toBe('');
    expect(html(createElement(RecordLine, { record: { ...RECORD, games: 0 } }))).toBe('');
    const t = html(createElement(RecordLine, { record: RECORD }));
    expect(t).toContain('내 기록');
    expect(t).toContain('12판');
    expect(t).toContain('1위 3번');
    expect(t).toContain('최고 1.28K점');
  });

  it('기록 카드: 누적·최고와 최근 판(최신이 위), 새 기록 표시', () => {
    const t = html(createElement(RecordCard, { record: RECORD, best: { score: true, correct: false } }));
    expect(t).toContain('새 기록!');
    expect(t).toContain('12판');
    expect(t).toContain('3번');
    expect(t).toContain('/ 9판');
    expect(t).toContain('1.28K점 🎉');
    expect(t).not.toContain('8문제 🎉');
    expect(t).toContain('41문제');
    expect(t).toContain('최근 2판');
    expect(t).toContain('혼자 연습');
    expect(t).toContain('3명 중 2위');
    expect(t.indexOf('혼자 연습')).toBeLessThan(t.indexOf('3명 중 2위')); // 최근 판이 위
    expect(t).toContain('도중에 나가면 그 판은 남지 않고');
    expect(html(createElement(RecordCard, { record: RECORD, best: { score: false, correct: false } }))).not.toContain('새 기록!');
    expect(html(createElement(RecordCard, { record: { ...RECORD, recent: [] }, best: { score: false, correct: true } }))).not.toContain('최근');
  });

  it('결과 화면에는 이 판이 쌓인 기록이 오면 붙고, 오기 전에는 붙지 않는다. 대기실에는 최근 기록이 한 줄로 보인다', () => {
    const base = lyricAfter([{ t: 'hello', uid: 'a', name: '에이' }]);
    const noop = () => undefined;
    const render = (state: LyricState, record?: LyricRecord | null) => html(createElement(LyricBoard, { state, now: 0, onAnswer: noop, onAgain: noop, onExit: noop, record }));
    const end = lyricReduce(base, { t: 'l.end', rows: [{ uid: 'a', name: '에이', score: 900, rank: 1, reward: 5, correct: 6 }], rewarded: true, rounds: 9 }, 0);
    expect(render(end)).toContain('내가 맞힌 문제는 6개예요');
    expect(render(end, RECORD)).not.toContain('내 기록'); // 목록에서 가져온 옛 기록은 결과에 붙이지 않는다(방금 판이 빠져 있다)
    const withRecord = lyricReduce(end, { t: 'l.record', record: RECORD, best: { score: false, correct: true } }, 0);
    expect(render(withRecord)).toContain('내 기록');
    expect(render(withRecord)).toContain('8문제 🎉');
    const lobby = lyricReduce(base, { t: 'l.lobby', players: [{ uid: 'a', name: '에이' }], startsInMs: 12_000, solo: false }, 0);
    expect(render(lobby)).not.toContain('내 기록');
    expect(render(lobby, RECORD)).toContain('12판');
    // 이번 화면에서 더 최근 기록을 알게 됐으면 그것이 우선한다
    expect(render({ ...lobby, mine: { ...RECORD, games: 13 } }, RECORD)).toContain('13판');
  });
});

const snap = (x: number, fans = 3): FandomSnapshot => ({
  t: 'f.s',
  left: 170_000,
  me: { x, y: 600, fans, boost: 0, shield: 0 },
  sn: [
    [1, fans, 0, x, 600, x - 10, 600, x - 20, 600],
    [2, 5, 1, 300, 300, 310, 300],
  ],
  dots: [100, 100, 1, 200, 200, 2],
  lb: [
    [2, 5],
    [1, fans],
  ],
  rk: [2, 8],
});

describe('팬덤 모으기 상태와 화면 변환', () => {
  it('스냅샷을 칸 단위 좌표로 바꾼다', () => {
    const v = toView(snap(600));
    expect(v.me).toEqual({ x: 60, y: 60, fans: 3, boost: false, shield: false });
    expect(v.snakes[0].pts).toEqual([
      [60, 60],
      [59, 60],
      [58, 60],
    ]);
    expect(v.snakes[1]).toMatchObject({ id: 2, shield: true });
    expect(v.dots).toEqual([
      [10, 10, 1],
      [20, 20, 2],
    ]);
  });

  it('앞뒤 스냅샷 사이를 이어 주고, 범위 밖이면 가까운 쪽을 쓴다', () => {
    const a = toView(snap(600));
    const b = toView(snap(700));
    const mid = lerpView(a, b, 0.5);
    expect(mid.me.x).toBeCloseTo(65, 5);
    expect(mid.snakes[0].pts[0][0]).toBeCloseTo(65, 5);
    const timed = [
      { at: 1000, view: a },
      { at: 1100, view: b },
    ];
    expect(viewAt([], 0)).toBeNull();
    expect(viewAt(timed, 500)).toBe(a);
    expect(viewAt(timed, 2000)).toBe(b);
    expect(viewAt(timed, 1050)?.me.x).toBeCloseTo(65, 5);
    // 새로 보이는 뱀은 그대로, 줄어든 몸 길이도 터지지 않는다
    const shorter: FandomViewData = { ...b, snakes: [{ id: 9, fans: 1, shield: false, pts: [[1, 1]] }, { ...b.snakes[0], pts: b.snakes[0].pts.slice(0, 2) }] };
    expect(lerpView(a, shorter, 0.5).snakes).toHaveLength(2);
  });

  it('들어가고 플레이하고 쓰러지고 보상을 받는 순서로 바뀐다', () => {
    let s = fandomReduce(initialFandom, { t: 'f.go', id: 4, w: 120, h: 120, runMs: 180_000 });
    expect(s).toMatchObject({ phase: 'play', myId: 4 });
    s = fandomReduce(s, { t: 'f.roster', list: [{ id: 4, name: '에이', bot: false }, { id: 2, name: '별빛 팬클럽', bot: true }] });
    expect(s.names[2]).toBe('별빛 팬클럽');
    s = fandomReduce(s, snap(600, 12));
    expect(s.hud).toMatchObject({ fans: 12, rank: 2, alive: 8, leftMs: 170_000, boost: false });
    s = fandomReduce(s, { t: 'f.over', why: 'dead', fans: 12, peak: 40, kills: 1, by: '별빛 팬클럽', reward: 1 });
    expect(s).toMatchObject({ phase: 'over', over: { peak: 40, by: '별빛 팬클럽' } });
    // 쓰러진 뒤에 늦게 온 스냅샷은 화면을 되돌리지 않는다
    expect(fandomReduce(s, snap(700, 99)).phase).toBe('over');
    s = fandomReduce(s, { t: 'reward', diamonds: 1, capped: false });
    expect(s.reward).toEqual({ diamonds: 1, capped: false });
    // 다시 하면 결과·보상이 지워진다
    s = fandomReduce(s, { t: 'f.go', id: 5, w: 120, h: 120, runMs: 180_000 });
    expect(s).toMatchObject({ phase: 'play', over: null, reward: null });
    expect(fandomReduce(initialFandom, { t: 'err', code: 'full' }).error).toContain('자리가 없어요');
  });
});

/** 그리기 호출을 세는 가짜 2D 컨텍스트: 없는 메서드를 부르거나 유한하지 않은 값을 쓰면 터진다. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Record<string, number>; texts: string[] } {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls[prop] = (calls[prop] ?? 0) + 1;
        if (prop === 'fillText') texts.push(String(args[0]));
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${prop}에 유한하지 않은 값이 들어갔어요`);
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, texts };
}

describe('팬덤 모으기 그리기', () => {
  it('세계·점·뱀과 이름표를 그리고, 방패 중이면 깜빡인다', () => {
    const v = toView(snap(600));
    for (const time of [0, 130]) {
      const f = fakeCtx();
      drawFandom(f.ctx, v, { w: 120, h: 120, myId: 1, names: { 1: '에이', 2: '별빛 팬클럽' }, time });
      expect(f.calls.fillRect).toBe(2);
      expect(f.calls.arc).toBeGreaterThanOrEqual(v.dots.length + v.snakes.reduce((n, s) => n + s.pts.length, 0));
      expect(f.texts).toEqual(['나 3', '별빛 팬클럽 5']);
    }
    const empty = fakeCtx();
    drawFandom(empty.ctx, { me: { x: 0, y: 0, fans: 0, boost: false, shield: false }, snakes: [], dots: [] }, { w: 120, h: 120, myId: 1, names: {}, time: 0 });
    expect(empty.calls.fillRect).toBe(2);
  });
});

describe('라이브 대전 화면', () => {
  it('목록에 두 게임이 보이고 입장 버튼이 있다', () => {
    const t = html(createElement(LiveScreen));
    expect(t).toContain('라이브 대전');
    expect(t).toContain('가사 빈칸 속도전');
    expect(t).toContain('팬덤 모으기');
    expect((t.match(/입장하기/g) ?? []).length).toBe(2);
  });
});

describe('보상 안내 문구가 서버 규칙과 같다', () => {
  it('가사 빈칸 속도전 보상과 하루 한도', () => {
    for (const n of QUIZ.rewards) expect(QUIZ_REWARD_TEXT).toContain(`💎${n}`);
    expect(QUIZ_REWARD_TEXT).toContain(`💎${QUIZ.participation}`);
    expect(QUIZ_REWARD_TEXT).toContain(`하루 💎${LIVE_DAILY_CAP}`);
    expect(FANDOM_REWARD_TEXT).toContain(`하루 💎${LIVE_DAILY_CAP}`);
  });

  it('팬덤 모으기 보상 구간', () => {
    for (const [fans, diamonds] of FANDOM.rewardTiers) {
      expect(FANDOM_REWARD_TEXT).toContain(`${fans}명`);
      expect(FANDOM_REWARD_TEXT).toContain(`💎${diamonds}`);
    }
    expect(FANDOM_FIRST_TIER).toBe(FANDOM.rewardTiers[0][0]);
  });
});
