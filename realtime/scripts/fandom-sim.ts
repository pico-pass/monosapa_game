/*
 * 팬덤 모으기 보상 구간(FANDOM.rewardTiers)을 정하려고 돌리는 시뮬레이션: 사람 한 명 자리에 서로 다른 솜씨의 봇을 넣어
 * 한 번의 도전(최대 3분)에서 가장 많았던 팬 수(peak)와 쓰러진 비율을 본다.   npm run sim:fandom -w realtime
 */
import { mulberry32 } from '../src/rng.js';
import { FANDOM, FandomWorld, fandomReward, type RunResult } from '../src/fandom/world.js';

type Skill = 'greedy' | 'careless' | 'wander' | 'still';

function play(seed: number, skill: Skill): RunResult {
  let result: RunResult | null = null;
  const world = new FandomWorld('sim', mulberry32(seed), { over: (_u, r) => (result = r), roster: () => undefined });
  world.join('p', 'P');
  const me = [...world.snakes.values()].find((s) => !s.bot)!;
  const rng = mulberry32(seed * 7919);
  let t = 0;
  world.advance(0);
  const blocked = (x: number, y: number, careful: boolean): boolean => {
    if (x < 5 || y < 5 || x > FANDOM.w - 5 || y > FANDOM.h - 5) return true;
    if (!careful) return false;
    for (const o of world.snakes.values()) {
      if (o === me || !o.alive) continue;
      for (const p of o.pts) if ((p.x - x) ** 2 + (p.y - y) ** 2 < 2.6 * 2.6) return true;
    }
    return false;
  };
  let wander = 0;
  for (let i = 0; i < FANDOM.runMs / FANDOM.stepMs + 5 && result === null; i++) {
    if (i % 3 === 0 && skill !== 'still') {
      const h = me.pts[0];
      const careful = skill === 'greedy';
      const clear = (ang: number) => [3.2, 6.5].every((d) => !blocked(h.x + Math.cos(ang) * d, h.y + Math.sin(ang) * d, careful));
      if (skill === 'wander') {
        wander = Math.max(-1.2, Math.min(1.2, wander + (rng() - 0.5) * 0.9));
        world.steer('p', me.a + wander, false);
      } else if (!clear(me.a)) {
        const off = [0.6, 1.2, 2, 2.6].find((o) => clear(me.a + o) || clear(me.a - o)) ?? 1.5;
        world.steer('p', clear(me.a + off) ? me.a + off : me.a - off, false);
      } else {
        let best: { x: number; y: number } | null = null;
        let bestD = 22 * 22;
        for (const d of world.dots) {
          const dd = (d.x - h.x) ** 2 + (d.y - h.y) ** 2 - d.v * d.v * 4;
          if (dd < bestD) {
            bestD = dd;
            best = d;
          }
        }
        if (best) world.steer('p', Math.atan2(best.y - h.y, best.x - h.x), false);
      }
    }
    t += FANDOM.stepMs;
    world.advance(t);
  }
  return result ?? { why: 'time', fans: me.fans, peak: me.peak, kills: me.kills, by: null, reward: fandomReward(me.peak) };
}

const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

const N = 40;
for (const skill of ['greedy', 'careless', 'wander', 'still'] as Skill[]) {
  const runs = Array.from({ length: N }, (_, i) => play(i + 1, skill));
  const peaks = runs.map((r) => r.peak);
  const mean = peaks.reduce((a, b) => a + b, 0) / N;
  const dead = runs.filter((r) => r.why === 'dead').length;
  const rewards = [0, 1, 2, 3, 5].map((d) => `💎${d}:${runs.filter((r) => fandomReward(r.peak) === d).length}`).join(' ');
  console.log(`${skill.padEnd(9)} peak 평균 ${mean.toFixed(0)} · 중앙 ${pct(peaks, 0.5)} · 하위10% ${pct(peaks, 0.1)} · 상위10% ${pct(peaks, 0.9)} · 쓰러짐 ${dead}/${N} · ${rewards}`);
}
