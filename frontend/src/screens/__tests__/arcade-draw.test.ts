import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../game/balance';
import { GateGame } from '../../game/gate';
import { HoleGame } from '../../game/hole';
import { PlinkoGame } from '../../game/plinko';
import { SlashGame } from '../../game/slash';
import { drawGate } from '../arcade/GateStage';
import { drawHoleField } from '../arcade/HoleStage';
import { drawPlinko } from '../arcade/PlinkoStage';
import { drawSlash } from '../arcade/SlashStage';

/** 그리기 호출을 세는 가짜 2D 컨텍스트: 없는 메서드를 부르거나 값을 잘못 쓰면 그리기 코드가 바로 터진다. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Record<string, number>; texts: string[]; textFills: unknown[] } {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  /** 글자(이모지)를 그리는 순간의 fillStyle: 사파리는 그라데이션·패턴이면 이모지를 배경색 실루엣으로 그려서 안 보이게 된다 */
  const textFills: unknown[] = [];
  const gradient = { addColorStop: () => undefined };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient') return () => gradient;
      return (...args: unknown[]) => {
        calls[prop] = (calls[prop] ?? 0) + 1;
        if (prop === 'fillText') {
          texts.push(String(args[0]));
          textFills.push(state.fillStyle);
        }
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${prop}에 유한하지 않은 값이 들어갔어요`);
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, texts, textFills };
}

/** 글자를 그릴 때 fillStyle이 그라데이션이 아니라 색 문자열이어야 한다 */
const plainTextFills = (f: { textFills: unknown[] }): boolean => f.textFills.every((s) => typeof s === 'string');

describe('아케이드 캔버스 그리기(가짜 컨텍스트로 터지지 않는지)', () => {
  it('악플 베기: 날아다니는 말풍선·베어진 조각·칼자국을 그린다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const g = new SlashGame(persona, 5, 0.2);
      const f = fakeCtx();
      for (let i = 0; i < 300; i++) {
        g.advance(BALANCE.slash.stepMs);
        for (const it of g.items) if (!it.cut && it.y < 100 && i % 7 === 0) g.slash(it.x - 8, it.y, it.x + 8, it.y);
      }
      // 그릴 말풍선이 확실히 있게: 멀쩡한 것 하나와 막 베어진 것 하나
      g.items.push({ id: 991, kind: 'troll', x: 30, y: 60, vx: 0, vy: 0, r: 5.5, cut: false, cutAt: -1 }, { id: 992, kind: 'heart', x: 70, y: 60, vx: 0, vy: 0, r: 5.5, cut: true, cutAt: g.timeMs - 100 });
      drawSlash(f.ctx, g, [{ x: 10, y: 20, t: 0 }, { x: 30, y: 40, t: 50 }, { x: 60, y: 50, t: 100 }], 120);
      expect(f.calls.fillRect).toBe(1);
      expect(f.calls.fillText).toBeGreaterThan(0);
      expect(f.calls.stroke).toBeGreaterThan(0);
      expect(plainTextFills(f)).toBe(true);
    }
  });

  it('블랙홀 먹기: 소품·라이벌·내 구멍을 그리고 되살아난 직후 깜빡인다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const g = new HoleGame(persona, 5, 0.2);
      const f = fakeCtx();
      for (let i = 0; i < 600; i++) g.advance(BALANCE.hole.stepMs, { x: Math.sin(i / 40), y: Math.cos(i / 40) });
      g.me.invUntil = g.timeMs + 1000;
      drawHoleField(f.ctx, g);
      expect(f.calls.arc).toBeGreaterThanOrEqual(g.props.length + g.rivals.length + 1);
      expect(f.calls.fillRect).toBe(1);
    }
  });

  it('게이트 행진: 달리는 동안·끝난 뒤의 길과 군중과 괴수를 그린다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const g = new GateGame(persona, 5, 0.2);
      for (let i = 0; i < 4000 && g.status === 'running'; i++) {
        const f = fakeCtx();
        g.advance(BALANCE.gate.stepMs, { targetX: i % 90 < 45 ? 25 : 75 });
        if (i % 20 === 0) {
          drawGate(f.ctx, g);
          expect(f.calls.fillRect).toBeGreaterThanOrEqual(1);
          expect(plainTextFills(f)).toBe(true);
        }
      }
      const last = fakeCtx();
      drawGate(last.ctx, g);
      expect(last.texts.length).toBeGreaterThan(0);
      expect(plainTextFills(last)).toBe(true);
    }
  });

  it('음표 플링코: 핀·조준선·구슬·떠오르는 데미지를 그리고 유물이 있으면 바닥 칸이 넓어진다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const g = new PlinkoGame(persona, 5, 0.2);
      g.relics.bin = 1;
      const aim = g.preview(0.3);
      const a = fakeCtx();
      drawPlinko(a.ctx, g, aim);
      expect(a.calls.arc).toBeGreaterThan(g.pegs.length);
      expect(plainTextFills(a)).toBe(true);
      g.fire(0.3);
      for (let i = 0; i < 40; i++) {
        g.advance(50);
        const f = fakeCtx();
        drawPlinko(f.ctx, g, null);
        expect(f.calls.fillRect).toBeGreaterThanOrEqual(4);
      }
      expect(g.popups.length).toBeGreaterThanOrEqual(0);
    }
  });
});
