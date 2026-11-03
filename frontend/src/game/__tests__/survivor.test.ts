import { describe, expect, it } from 'vitest';
import { BALANCE, manualGameOf } from '../balance';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';
import {
  HEIGHT,
  PASSIVE_IDS,
  PERK_IDS,
  PLAYER_R,
  STEP_MS,
  SurvivorGame,
  WEAPON_IDS,
  WIDTH,
  perkMax,
  type Enemy,
  type EnemyId,
  type SurvivorEvent,
} from '../survivor';

const B = BALANCE.survivor;
const T0 = 1_700_000_000_000;

let nextId = 5000;
/** 드론 하나를 직접 올려 놓는다 */
function put(g: SurvivorGame, kind: EnemyId, x: number, y: number, hp?: number): Enemy {
  const def = B.enemies[kind];
  const h = hp ?? def.hp;
  const e: Enemy = { id: nextId++, kind, x, y, hp: h, maxHp: h, radius: def.radius, speed: def.speed, orbitMs: 0, burstMs: 1e9, flashMs: 0 };
  g.enemies.push(e);
  return e;
}
/** 무기를 모두 끈 판(드론이 나오기 전의 숨 고르기 동안만 확인할 때) */
function bare(seed = 1, persona: 'normal' | 'dark' = 'normal'): SurvivorGame {
  const g = new SurvivorGame(persona, seed);
  g.weapons = { spot: 0, orbit: 0, laser: 0, firework: 0 };
  g.px = WIDTH / 2;
  g.py = HEIGHT / 2;
  return g;
}
const evs = (g: SurvivorGame, type: SurvivorEvent['type']) => g.events.filter((e) => e.type === type);
/** 목숨 걱정 없이 오래 돌려 볼 때 */
function immortal(g: SurvivorGame): void {
  g.hearts = 1e6;
  g.maxHearts = 1e6;
}

describe('무대 서바이버: 시작과 이동', () => {
  it('하트 5개, 스포트라이트와 조명을 들고 무대 가운데 아래에서 시작한다', () => {
    const g = new SurvivorGame('normal', 1);
    expect(g.hearts).toBe(B.hearts);
    expect(g.weapons).toEqual({ spot: 1, orbit: 1, laser: 0, firework: 0 });
    expect(g.passives).toEqual({ speed: 0, magnet: 0, amp: 0, heart: 0 });
    expect(g.px).toBe(WIDTH / 2);
    expect(g.py).toBeGreaterThan(HEIGHT / 2);
    expect(g.status).toBe('running');
    expect(g.score).toBe(0);
  });

  it('곡이 시작되고 숨 고르기가 끝나기 전에는 드론이 나오지 않는다', () => {
    const g = bare();
    g.advance(B.breatherMs - STEP_MS);
    expect(g.enemies).toHaveLength(0);
    g.advance(2000);
    expect(g.enemies.length).toBeGreaterThan(0);
  });

  it('조작 방향대로 속도만큼 움직이고 길이가 1을 넘으면 줄인다', () => {
    const g = bare();
    const x0 = g.px;
    g.setMove(1, 0);
    g.advance(1000);
    expect(g.px - x0).toBeCloseTo(B.playerSpeed, 1);
    const y0 = g.py;
    g.setMove(1, 1);
    g.px = 2;
    g.advance(1000);
    // 대각선이어도 1초에 playerSpeed칸
    expect(Math.hypot(g.px - 2, g.py - y0)).toBeCloseTo(B.playerSpeed, 1);
  });

  it('무대 밖으로는 나가지 못하고, 이상한 값은 무시한다', () => {
    const g = bare();
    g.setMove(-1, -1);
    g.advance(8000);
    expect(g.px).toBeCloseTo(PLAYER_R, 5);
    expect(g.py).toBeCloseTo(PLAYER_R, 5);
    g.setMove(Number.NaN, 1);
    g.setMove(0, 0);
    const x = g.px;
    g.advance(500);
    expect(g.px).toBe(x);
  });

  it('발걸음 퍼크를 고르면 빨라진다', () => {
    const g = bare();
    g.passives.speed = 2;
    expect(g.speed).toBeCloseTo(B.playerSpeed + 2 * B.speedStep, 5);
  });
});

