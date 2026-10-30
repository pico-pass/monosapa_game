import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import type { Persona } from './types';

/*
 * 새벽 생존: 마이크(플레이어)가 가장 가까운 악플을 자동으로 쏘고, 처치로 모은 경험치로 레벨업하면 가사 스킬을 하나 고른다.
 * 고정 시간 단계(stepMs)로만 진행하고 무작위는 씨앗 난수라서, 같은 씨앗·같은 입력이면 항상 같은 판이 된다.
 * 어둠 자아는 과열 게이지(= 100 − 체력)가 체력이다: 공격이 강한 대신 더 아프게 맞는다.
 */

const S = BALANCE.survival;

export type SkillId = 'rate' | 'dmg' | 'multi' | 'pierce' | 'speed' | 'aura' | 'heal';
export type EnemyKind = keyof typeof S.enemies;
export const SKILL_IDS: readonly SkillId[] = ['rate', 'dmg', 'multi', 'pierce', 'speed', 'aura', 'heal'];
/** 레벨이 있는 스킬의 최대 레벨 (multi는 동시 발사 +3까지) */
export const skillMax = (id: SkillId): number => (id === 'multi' ? 3 : id === 'heal' ? 0 : S.skillMax);

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /** 남은 관통 수(0이면 다음 명중에서 사라진다) */
  pierce: number;
  hit: number[];
}

export interface Input {
  /** -1~1. 둘 다 0이면 가만히 있는다. 길이가 1을 넘으면 정규화한다. */
  x: number;
  y: number;
}

export type SurvivalStatus = 'running' | 'won' | 'dead';

export class SurvivalGame {
  persona: Persona;
  private readonly rng: () => number;
  private readonly dmgMult: number;
  private readonly takenMult: number;

  timeMs = 0;
  status: SurvivalStatus = 'running';
  px = 0;
  py = 0;
  hp: number = S.hp;
  invMs = 0;
  kills = 0;
  xp = 0;
  level = 1;
  skills: Record<SkillId, number> = { rate: 0, dmg: 0, multi: 0, pierce: 0, speed: 0, aura: 0, heal: 0 };
  /** 레벨업 선택지. 값이 있으면 게임이 멈춰 있다. */
  choices: SkillId[] | null = null;
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  /** 마지막으로 쏜 방향(화면 표시용) */
  aim = 0;
  /** 오라가 마지막으로 터진 시각(화면 표시용) */
  auraAt = -1e9;

  private fireCd = 0;
  private auraCd = 0;
  private spawnCd = 500;
  private bossSpawned = false;
  private nextId = 1;
  private acc = 0;

  constructor(persona: Persona, seed: number, power = 0) {
    this.persona = persona;
    this.rng = mulberry32(seed);
    this.rng();
    this.dmgMult = (persona === 'dark' ? S.dark.dmg : 1) * (1 + Math.max(0, power));
    this.takenMult = persona === 'dark' ? S.dark.taken : 1;
  }

  /** 어둠 자아의 과열 게이지 */
  get heat(): number {
    return Math.max(0, 100 - (this.hp / S.hp) * 100);
  }

  get xpNeed(): number {
    return S.xpBase + S.xpStep * (this.level - 1);
  }

  get dmg(): number {
    return (S.dmg + 0.5 * this.skills.dmg) * this.dmgMult;
  }

  /** 점수 0~1000: 버틴 시간 600 + 처치 400 */
  score(): number {
    const time = Math.min(1, this.timeMs / S.durationMs);
    const kills = Math.min(1, this.kills / S.killsTarget);
    return Math.round(600 * time + 400 * kills);
  }

  private rand(lo: number, hi: number): number {
    return lo + this.rng() * (hi - lo);
  }

  /** 스킬을 고른다. 선택지 안의 번호(0부터)로 고르고, 경험치가 남아 있으면 곧바로 다음 선택지가 열린다. */
  choose(index: number): boolean {
    if (!this.choices || index < 0 || index >= this.choices.length) return false;
    const id = this.choices[index];
    if (id === 'heal') this.hp = Math.min(S.hp, this.hp + S.healAmount);
    else this.skills[id] += 1;
    this.choices = null;
    this.checkLevelUp();
    return true;
  }

  private checkLevelUp(): void {
    if (this.choices || this.xp < this.xpNeed) return;
    this.xp -= this.xpNeed;
    this.level += 1;
    const pool = SKILL_IDS.filter((id) => id === 'heal' || this.skills[id] < skillMax(id));
    const picks: SkillId[] = [];
    while (picks.length < 3 && pool.length > 0) picks.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
    this.choices = picks;
  }

  private spawn(): void {
    if (this.enemies.length >= S.maxEnemies) return;
    const p = this.timeMs / S.durationMs;
    const r = this.rng();
    let kind: EnemyKind = 'noise';
    if (p > 0.15 && r < 0.2 + p * 0.35) kind = 'troll';
    if (p > 0.4 && r > 0.88 - p * 0.1) kind = 'mob';
    // 가장자리 한 곳에서 나온다
    const side = Math.floor(this.rng() * 4);
    const t = this.rand(-S.half, S.half);
    const x = side === 0 ? -S.half : side === 1 ? S.half : t;
    const y = side === 2 ? -S.half : side === 3 ? S.half : t;
    this.enemies.push({ id: this.nextId++, kind, x, y, hp: S.enemies[kind].hp });
  }

