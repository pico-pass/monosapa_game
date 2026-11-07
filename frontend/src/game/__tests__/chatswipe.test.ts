import { afterEach, describe, expect, it } from 'vitest';
import { closeTempOpenStages, reopenTempOpenStages } from './tempOpen';
import { BALANCE, manualGameOf } from '../balance';
import { ChatSwipeGame, RULE_TEXT, makeMessage, rulesOf, type ChatMsg, type RuleId, type SwipeEvent } from '../chatswipe';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';
import { mulberry32 } from '../runner';

const B = BALANCE.swipe;
const T0 = 1_700_000_000_000;
const evs = (g: ChatSwipeGame, type: SwipeEvent['type']) => g.events.filter((e) => e.type === type);

/** 규칙에서 글이 막혀야 하는지 직접 계산한다(엔진이 정한 block과 맞는지 확인용) */
function violates(m: ChatMsg, rules: readonly RuleId[]): RuleId | null {
  if (rules.includes('toxic') && m.tone === 'hate') return 'toxic';
  if (rules.includes('link') && m.link) return 'link';
  if (rules.includes('small') && m.amount > 0 && m.amount < B.minDonation) return 'small';
  if (rules.includes('fake') && m.badge === 'fake') return 'fake';
  return null;
}

/** 다음 글이 나올 때까지 시간을 보낸다 */
function nextMsg(g: ChatSwipeGame): ChatMsg {
  let guard = 0;
  while (!g.msg && !g.over && guard++ < 400) g.advance(50);
  if (!g.msg) throw new Error('no message');
  return g.msg;
}

afterEach(reopenTempOpenStages);

describe('후원 채팅 스와이프: 글 만들기', () => {
  it('곡마다 규칙이 하나씩 늘어난다', () => {
    expect(rulesOf(0)).toEqual(['toxic']);
    expect(rulesOf(1)).toEqual(['toxic', 'link']);
    expect(rulesOf(2)).toEqual(['toxic', 'link', 'small']);
    expect(rulesOf(3)).toEqual(['toxic', 'link', 'small', 'fake']);
    for (const r of rulesOf(3)) expect(RULE_TEXT[r].length).toBeGreaterThan(0);
  });

  it('block은 지금 규칙을 어기는지와 항상 일치하고 이유(why)가 맞다', () => {
    for (let w = 0; w < 4; w++) {
      const rules = rulesOf(w);
      const rng = mulberry32(100 + w);
      for (let i = 0; i < 400; i++) {
        const m = makeMessage(rng, i, rules);
        const v = violates(m, rules);
        expect(m.block).toBe(v !== null);
        expect(m.why).toBe(v);
      }
    }
  });

  it('규칙을 어기는 글은 대략 badRate만큼 나온다', () => {
    const rng = mulberry32(7);
    let blocked = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) if (makeMessage(rng, i, rulesOf(3)).block) blocked++;
    expect(blocked / n).toBeGreaterThan(B.badRate - 0.06);
    expect(blocked / n).toBeLessThan(B.badRate + 0.06);
  });

  it('아직 적용되지 않은 규칙의 특징은 멀쩡한 글에 섞여 나온다(받아야 한다)', () => {
    const rng = mulberry32(9);
    let link = 0;
    let small = 0;
    let fake = 0;
    for (let i = 0; i < 1500; i++) {
      const m = makeMessage(rng, i, rulesOf(0));
      if (m.block) continue;
      if (m.link) link++;
      if (m.amount > 0 && m.amount < B.minDonation) small++;
      if (m.badge === 'fake') fake++;
    }
    expect(link).toBeGreaterThan(20);
    expect(small).toBeGreaterThan(20);
    expect(fake).toBeGreaterThan(20);
  });

  it('규칙이 적용된 곡에서는 그 특징이 멀쩡한 글에 섞이지 않는다', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 1500; i++) {
      const m = makeMessage(rng, i, rulesOf(3));
      if (m.block) continue;
      expect(m.link).toBe(false);
      expect(m.badge).not.toBe('fake');
      expect(m.tone).toBe('cheer');
      if (m.amount > 0) expect(m.amount).toBeGreaterThanOrEqual(B.minDonation);
    }
  });

  it('같은 씨앗이면 같은 글이 같은 순서로 나온다', () => {
    const run = (seed: number) => {
      const g = new ChatSwipeGame('dark', seed);
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        const m = nextMsg(g);
        out.push(`${m.nick}|${m.text}|${m.block}`);
        g.answer(!m.block);
      }
      return out;
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
});