describe('무대 서바이버: 드론', () => {
  it('드론은 무대 가장자리 바깥에서 나와 플레이어를 쫓아온다', () => {
    const g = bare();
    immortal(g);
    g.advance(B.breatherMs + 1200);
    expect(g.enemies.length).toBeGreaterThan(0);
    const e = g.enemies[0];
    const d0 = Math.hypot(e.x - g.px, e.y - g.py);
    g.advance(400);
    const after = g.enemies.find((x) => x.id === e.id);
    if (after) expect(Math.hypot(after.x - g.px, after.y - g.py)).toBeLessThan(d0);
  });

  it('한꺼번에 있을 수 있는 드론 수에는 한도가 있다', () => {
    const g = bare();
    immortal(g);
    g.px = 0.3;
    g.py = 0.3;
    for (let i = 0; i < 40; i++) {
      g.advance(2000);
      g.hearts = 1e6;
      expect(g.enemies.length).toBeLessThanOrEqual(B.cap);
    }
  });

  it('일반 판에는 엘리트 드론이 없고 어둠 판에는 나온다', () => {
    const kinds = (persona: 'normal' | 'dark') => {
      const found = new Set<string>();
      for (let seed = 1; seed <= 4; seed++) {
        const g = bare(seed, persona);
        immortal(g);
        for (let t = 0; t < 4000 && !g.picking && !g.over; t++) {
          g.advance(100);
          for (const e of g.enemies) found.add(e.kind);
          if (g.waveIdx === 0 && g.waveMs > 22_000) break;
        }
      }
      return found;
    };
    expect(kinds('normal').has('elite')).toBe(false);
    expect(kinds('dark').has('elite')).toBe(true);
  });

  it('곡이 갈수록 드론이 단단해진다', () => {
    const hpAt = (wave: number) => {
      const g = bare(3);
      immortal(g);
      g.waveIdx = wave;
      g.advance(B.breatherMs + 1500);
      return Math.max(...g.enemies.map((e) => e.maxHp / B.enemies[e.kind].hp));
    };
    expect(hpAt(3)).toBeGreaterThan(hpAt(0));
    expect(hpAt(0)).toBeCloseTo(B.hpGrowth[0] * B.persona.normal.hpMult, 5);
  });
});

describe('무대 서바이버: 맞았을 때', () => {
  it('드론에 닿으면 하트가 하나 줄고 잠깐 무적이며 드론은 밀려난다', () => {
    const g = bare();
    const e = put(g, 'drone', g.px + 0.2, g.py);
    g.advance(STEP_MS);
    expect(g.hearts).toBe(B.hearts - 1);
    expect(g.invulnMs).toBeGreaterThan(0);
    expect(Math.hypot(e.x - g.px, e.y - g.py)).toBeGreaterThan(0.6);
    expect(evs(g, 'hurt')).toHaveLength(1);
    // 무적인 동안에는 또 닿아도 그대로
    e.x = g.px;
    e.y = g.py;
    g.advance(STEP_MS * 4);
    expect(g.hearts).toBe(B.hearts - 1);
  });

  it('무적이 끝나면 다시 맞고 하트가 0이 되면 공연이 끝난다', () => {
    const g = bare();
    g.hearts = 2;
    const e = put(g, 'drone', g.px, g.py);
    g.advance(STEP_MS);
    expect(g.hearts).toBe(1);
    g.advance(B.invulnMs + 100);
    e.x = g.px;
    e.y = g.py;
    g.advance(STEP_MS);
    expect(g.hearts).toBe(0);
    expect(g.over).toBe(true);
    expect(g.died).toBe(true);
    expect(g.summary.died).toBe(true);
    expect(g.events.some((x) => x.type === 'end' && x.died)).toBe(true);
    g.advance(5000);
    expect(g.elapsedMs).toBeLessThan(2000);
  });

  it('엘리트 드론은 멀리서 폭죽 탄막을 쏘고 탄막에 맞아도 하트가 준다', () => {
    const g = bare(1, 'dark');
    const el = put(g, 'elite', g.px, g.py - 3);
    el.burstMs = STEP_MS;
    g.advance(STEP_MS * 2);
    expect(g.shots.length).toBe(B.enemies.elite.burstShots);
    expect(evs(g, 'burst')).toHaveLength(1);
    // 엘리트는 keepDist 밖이면 다가오다 멈춘다
    const d0 = Math.hypot(el.x - g.px, el.y - g.py);
    g.advance(4000);
    expect(Math.hypot(el.x - g.px, el.y - g.py)).toBeLessThan(d0 + 0.01);
    g.shots = [{ x: g.px, y: g.py, vx: 0, vy: 0, lifeMs: 1000 }];
    const hearts = g.hearts;
    g.invulnMs = 0;
    g.enemies = [];
    g.advance(STEP_MS);
    expect(g.hearts).toBe(hearts - 1);
  });
});