  private kill(e: Enemy): void {
    this.kills += 1;
    this.xp += S.enemies[e.kind].xp;
  }

  private damage(e: Enemy, amount: number): boolean {
    e.hp -= amount;
    return e.hp <= 0;
  }

  /** 한 단계(stepMs) 진행한다. 레벨업 선택 중이거나 끝난 게임은 움직이지 않는다. */
  step(input: Input): void {
    if (this.status !== 'running' || this.choices) return;
    const dt = S.stepMs;
    const sec = dt / 1000;
    this.timeMs += dt;
    if (this.timeMs >= S.durationMs) {
      this.timeMs = S.durationMs;
      this.status = 'won';
      return;
    }

    // 이동
    let ix = Number.isFinite(input.x) ? input.x : 0;
    let iy = Number.isFinite(input.y) ? input.y : 0;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    const v = S.speed * (1 + 0.1 * this.skills.speed) * sec;
    this.px = Math.max(-S.half, Math.min(S.half, this.px + ix * v));
    this.py = Math.max(-S.half, Math.min(S.half, this.py + iy * v));
    this.invMs = Math.max(0, this.invMs - dt);

    // 스폰
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) {
      const [a, b] = S.spawnMs;
      this.spawnCd += a + (b - a) * (this.timeMs / S.durationMs);
      this.spawn();
      if (this.timeMs > 100_000) this.spawn();
    }
    if (!this.bossSpawned && this.timeMs >= S.bossAtMs) {
      this.bossSpawned = true;
      this.enemies.push({ id: this.nextId++, kind: 'boss', x: 0, y: -S.half, hp: S.enemies.boss.hp });
    }

    // 적 이동·접촉
    const speedUp = 1 + 0.4 * (this.timeMs / S.durationMs);
    for (const e of this.enemies) {
      const def = S.enemies[e.kind];
      const dx = this.px - e.x;
      const dy = this.py - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.x += (dx / d) * def.speed * speedUp * sec;
      e.y += (dy / d) * def.speed * speedUp * sec;
      if (d < def.r + S.playerR && this.invMs <= 0) {
        this.hp -= def.dmg * this.takenMult;
        this.invMs = S.invincibleMs;
        if (this.hp <= 0) {
          this.hp = 0;
          this.status = 'dead';
          return;
        }
      }
    }

    // 발사
    this.fireCd -= dt;
    if (this.fireCd <= 0 && this.enemies.length > 0) {
      let target: Enemy | null = null;
      let best = Infinity;
      for (const e of this.enemies) {
        const d = (e.x - this.px) ** 2 + (e.y - this.py) ** 2;
        if (d < best) {
          best = d;
          target = e;
        }
      }
      if (target) {
        const base = Math.atan2(target.y - this.py, target.x - this.px);
        this.aim = base;
        const n = 1 + this.skills.multi;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.2;
          this.bullets.push({ x: this.px, y: this.py, vx: Math.cos(a) * S.bulletSpeed, vy: Math.sin(a) * S.bulletSpeed, life: S.bulletLife, pierce: this.skills.pierce, hit: [] });
        }
        this.fireCd = S.fireMs * 0.8 ** this.skills.rate;
      }
    }

    // 탄 이동·명중
    const dead = new Set<number>();
    const bullets: Bullet[] = [];
    for (const b of this.bullets) {
      b.x += b.vx * sec;
      b.y += b.vy * sec;
      b.life -= sec;
      let alive = b.life > 0 && Math.abs(b.x) <= S.half + 4 && Math.abs(b.y) <= S.half + 4;
      for (const e of this.enemies) {
        if (!alive) break;
        if (dead.has(e.id) || b.hit.includes(e.id)) continue;
        const r = S.enemies[e.kind].r + S.bulletR;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 > r * r) continue;
        b.hit.push(e.id);
        if (this.damage(e, this.dmg)) {
          dead.add(e.id);
          this.kill(e);
        }
        if (b.pierce <= 0) alive = false;
        else b.pierce -= 1;
      }
      if (alive) bullets.push(b);
    }
    this.bullets = bullets;

    // 사운드 오라
    if (this.skills.aura > 0) {
      this.auraCd -= dt;
      if (this.auraCd <= 0) {
        this.auraCd += 600;
        this.auraAt = this.timeMs;
        const radius = 2.2 + 0.6 * this.skills.aura;
        const power = (0.6 + 0.4 * this.skills.aura) * this.dmgMult;
        for (const e of this.enemies) {
          if (dead.has(e.id) || (e.x - this.px) ** 2 + (e.y - this.py) ** 2 > (radius + S.enemies[e.kind].r) ** 2) continue;
          if (this.damage(e, power)) {
            dead.add(e.id);
            this.kill(e);
          }
        }
      }
    }
    if (dead.size > 0) this.enemies = this.enemies.filter((e) => !dead.has(e.id));
    this.checkLevelUp();
  }

  /** 실제 경과 시간(ms)만큼 고정 단계로 진행한다. 한 번에 너무 긴 시간은 호출자가 잘라서 넘긴다. */
  advance(deltaMs: number, input: Input): void {
    this.acc += Math.max(0, Math.min(deltaMs, 250));
    while (this.acc >= S.stepMs && this.status === 'running' && !this.choices) {
      this.acc -= S.stepMs;
      this.step(input);
    }
    if (this.choices || this.status !== 'running') this.acc = 0;
  }
}
