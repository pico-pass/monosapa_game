import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { mulberry32 } from '../runner';
import { SlashGame, distToSegment, type Item } from '../slash';

const S = BALANCE.slash;
const FRAME = S.stepMs;

const item = (kind: Item['kind'], x: number, y: number, over: Partial<Item> = {}): Item => ({ id: 900 + Math.floor(x), kind, x, y, vx: 0, vy: 0, r: 5.5, cut: false, cutAt: -1, ...over });

/** 눈에 띄는 말풍선을 놓치지 않고 베는 봇. skill은 악플을 베려고 시도할 확률, mistake는 하트를 잘못 벨 확률 */
function play(persona: 'normal' | 'dark', seed: number, skill: number, mistake = 0, power = 0): SlashGame {
  const g = new SlashGame(persona, seed, power);
  const r = mulberry32(seed ^ 0xabc);
  const decided = new Map<number, boolean>();
  for (let i = 0; i < 60 * 80 && g.status === 'running'; i++) {
    g.advance(FRAME);
    for (const it of g.items) {
      if (it.cut || it.y < 10 || it.y > 100 || it.vy < -30) continue;
      if (!decided.has(it.id)) decided.set(it.id, it.kind === 'heart' ? r() < mistake : r() < skill);
      if (decided.get(it.id)) g.slash(it.x - 7, it.y, it.x + 7, it.y);
    }
  }
  return g;
}

describe('악플 베기: 기본 규칙', () => {
  it('선분과 점 사이 거리', () => {
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5); // 끝점 밖은 끝점까지
    expect(distToSegment(3, 4, 2, 2, 2, 2)).toBeCloseTo(Math.hypot(1, 2)); // 길이 0인 선분
  });

  it('같은 씨앗·같은 그음이면 같은 판이고, 씨앗이 다르면 다르다', () => {
    const a = play('normal', 7, 0.8, 0.05);
    const b = play('normal', 7, 0.8, 0.05);
    expect([a.score(), a.cuts, a.misses, a.timeMs]).toEqual([b.score(), b.cuts, b.misses, b.timeMs]);
    expect(play('normal', 8, 0.8, 0.05).cuts).not.toBe(a.cuts);
  });

  it('가만히 있으면 놓친 악플로 체력이 닳아 끝나고 0점이다', () => {
    const g = new SlashGame('normal', 3);
    for (let i = 0; i < 60 * 60 && g.status === 'running'; i++) g.advance(FRAME);
    expect(g.status).toBe('dead');
    expect(g.hp).toBe(0);
    expect(g.misses).toBeGreaterThanOrEqual(S.hp);
    expect(g.score()).toBe(0);
  });

  it('큰 dt를 한꺼번에 넣어도 단계로 쪼개 같은 결과가 난다', () => {
    const a = new SlashGame('normal', 11);
    const b = new SlashGame('normal', 11);
    for (let i = 0; i < 100; i++) a.advance(FRAME);
    b.advance(FRAME * 100 + 1);
    expect(b.timeMs).toBeCloseTo(a.timeMs, 5);
    expect(b.items.map((i) => [i.id, i.kind, Math.round(i.y * 1000)])).toEqual(a.items.map((i) => [i.id, i.kind, Math.round(i.y * 1000)]));
  });
});