describe('무대 서바이버: 무기', () => {
  it('스포트라이트는 가까운 드론을 쏘아 쓰러뜨리고 응원을 떨어뜨린다', () => {
    const g = new SurvivorGame('normal', 1);
    g.weapons.orbit = 0;
    const e = put(g, 'drone', g.px, g.py - 3, 5);
    g.advance(1500);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(g.enemies).not.toContain(e);
    expect(g.kills).toBe(1);
    expect(evs(g, 'kill')).toHaveLength(1);
    expect(g.gems.length + evs(g, 'gem').length).toBeGreaterThan(0);
  });

  it('스포트라이트 레벨이 오르면 갈래가 늘어난다', () => {
    const g = new SurvivorGame('normal', 1);
    g.weapons.orbit = 0;
    g.weapons.spot = 3;
    put(g, 'shield', g.px, g.py - 4, 1e6);
    g.advance(400);
    expect(g.bolts.length).toBe(B.weapons.spot.count[2]);
  });

  it('조명은 둘레를 돌며 부딪힌 드론을 때리고, 같은 드론은 간격을 두고 다시 때린다', () => {
    const g = bare();
    g.weapons.orbit = 1;
    const r = B.weapons.orbit.radius[0];
    const e = put(g, 'shield', g.px + r, g.py, 1e6);
    e.speed = 0;
    g.orbitAngle = 0;
    g.advance(STEP_MS);
    expect(e.maxHp - e.hp).toBe(B.weapons.orbit.dmg[0]);
    g.advance(100);
    expect(e.maxHp - e.hp).toBe(B.weapons.orbit.dmg[0]);
  });

  it('레이저는 줄 선 드론을 모두 꿰뚫는다', () => {
    const g = bare();
    g.weapons.laser = 1;
    const a = put(g, 'shield', g.px + 1.5, g.py, 1e6);
    const b = put(g, 'shield', g.px + 3, g.py, 1e6);
    const off = put(g, 'shield', g.px + 2, g.py + 2, 1e6);
    for (const e of [a, b, off]) e.speed = 0;
    g.advance(STEP_MS);
    expect(a.maxHp - a.hp).toBe(B.weapons.laser.dmg[0]);
    expect(b.maxHp - b.hp).toBe(B.weapons.laser.dmg[0]);
    expect(off.maxHp - off.hp).toBe(0);
    expect(evs(g, 'laser')).toHaveLength(1);
  });

  it('폭죽은 가까운 드론 위에서 터져 둘레를 날린다', () => {
    const g = bare();
    g.weapons.firework = 1;
    const near = put(g, 'shield', g.px + 2, g.py, 1e6);
    const edge = put(g, 'shield', g.px + 2.6, g.py, 1e6);
    const far = put(g, 'shield', g.px - 3, g.py - 3, 1e6);
    for (const e of [near, edge, far]) e.speed = 0;
    g.advance(STEP_MS * 2);
    expect(near.maxHp - near.hp).toBe(B.weapons.firework.dmg[0]);
    expect(edge.maxHp - edge.hp).toBe(B.weapons.firework.dmg[0]);
    expect(far.maxHp - far.hp).toBe(0);
    expect(evs(g, 'boom')).toHaveLength(1);
  });
});