describe('후원 채팅 스와이프: 진행과 점수', () => {
  it('시작하고 introMs 뒤에 첫 글이 나온다', () => {
    const g = new ChatSwipeGame('dark', 1);
    expect(g.msg).toBeNull();
    g.advance(B.introMs - 10);
    expect(g.msg).toBeNull();
    g.advance(20);
    expect(g.msg).not.toBeNull();
    expect(g.leftMs).toBeCloseTo(B.limitMs[0] - 10, 5);
    expect(evs(g, 'msg')).toHaveLength(1);
  });

  it('맞게 넘기면 열기가 오르고 콤보가 쌓이며, 글 사이에는 gapMs 쉰다', () => {
    const g = new ChatSwipeGame('dark', 1);
    const m = nextMsg(g);
    expect(g.answer(!m.block)).toBe(true);
    expect(g.heat[0]).toBeCloseTo(B.heat.right, 5);
    expect(g.combo).toBe(1);
    expect(g.msg).toBeNull();
    expect(g.gapLeftMs).toBe(B.gapMs);
    const m2 = nextMsg(g);
    g.answer(!m2.block);
    expect(g.heat[0]).toBeCloseTo(B.heat.right * 2 + B.heat.combo, 5);
    expect(g.combo).toBe(2);
    expect(g.right).toBe(2);
  });

  it('틀리면 열기가 깎이고 콤보가 끊기며 0 아래로는 안 내려간다', () => {
    const g = new ChatSwipeGame('dark', 1);
    const m = nextMsg(g);
    g.answer(m.block);
    expect(g.wrong).toBe(1);
    expect(g.heat[0]).toBe(0);
    expect(g.combo).toBe(0);
    const w = evs(g, 'wrong')[0] as Extract<SwipeEvent, { type: 'wrong' }>;
    expect(w.why).toBe(m.why);
    const m2 = nextMsg(g);
    g.answer(!m2.block);
    const m3 = nextMsg(g);
    g.answer(!m3.block);
    const before = g.heat[0];
    const m4 = nextMsg(g);
    g.answer(m4.block);
    expect(g.heat[0]).toBeCloseTo(Math.max(0, before - B.heat.wrong), 5);
  });

  it('제한 시간 안에 못 넘기면 놓친 것(timeout)이다', () => {
    const g = new ChatSwipeGame('dark', 1);
    nextMsg(g);
    g.advance(B.limitMs[0] + 5);
    expect(g.timeouts).toBe(1);
    expect(g.msg).toBeNull();
    expect(evs(g, 'timeout')).toHaveLength(1);
    expect(g.combo).toBe(0);
  });

  it('글이 없을 때 넘기면 아무 일도 없다', () => {
    const g = new ChatSwipeGame('dark', 1);
    expect(g.answer(true)).toBe(false);
    expect(g.handled).toBe(0);
  });

  it('곡이 끝나면 다음 곡으로 가서 규칙이 늘고 제한 시간이 줄어든다', () => {
    const g = new ChatSwipeGame('dark', 1);
    g.advance(B.waves[0].ms + 50);
    expect(g.waveIdx).toBe(1);
    expect(g.rules).toEqual(rulesOf(1));
    expect(g.limitMs).toBe(B.limitMs[1]);
    expect(g.msg).toBeNull();
    expect(evs(g, 'waveEnd')).toHaveLength(1);
    expect(evs(g, 'wave')).toHaveLength(1);
    expect(g.ratios).toHaveLength(1);
  });

  it('다 맞히는 봇은 클리어하고, 가만히 있으면 0점이다', () => {
    const g = new ChatSwipeGame('dark', 4);
    while (!g.over) {
      g.advance(20);
      if (g.msg) g.answer(!g.msg.block);
    }
    expect(g.cleared).toBe(true);
    expect(g.score).toBeGreaterThanOrEqual(900);
    expect(g.summary.wrong).toBe(0);

    const idle = new ChatSwipeGame('dark', 4);
    idle.advance(B.waves.length * B.waves[0].ms + 10);
    expect(idle.over).toBe(true);
    expect(idle.score).toBe(0);
    expect(idle.timeouts).toBeGreaterThan(10);
  });

  it('전부 수락만 하면 클리어하지 못한다', () => {
    const g = new ChatSwipeGame('dark', 4);
    while (!g.over) {
      g.advance(20);
      if (g.msg) g.answer(true);
    }
    expect(g.cleared).toBe(false);
  });

  it('큰 시간 걸음으로도 곡을 건너뛰지 않는다', () => {
    const g = new ChatSwipeGame('dark', 2);
    g.advance(B.waves[0].ms * 2 + 100);
    expect(g.waveIdx).toBe(2);
    expect(g.ratios).toHaveLength(2);
  });

  it('요약에는 곡별 달성률(%)과 수락/차단 횟수가 들어간다', () => {
    const g = new ChatSwipeGame('dark', 4);
    const a = nextMsg(g);
    g.answer(!a.block);
    const b = nextMsg(g);
    g.answer(!b.block);
    const s = g.summary;
    expect(s.handled).toBe(2);
    expect(s.accepted + s.blocked).toBe(2);
    expect(s.waves).toHaveLength(4);
    expect(s.bestCombo).toBe(2);
  });
});

