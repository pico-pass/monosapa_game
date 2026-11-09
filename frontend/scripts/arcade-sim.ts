/**
 * 아케이드 새 게임 4종(악플 베기·블랙홀 먹기·게이트 행진·음표 플링코)의 난이도 시뮬레이션.
 * 실행: npm run sim:arcade (게임 하나만: npm run sim:arcade -- slash | hole | gate | plinko)
 * 솜씨가 다른 봇을 시드 12개(플링코는 8개)로 돌려 점수 평균과 범위를 보여 준다. 점수 기준(`balance.ts`의 ptsTarget·targetR·bossFrac·hp)을 고칠 때 다시 돌려 본다.
 *  - 악플 베기: skill = 악플을 베려고 시도할 확률, 하트 실수 확률은 같이 오른다
 *  - 블랙홀: greedy(먹음직한 소품을 쫓고 큰 라이벌은 피함) · sloppy(가끔 멈칫하고 라이벌을 안 피함) · wander(아무 데나 걷기) · idle
 *  - 게이트: best(줄마다 가장 좋은 자리, 옆 이동 속도 제한은 받음) · center · random · lazy
 *  - 플링코: smart(각도 21개를 미리 쏴 보고 가장 아픈 쪽) · random · center, 유물은 smart만 골라서 고른다
 */
import { SlashGame } from '../src/game/slash';
import { HoleGame } from '../src/game/hole';
import { GateGame, resolveRow, crowdHalfWidth } from '../src/game/gate';
import { PlinkoGame } from '../src/game/plinko';
import { mulberry32 } from '../src/game/runner';

const which = process.argv[2] ?? 'all';
const personas = ['normal', 'dark'] as const;
const seeds = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const fmt = (a: number[]) => `avg ${avg(a).toFixed(0)} [min ${Math.min(...a)} max ${Math.max(...a)}]`;

/* ---------- 악플 베기 ---------- */
function slashRun(persona: 'normal' | 'dark', seed: number, skill: number, mistake: number): number {
  const g = new SlashGame(persona, seed, 0);
  const r = mulberry32(seed ^ 0xabc);
  const dt = 1000 / 60;
  const decided = new Map<number, boolean>();
  for (let i = 0; i < 60 * 80 && g.status === 'running'; i++) {
    g.advance(dt);
    for (const it of g.items) {
      if (it.cut) continue;
      if (it.y > 10 && it.y < 100 && it.vy > -30) {
        // 베기 시도 판정은 아이템마다 한 번
        if (!decided.has(it.id)) decided.set(it.id, it.kind === 'heart' ? r() < mistake : r() < skill);
        if (decided.get(it.id)) g.slash(it.x - 7, it.y, it.x + 7, it.y);
      }
    }
  }
  return g.score();
}
if (which === 'all' || which === 'slash') {
  for (const p of personas) {
    for (const [skill, mistake] of [[1, 0], [0.9, 0.03], [0.75, 0.08], [0.55, 0.12], [0.3, 0.2], [0, 0]] as const) {
      console.log('slash', p, `skill ${skill}`, fmt(seeds.map((s) => slashRun(p, s, skill, mistake))));
    }
  }
}

/* ---------- 블랙홀 ---------- */
function holeRun(persona: 'normal' | 'dark', seed: number, mode: 'greedy' | 'idle' | 'wander' | 'sloppy'): [number, number, number] {
  const g = new HoleGame(persona, seed, 0);
  const rnd = mulberry32(seed ^ 0x77);
  let wx = 35,
    wy = 35;
  const dt = 1000 / 60;
  for (let i = 0; i < 60 * 70 && g.status === 'running'; i++) {
    let ix = 0,
      iy = 0;
    if (mode === 'greedy' || mode === 'sloppy') {
      const limit = g.me.r * 0.8;
      let best = -1,
        bx = 35,
        by = 35;
      for (const p of g.props) {
        if (p.size > limit) continue;
        const v = (p.size * p.size) / (Math.hypot(p.x - g.me.x, p.y - g.me.y) + 3);
        if (v > best) {
          best = v;
          bx = p.x;
          by = p.y;
        }
      }
      // 위험한 라이벌은 피한다
      for (const rv of g.rivals) {
        const d = Math.hypot(rv.x - g.me.x, rv.y - g.me.y);
        if (mode === 'greedy' && rv.r > g.me.r * 1.1 && d < 16) {
          bx = g.me.x + (g.me.x - rv.x);
          by = g.me.y + (g.me.y - rv.y);
        }
      }
      const dx = bx - g.me.x,
        dy = by - g.me.y,
        d = Math.hypot(dx, dy) || 1;
      ix = dx / d;
      iy = dy / d;
      if (mode === 'sloppy' && i % 40 < 14) {
        ix = 0;
        iy = 0; // 가끔 멈칫
      }
    } else if (mode === 'wander') {
      if (i % 90 === 0) {
        wx = rnd() * 70;
        wy = rnd() * 70;
      }
      const dx = wx - g.me.x,
        dy = wy - g.me.y,
        d = Math.hypot(dx, dy) || 1;
      ix = dx / d;
      iy = dy / d;
    }
    g.advance(dt, { x: ix, y: iy });
  }
  return [g.score(), g.me.r, g.rank()];
}
if (which === 'all' || which === 'hole') {
  for (const p of personas) {
    for (const mode of ['greedy', 'sloppy', 'wander', 'idle'] as const) {
      const res = seeds.map((s) => holeRun(p, s, mode));
      console.log('hole', p, mode, fmt(res.map((x) => x[0])), 'r', avg(res.map((x) => x[1])).toFixed(1), 'rank', avg(res.map((x) => x[2])).toFixed(1));
    }
  }
}