describe('무대 서바이버: 응원 줍기와 레벨업', () => {
  it('응원을 주우면 곡 열기와 경험치가 오르고, 자석 안에서는 끌려온다', () => {
    const g = bare();
    g.gems.push({ x: g.px + 0.2, y: g.py, value: 3, heart: false, lifeMs: 5000 });
    g.advance(STEP_MS);
    expect(g.collected[0]).toBe(3);
    expect(g.xp).toBe(3);
    expect(g.gemTotal).toBe(3);
    expect(g.gems).toHaveLength(0);

    const far = { x: g.px + g.magnetRadius * 0.8, y: g.py, value: 1, heart: false, lifeMs: 5000 };
    g.gems.push(far);
    const d0 = far.x - g.px;
    g.advance(STEP_MS * 2);
    expect(far.x - g.px).toBeLessThan(d0);
    const out = { x: g.px + g.magnetRadius + 1, y: g.py, value: 1, heart: false, lifeMs: 5000 };
    g.gems.push(out);
    g.advance(STEP_MS * 2);
    expect(out.x).toBe(g.px + g.magnetRadius + 1);
  });

  it('응원은 시간이 지나면 사라진다', () => {
    const g = bare();
    g.gems.push({ x: 0.3, y: 0.3, value: 1, heart: false, lifeMs: 100 });
    g.advance(300);
    expect(g.gems).toHaveLength(0);
    expect(g.collected[0]).toBe(0);
  });

  it('열기 증폭은 주운 응원을 늘리고, 하트는 모자랄 때만 채운다', () => {
    const g = bare();
    g.level = 30; // 이 시험에서는 레벨업으로 멈추지 않게
    g.passives.amp = 2;
    g.gems.push({ x: g.px, y: g.py, value: 4, heart: false, lifeMs: 5000 });
    g.advance(STEP_MS);
    expect(g.collected[0]).toBeCloseTo(4 * (1 + 2 * B.ampStep), 5);

    g.gems.push({ x: g.px, y: g.py, value: 0, heart: true, lifeMs: 5000 });
    g.advance(STEP_MS);
    expect(g.hearts).toBe(B.hearts);
    g.hearts = 2;
    g.gems.push({ x: g.px, y: g.py, value: 0, heart: true, lifeMs: 5000 });
    g.advance(STEP_MS);
    expect(g.hearts).toBe(3);
  });

  it('경험치가 차면 시간이 멈추고 서로 다른 퍼크 3개 중 하나를 고른다', () => {
    const g = bare();
    g.xp = g.xpNeed - 1;
    g.gems.push({ x: g.px, y: g.py, value: 1, heart: false, lifeMs: 5000 });
    g.advance(STEP_MS);
    expect(g.picking).toBe(true);
    expect(g.level).toBe(2);
    expect(g.offers).toHaveLength(B.offers);
    expect(new Set(g.offers).size).toBe(B.offers);
    const t = g.elapsedMs;
    g.advance(3000);
    expect(g.elapsedMs).toBe(t);
    expect(g.pick(9)).toBe(false);
    const id = g.offers[0];
    expect(g.pick(0)).toBe(true);
    expect(g.status).toBe('running');
    const lv = (WEAPON_IDS as readonly string[]).includes(id) ? g.weapons[id as 'spot'] : g.passives[id as 'speed'];
    expect(lv).toBeGreaterThanOrEqual(1);
  });

  it('한도에 찬 퍼크는 후보에 나오지 않는다', () => {
    const g = bare();
    for (const id of WEAPON_IDS) g.weapons[id] = B.weaponMax;
    for (const id of PASSIVE_IDS) g.passives[id] = B.passiveMax[id];
    g.passives.heart = B.passiveMax.heart - 1;
    g.xp = g.xpNeed;
    g.advance(STEP_MS);
    // 남은 후보가 하나뿐이면 하나만 보인다
    expect(g.offers).toEqual(['heart']);
    g.pick(0);
    expect(g.maxHearts).toBe(B.hearts + 1);
    expect(perkMax('heart')).toBe(B.passiveMax.heart);
    expect(PERK_IDS).toHaveLength(8);
  });

  it('하트 퍼크는 최대 하트를 늘리고 하나 채운다', () => {
    const g = bare();
    g.hearts = 3;
    g.xp = g.xpNeed;
    g.offers = [];
    g.advance(STEP_MS);
    g.offers = ['heart', 'speed', 'magnet'];
    g.pick(0);
    expect(g.maxHearts).toBe(B.hearts + 1);
    expect(g.hearts).toBe(4);
  });
});