describe('후원 채팅 스와이프: 공연장 연결', () => {
  it('다크웹 라이브공연(ruins)이 이 게임이다', () => {
    expect(manualGameOf('ruins')).toBe('swipe');
  });

  it('어둠속성이 폐건물 지하공연을 클리어하고 팬 250만이면 시작할 수 있다', () => {
    closeTempOpenStages(); // 임시 개방과 상관없이 원래 조건을 본다
    const s = createInitialState(T0);
    const done = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    const open = { ...s, fans: 2_500_000, activePersona: 'dark' as const, concerts: { ...s.concerts, universe: done, rooftop: done } };
    const r = beginManualConcert(open, 'ruins', 's1');
    expect(r.ok && r.run.game).toBe('swipe');
    const early = beginManualConcert({ ...open, concerts: { ...open.concerts, rooftop: { ...done, cleared: false } } }, 'ruins', 's2');
    expect(!early.ok && early.reason).toBe('locked');
    const poor = beginManualConcert({ ...open, fans: 2_499_999 }, 'ruins', 's3');
    expect(!poor.ok && poor.reason).toBe('locked');
  });

  it('보상은 어둠 ×2이고 첫 클리어 코인·다이아가 붙는다', () => {
    expect(manualConcertReward(200_000, 1000, 'dark', 'swipe')).toBe(200_000 * 2 * 2);
    const s = createInitialState(T0);
    const done = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    const open = { ...s, fans: 2_500_000, activePersona: 'dark' as const, concerts: { ...s.concerts, universe: done, rooftop: done } };
    const begin = beginManualConcert(open, 'ruins', 's1');
    if (!begin.ok) throw new Error('begin failed');
    const fin = finishManualConcert(begin.state, begin.run, 800);
    expect(fin.ok && fin.outcome).toMatchObject({ cleared: true, firstClear: true, diamonds: 300, firstClearCoins: 4_000_000 });
  });
});