/* ---------- 게이트 행진 ---------- */
function gateRun(persona: 'normal' | 'dark', seed: number, mode: 'best' | 'center' | 'random' | 'lazy'): [number, number] {
  const g = new GateGame(persona, seed, 0);
  const rnd = mulberry32(seed ^ 0x55);
  const dt = 50;
  let tx: number | null = null;
  let lastRow = -1;
  for (let i = 0; i < 4000 && g.status === 'running'; i++) {
    if (g.next !== lastRow) {
      lastRow = g.next;
      const row = g.rows[g.next];
      if (row) {
        if (mode === 'best') {
          let bestN = -1,
            bestX = 50;
          for (let x = 5; x <= 95; x += 1) {
            const w = crowdHalfWidth(g.n);
            const cx = Math.max(w, Math.min(100 - w, x));
            const n = resolveRow(row, cx, g.n);
            if (n > bestN) {
              bestN = n;
              bestX = cx;
            }
          }
          tx = bestX;
        } else if (mode === 'random') tx = rnd() * 100;
        else if (mode === 'lazy') tx = row.segs[0].a + (row.segs[0].b - row.segs[0].a) / 2;
        else tx = 50;
      }
    }
    g.advance(dt, { targetX: tx });
  }
  return [g.score(), g.n / g.bossHp];
}
if (which === 'all' || which === 'gate') {
  for (const p of personas) {
    for (const mode of ['best', 'center', 'random', 'lazy'] as const) {
      const res = seeds.map((s) => gateRun(p, s, mode));
      console.log('gate', p, mode, fmt(res.map((x) => x[0])), 'ratio', avg(res.map((x) => x[1])).toFixed(2));
    }
  }
}

/* ---------- 플링코 ---------- */
function clone<T extends object>(g: T): T {
  const c = Object.create(Object.getPrototypeOf(g));
  for (const k of Object.keys(g)) {
    const v = (g as any)[k];
    c[k] = typeof v === 'function' ? v : JSON.parse(JSON.stringify(v ?? null));
  }
  return c;
}
function flyOut(g: PlinkoGame): void {
  for (let i = 0; i < 400 && g.phase === 'fly'; i++) g.advance(50);
}
function plinkoRun(persona: 'normal' | 'dark', seed: number, mode: 'smart' | 'random' | 'center'): [number, number, number] {
  const g = new PlinkoGame(persona, seed, 0);
  const rnd = mulberry32(seed ^ 0x99);
  let shots = 0;
  while (g.status === 'running' && shots < 60) {
    if (g.phase === 'choose') {
      g.choose(mode === 'smart' ? Math.max(0, g.choices!.findIndex((c) => c === 'dmg' || c === 'extra')) : Math.floor(rnd() * 3));
      continue;
    }
    if (g.phase !== 'aim') break;
    let angle = 0;
    if (mode === 'random') angle = (rnd() * 2 - 1) * 1.0;
    else if (mode === 'smart') {
      let best = -1;
      for (let a = -1.0; a <= 1.0001; a += 0.1) {
        const c = clone(g);
        const before = c.totalDmg;
        c.fire(a);
        flyOut(c);
        const d = c.totalDmg - before + (c.lastBin === 'free' ? 6 : 0);
        if (d > best) {
          best = d;
          angle = a;
        }
      }
    }
    g.fire(angle);
    flyOut(g);
    shots++;
  }
  return [g.score(), g.cleared, shots];
}
if (which === 'all' || which === 'plinko') {
  for (const p of personas) {
    for (const mode of ['smart', 'random', 'center'] as const) {
      const res = seeds.slice(0, 8).map((s) => plinkoRun(p, s, mode));
      console.log('plinko', p, mode, fmt(res.map((x) => x[0])), 'cleared', avg(res.map((x) => x[1])).toFixed(1), 'shots', avg(res.map((x) => x[2])).toFixed(1));
    }
  }
}