describe('무대 서바이버: 곡 진행과 점수', () => {
  it('곡이 끝나면 드론을 치우고 퍼크를 고른 뒤 다음 곡이 시작된다', () => {
    const g = new SurvivorGame('normal', 2);
    immortal(g);
    g.xp = -1e9;
    let guard = 0;
    while (!g.picking && guard++ < 1000) g.advance(100);
    expect(g.waveIdx).toBe(0);
    expect(g.enemies).toHaveLength(0);
    expect(g.gems).toHaveLength(0);
    expect(g.events.some((e) => e.type === 'waveEnd' && e.index === 0)).toBe(true);
    expect(g.events.some((e) => e.type === 'pick' && e.reason === 'song')).toBe(true);
    g.pick(0);
    expect(g.waveIdx).toBe(1);
    expect(g.waveMs).toBe(0);
    expect(g.status).toBe('running');
    expect(g.events.some((e) => e.type === 'wave' && e.index === 1)).toBe(true);
  });

  it('마지막 곡이 끝나면 쓰러지지 않고 공연이 끝난다', () => {
    const g = new SurvivorGame('normal', 2);
    immortal(g);
    g.xp = -1e9;
    let guard = 0;
    while (!g.over && guard++ < 5000) {
      if (g.picking) g.pick(0);
      else g.advance(200);
    }
    expect(g.over).toBe(true);
    expect(g.died).toBe(false);
    expect(g.waveIdx).toBe(B.waves.length - 1);
    expect(g.summary.seconds).toBeGreaterThanOrEqual(91);
  });

  it('열기 점수는 곡별 달성률 × 곡당 점수의 합이고 600 이상이 클리어다', () => {
    const g = bare();
    expect(g.score).toBe(0);
    const goals = B.persona.normal.goals;
    g.collected = [goals[0], goals[1], goals[2] * 0.4, 0];
    expect(g.score).toBe(Math.round(B.waveScore * 2.4));
    expect(g.cleared).toBe(true);
    g.collected = [goals[0], goals[1], goals[2] * 0.39, 0];
    expect(g.cleared).toBe(false);
    g.collected = [999, 999, 999, 999];
    expect(g.score).toBe(1000);
  });

  it('결과 요약에 처치·응원·레벨·하트·퍼크가 담긴다', () => {
    const g = bare();
    g.kills = 12;
    g.gemTotal = 33.4;
    g.level = 4;
    g.passives.amp = 2;
    const s = g.summary;
    expect(s).toMatchObject({ kills: 12, gems: 33, level: 4, heartsLeft: B.hearts, died: false });
    expect(s.passives.amp).toBe(2);
    expect(s.waves).toHaveLength(4);
  });
});

/** 드론을 피하고 응원을 줍는 봇 */
function steer(g: SurvivorGame): [number, number] {
  let fx = 0;
  let fy = 0;
  let danger = 0;
  for (const e of g.enemies) {
    const dx = g.px - e.x;
    const dy = g.py - e.y;
    const d = Math.hypot(dx, dy) || 0.01;
    if (d > 2.6) continue;
    const w = (e.kind === 'swift' ? 1.7 : 1) / (d * d + 0.1);
    fx += (dx / d) * w;
    fy += (dy / d) * w;
    danger += w;
  }
  for (const s of g.shots) {
    const dx = g.px - (s.x + s.vx * 0.5);
    const dy = g.py - (s.y + s.vy * 0.5);
    const d = Math.hypot(dx, dy) || 0.01;
    if (d > 1.6) continue;
    fx += (dx / d) * (1.5 / (d * d + 0.1));
    fy += (dy / d) * (1.5 / (d * d + 0.1));
  }
  const m = 1.1;
  if (g.px < m) fx += (m - g.px) * 2.5;
  if (g.px > WIDTH - m) fx -= (g.px - (WIDTH - m)) * 2.5;
  if (g.py < m) fy += (m - g.py) * 2.5;
  if (g.py > HEIGHT - m) fy -= (g.py - (HEIGHT - m)) * 2.5;
  let best: { x: number; y: number } | null = null;
  let bv = -1;
  for (const gem of g.gems) {
    const d = Math.hypot(gem.x - g.px, gem.y - g.py);
    if (d > 5) continue;
    const v = (gem.heart ? 3 : 1 + gem.value * 0.3) / (d + 0.5);
    if (v > bv) {
      bv = v;
      best = gem;
    }
  }
  if (best) {
    const d = Math.hypot(best.x - g.px, best.y - g.py) || 0.01;
    const k = Math.max(0.35, 1.6 - danger * 0.25);
    fx += ((best.x - g.px) / d) * k;
    fy += ((best.y - g.py) / d) * k;
  } else if (danger < 0.3) {
    fx += (WIDTH / 2 - g.px) * 0.15;
    fy += (HEIGHT * 0.6 - g.py) * 0.15;
  }
  const len = Math.hypot(fx, fy);
  return len < 1e-6 ? [0, 0] : [(fx / len) * Math.min(1, len * 2), (fy / len) * Math.min(1, len * 2)];
}
const PRIORITY = ['orbit', 'laser', 'firework', 'spot', 'heart', 'amp', 'magnet', 'speed'] as const;
function play(g: SurvivorGame, thinkMs: number): void {
  let guard = 0;
  while (!g.over && guard++ < 100000) {
    if (g.picking) {
      const i = PRIORITY.map((id) => g.offers.indexOf(id)).find((k) => k >= 0) ?? 0;
      g.pick(i);
      continue;
    }
    const [x, y] = steer(g);
    g.setMove(x, y);
    g.advance(thinkMs);
    g.events.length = 0;
  }
}