describe('악플 베기: 베기·콤보·하트', () => {
  it('악플을 베면 포인트가 오르고 콤보가 이어지며, 시간이 지나면 콤보가 새로 시작한다', () => {
    const g = new SlashGame('normal', 1);
    g.items = [item('troll', 20, 50), item('troll', 60, 50)];
    expect(g.slash(0, 50, 30, 50)).toBe(1);
    expect(g.cuts).toBe(1);
    expect(g.combo).toBe(1);
    expect(g.pts).toBe(1);
    g.slash(50, 50, 70, 50);
    expect(g.combo).toBe(2);
    expect(g.bestCombo).toBe(2);
    g.items.push(item('troll', 40, 50));
    for (let t = 0; t < S.comboGapMs + 100; t += FRAME) g.advance(FRAME);
    g.items = [item('troll', 40, 50)];
    g.slash(30, 50, 50, 50);
    expect(g.combo).toBe(1);
    expect(g.bestCombo).toBe(2);
  });

  it('콤보 단계마다 포인트 보너스, 큰 악플은 3점, 한 번에 여럿이면 덤', () => {
    const g = new SlashGame('normal', 1);
    g.items = [item('big', 20, 50, { r: 8 })];
    g.slash(10, 50, 30, 50);
    expect(g.pts).toBe(3);
    const h = new SlashGame('normal', 1);
    h.items = [item('troll', 20, 50), item('troll', 28, 50), item('troll', 36, 50)];
    expect(h.slash(0, 50, 60, 50)).toBe(3);
    expect(h.pts).toBeGreaterThanOrEqual(3 + 2 * S.multiBonus);
  });

  it('하트를 베면 체력이 깎이고 콤보가 끊기며, 베지 않고 떨어뜨리면 아무 일도 없다', () => {
    const g = new SlashGame('normal', 1);
    g.items = [item('troll', 20, 50), item('heart', 60, 50)];
    g.slash(10, 50, 30, 50);
    expect(g.combo).toBe(1);
    g.slash(50, 50, 70, 50);
    expect(g.heartsCut).toBe(1);
    expect(g.combo).toBe(0);
    expect(g.hp).toBe(S.hp - S.heartCost);
    expect(g.cuts).toBe(1);
    const h = new SlashGame('normal', 1);
    h.items = [item('heart', 50, S.h + 7, { vy: 30 })];
    h.advance(FRAME * 4);
    expect(h.hp).toBe(S.hp);
    expect(h.items.some((i) => i.kind === 'heart')).toBe(false);
  });

  it('놓친 악플은 체력 1을 깎고 콤보를 끊는다', () => {
    const g = new SlashGame('normal', 1);
    g.items = [item('troll', 20, 50), item('troll', 50, S.h + 7, { vy: 30 })];
    g.slash(10, 50, 30, 50);
    g.advance(FRAME * 4);
    expect(g.misses).toBe(1);
    expect(g.hp).toBe(S.hp - 1);
    expect(g.combo).toBe(0);
  });

  it('칼날에서 먼 말풍선은 베지 못하고, 전투력 보너스가 칼날을 넓힌다', () => {
    const near = new SlashGame('normal', 1);
    near.items = [item('troll', 50, 50)];
    // 말풍선 가장자리에서 칼날 반지름의 1.2배 떨어진 선: 기본 칼날은 못 닿고 +50% 칼날은 닿는다
    const gap = 5.5 + S.bladeR * 1.2;
    expect(near.slash(0, 50 + gap, 100, 50 + gap)).toBe(0);
    const strong = new SlashGame('normal', 1, 1);
    strong.items = [item('troll', 50, 50)];
    expect(strong.slash(0, 50 + gap, 100, 50 + gap)).toBe(1);
  });

  it('끝난 판에서는 더 벨 수 없다', () => {
    const g = new SlashGame('normal', 3);
    for (let i = 0; i < 60 * 60 && g.status === 'running'; i++) g.advance(FRAME);
    g.items = [item('troll', 50, 50)];
    expect(g.slash(0, 50, 100, 50)).toBe(0);
  });
});

describe('악플 베기: 어둠 자아와 점수', () => {
  it('어둠에서는 벤 악플이 조각 둘로 쪼개지고, 조각을 놓쳐도 아프지 않다', () => {
    const g = new SlashGame('dark', 1);
    g.items = [item('troll', 50, 50)];
    g.slash(40, 50, 60, 50);
    const shards = g.items.filter((i) => i.kind === 'shard');
    expect(shards).toHaveLength(2);
    expect(shards[0].vx * shards[1].vx).toBeLessThan(0);
    g.items = [item('shard', 50, S.h + 7, { vy: 30, r: 3.4 })];
    g.advance(FRAME * 4);
    expect(g.hp).toBe(S.darkHp);
    expect(g.misses).toBe(0);
    const n = new SlashGame('normal', 1);
    n.items = [item('troll', 50, 50)];
    n.slash(40, 50, 60, 50);
    expect(n.items.filter((i) => i.kind === 'shard')).toHaveLength(0);
    expect(new SlashGame('dark', 1).maxHp).toBeLessThan(new SlashGame('normal', 1).maxHp);
  });

  it('점수는 0~1000이고 잘 벨수록 높다', () => {
    const perfect = play('normal', 5, 1).score();
    const decent = play('normal', 5, 0.9, 0.03).score();
    const clumsy = play('normal', 5, 0.5, 0.1).score();
    for (const s of [perfect, decent, clumsy]) expect(s).toBeGreaterThanOrEqual(0);
    for (const s of [perfect, decent, clumsy]) expect(s).toBeLessThanOrEqual(1000);
    expect(perfect).toBeGreaterThanOrEqual(850);
    expect(perfect).toBeGreaterThan(clumsy);
    expect(decent).toBeGreaterThan(clumsy);
  });

  it('끝까지 버티면 이긴 것으로 끝난다', () => {
    const g = play('normal', 9, 1);
    expect(g.status).toBe('won');
    expect(g.timeMs).toBeGreaterThanOrEqual(S.durationMs);
  });
});