describe('무대 서바이버: 난이도와 재현성', () => {
  it('같은 씨앗·같은 조작이면 항상 같은 판이다', () => {
    const run = () => {
      const g = new SurvivorGame('normal', 424242);
      play(g, 100);
      return { score: g.score, summary: g.summary };
    };
    expect(run()).toEqual(run());
  });

  it('가만히 있으면 쓰러지고 클리어하지 못한다', () => {
    for (const persona of ['normal', 'dark'] as const) {
      const g = new SurvivorGame(persona, 9);
      let guard = 0;
      while (!g.over && guard++ < 5000) {
        if (g.picking) g.pick(0);
        else g.advance(200);
      }
      expect(g.died).toBe(true);
      expect(g.cleared).toBe(false);
    }
  });

  it('피하면서 응원을 줍고 퍼크를 잘 고르면 클리어한다', () => {
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new SurvivorGame('normal', seed * 7919);
      play(g, 100);
      if (g.cleared) clears += 1;
    }
    expect(clears).toBeGreaterThanOrEqual(5);
  });

  it('어둠 판도 같은 방식으로 클리어할 수 있다', () => {
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new SurvivorGame('dark', seed * 7919);
      play(g, 100);
      if (g.cleared) clears += 1;
    }
    expect(clears).toBeGreaterThanOrEqual(3);
  });
});

describe('대형 콘서트 직접 공연 연결', () => {
  const ready = () => {
    const s = createInitialState(T0);
    const cleared = { cleared: true, bestScore: 0, cooldownUntil: 0 };
    return { ...s, fans: 10_000_000, concerts: { ...s.concerts, room: cleared, club: cleared, hall: cleared, solo: cleared, medium: cleared, large: cleared } };
  };

  it('대형 콘서트는 무대 서바이버이고 월클 콘서트는 월드투어 인크리멘탈이다', () => {
    expect(manualGameOf('arena')).toBe('survivor');
    expect(manualGameOf('large')).toBe('defense');
    expect(manualGameOf('world')).toBe('prestige');
  });

  it('직접 공연을 시작하면 무대 서바이버로 쿨다운이 확정된다', () => {
    const begin = beginManualConcert(ready(), 'arena', 's1');
    if (!begin.ok) throw new Error('begin failed');
    expect(begin.run.game).toBe('survivor');
    expect(begin.state.concerts.arena.cooldownUntil).toBe(T0 + BALANCE.concert.cooldownMs);
    expect(beginManualConcert(begin.state, 'arena', 's2').ok).toBe(false);
  });

  it('보상: 어둠은 2배, 클리어하지 못하면 절반', () => {
    expect(manualConcertReward(2500, 1000, 'normal', 'survivor', true)).toBe(5000);
    expect(manualConcertReward(2500, 1000, 'dark', 'survivor', true)).toBe(10000);
    expect(manualConcertReward(2500, 1000, 'normal', 'survivor', false)).toBe(2500);
  });

  it('클리어는 열기 점수 600으로 정한다', () => {
    const begin = beginManualConcert(ready(), 'arena', 's3');
    if (!begin.ok) throw new Error('begin failed');
    const won = finishManualConcert(begin.state, begin.run, 600);
    expect(won.ok && won.outcome.cleared).toBe(true);
    expect(won.ok && won.state.concerts.arena.cleared).toBe(true);
    const begin2 = beginManualConcert(ready(), 'arena', 's4');
    if (!begin2.ok) throw new Error('begin failed');
    const lost = finishManualConcert(begin2.state, begin2.run, 599);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.state.concerts.arena.cleared).toBe(false);
  });
});
