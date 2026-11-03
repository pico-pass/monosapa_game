import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 무대 서바이버: 대형 콘서트의 직접 공연. 한 손으로 무대 위를 움직이며 몰려오는 파파라치 드론을 피하고, 스포트라이트·조명·레이저·폭죽이 자동으로 드론을 쓰러뜨린다.
 * 쓰러뜨린 드론이 떨어뜨리는 응원을 주워서 곡마다 열기 목표를 채우고, 응원이 쌓여 레벨이 오르거나 곡이 끝나면 시간이 멈추고 3택1 퍼크를 고른다.
 * 규칙은 React·DOM과 무관하고 무작위는 씨앗 난수다. 시간은 고정 간격(25ms)으로 잘라서 움직이므로 같은 씨앗·같은 조작·같은 시각이면 항상 같은 판이 된다.
 * 칸 단위 좌표: x는 0~width(왼→오), y는 0~height(위→아래). 수치와 규칙 설명은 balance.ts의 BALANCE.survivor.
 */

const B = BALANCE.survivor;

export const WIDTH = B.width;
export const HEIGHT = B.height;
export const PLAYER_R = B.playerRadius;
export const STEP_MS = 25;
const STEP = STEP_MS / 1000;

export const WEAPON_IDS = ['spot', 'orbit', 'laser', 'firework'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export const PASSIVE_IDS = ['speed', 'magnet', 'amp', 'heart'] as const;
export type PassiveId = (typeof PASSIVE_IDS)[number];
export type PerkId = WeaponId | PassiveId;
export const PERK_IDS: readonly PerkId[] = [...WEAPON_IDS, ...PASSIVE_IDS];
export const ENEMY_IDS = ['drone', 'swift', 'shield', 'elite'] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

export const isWeapon = (id: PerkId): id is WeaponId => (WEAPON_IDS as readonly string[]).includes(id);
/** 퍼크가 오를 수 있는 최대 레벨 */
export const perkMax = (id: PerkId): number => (isWeapon(id) ? B.weaponMax : B.passiveMax[id]);

export interface Enemy {
  id: number;
  kind: EnemyId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  /** 궤도 조명에 다시 맞을 수 있을 때까지(ms) */
  orbitMs: number;
  /** 엘리트의 다음 탄막까지(ms) */
  burstMs: number;
  /** 맞은 뒤 반짝이는 시간(ms), 화면용 */
  flashMs: number;
}

export interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  pierce: number;
  lifeMs: number;
  /** 이미 맞힌 드론 번호 */
  hit: number[];
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
}

export interface Gem {
  x: number;
  y: number;
  /** 응원 값. 0이면 하트 */
  value: number;
  heart: boolean;
  lifeMs: number;
}

export type SurvivorStatus = 'running' | 'picking' | 'finished';

export type SurvivorEvent =
  | { type: 'kill'; kind: EnemyId; x: number; y: number }
  | { type: 'hurt' }
  | { type: 'heal' }
  | { type: 'gem'; value: number }
  | { type: 'laser'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'boom'; x: number; y: number; r: number }
  | { type: 'burst'; x: number; y: number }
  | { type: 'level'; level: number }
  | { type: 'pick'; offers: PerkId[]; reason: 'level' | 'song' }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'wave'; index: number }
  | { type: 'end'; died: boolean };

export interface SurvivorSummary {
  kills: number;
  /** 주운 응원 합 */
  gems: number;
  level: number;
  heartsLeft: number;
  died: boolean;
  weapons: Record<WeaponId, number>;
  passives: Record<PassiveId, number>;
  /** 곡별 열기 목표 달성률(%, 100이 상한) */
  waves: number[];
  seconds: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** 선분 (ax,ay)-(bx,by)와 점 사이 거리의 제곱 */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

export class SurvivorGame {
  readonly persona: Persona;
  readonly seed: number;
  px = WIDTH / 2;
  py = HEIGHT * 0.62;
  /** 바라보는 방향(라디안), 화면용 */
  facing = -Math.PI / 2;
  hearts: number = B.hearts;
  maxHearts: number = B.hearts;
  invulnMs = 0;
  enemies: Enemy[] = [];
  bolts: Bolt[] = [];
  shots: Shot[] = [];
  gems: Gem[] = [];
  weapons: Record<WeaponId, number> = { spot: 1, orbit: 1, laser: 0, firework: 0 };
  passives: Record<PassiveId, number> = { speed: 0, magnet: 0, amp: 0, heart: 0 };
  /** 궤도 조명의 각도(라디안) */
  orbitAngle = 0;
  level = 1;
  xp = 0;
  status: SurvivorStatus = 'running';
  waveIdx = 0;
  waveMs = 0;
  elapsedMs = 0;
  /** 곡별로 주운 응원 */
  collected: number[] = B.waves.map(() => 0);
  kills = 0;
  gemTotal = 0;
  died = false;
  offers: PerkId[] = [];
  /** 아직 고르지 않은 퍼크 수 */
  pending = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: SurvivorEvent[] = [];
  private mx = 0;
  private my = 0;
  private rng: () => number;
  private acc = 0;
  private nextId = 1;
  private spawnAcc = 0;
  private picks = 0;
  private cd: Record<WeaponId, number> = { spot: 300, orbit: 0, laser: 0, firework: 0 };
  /** 곡이 끝나서 퍼크를 고르는 중이면 true(고르고 나면 다음 곡이 시작된다) */
  private songBreak = false;

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.rng = mulberry32(mix(this.seed, 811));
  }

  get over(): boolean {
    return this.status === 'finished';
  }
  get picking(): boolean {
    return this.status === 'picking';
  }
  get goal(): number {
    return B.persona[this.persona].goals[this.waveIdx];
  }
  get remainingMs(): number {
    return Math.max(0, B.waves[this.waveIdx].ms - this.waveMs);
  }
  get xpNeed(): number {
    const t = B.xpNeed;
    return this.level - 1 < t.length ? t[this.level - 1] : t[t.length - 1] + B.xpStep * (this.level - t.length);
  }
  get speed(): number {
    return B.playerSpeed + B.speedStep * this.passives.speed;
  }
  get magnetRadius(): number {
    return B.gem.magnet + B.gem.magnetStep * this.passives.magnet;
  }
  /** 곡 i의 열기 목표 달성률(0~1) */
  waveRatio(i: number): number {
    return Math.min(1, this.collected[i] / B.persona[this.persona].goals[i]);
  }
  /** 열기 점수 0~1000 */
  get score(): number {
    let sum = 0;
    for (let i = 0; i < B.waves.length; i++) sum += B.waveScore * this.waveRatio(i);
    return Math.round(Math.min(1000, sum));
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): SurvivorSummary {
    return {
      kills: this.kills,
      gems: Math.round(this.gemTotal),
      level: this.level,
      heartsLeft: this.hearts,
      died: this.died,
      weapons: { ...this.weapons },
      passives: { ...this.passives },
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  /** 움직일 방향(길이 1이 최대 속도). 길이가 1을 넘으면 1로 줄인다. */
  setMove(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    this.mx = x * k;
    this.my = y * k;
  }

  /** 실제 경과 시간을 넣는다. 퍼크를 고르는 동안과 끝난 뒤에는 시간이 흐르지 않는다. */
  advance(dtMs: number): void {
    if (this.status !== 'running') return;
    this.acc += Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
    while (this.acc >= STEP_MS && this.status === 'running') {
      this.acc -= STEP_MS;
      this.step();
    }
    if (this.status !== 'running') this.acc = 0;
  }

  /** 퍼크 후보 중 i번째를 고른다. 더 고를 게 남았으면 새 후보를, 없으면 게임을 이어 간다. */
  pick(i: number): boolean {
    if (this.status !== 'picking') return false;
    const id = this.offers[i];
    if (!id) return false;
    this.apply(id);
    this.pending -= 1;
    this.offers = [];
    if (this.pending > 0 && this.drawOffers('level')) return true;
    this.pending = 0;
    this.resume();
    return true;
  }

  private emit(e: SurvivorEvent): void {
    this.events.push(e);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  private apply(id: PerkId): void {
    if (isWeapon(id)) {
      this.weapons[id] += 1;
      if (this.weapons[id] === 1) this.cd[id] = 400;
    } else {
      this.passives[id] += 1;
      if (id === 'heart') {
        this.maxHearts += 1;
        this.hearts = Math.min(this.maxHearts, this.hearts + 1);
      }
    }
  }

  private resume(): void {
    this.status = 'running';
    if (this.songBreak) {
      this.songBreak = false;
      this.waveIdx += 1;
      this.waveMs = 0;
      this.spawnAcc = 0;
      this.emit({ type: 'wave', index: this.waveIdx });
    }
  }

  /** 아직 한도에 안 찬 퍼크 중 offers개를 씨앗으로 고른다(새 무기·올리는 무기·퍼크를 섞는다). false면 고를 게 없다. */
  private drawOffers(reason: 'level' | 'song'): boolean {
    const rng = mulberry32(mix(this.seed, 900 + this.picks++));
    const pool: { id: PerkId; w: number }[] = [];
    for (const id of PERK_IDS) {
      const lv = isWeapon(id) ? this.weapons[id] : this.passives[id];
      if (lv >= perkMax(id)) continue;
      pool.push({ id, w: isWeapon(id) ? (lv > 0 ? 3 : 2) : 2 });
    }
    const out: PerkId[] = [];
    while (out.length < B.offers && pool.length > 0) {
      const total = pool.reduce((a, p) => a + p.w, 0);
      let r = rng() * total;
      let k = 0;
      for (; k < pool.length - 1; k++) {
        r -= pool[k].w;
        if (r < 0) break;
      }
      out.push(pool[k].id);
      pool.splice(k, 1);
    }
    if (out.length === 0) return false;
    this.offers = out;
    this.status = 'picking';
    this.emit({ type: 'pick', offers: [...out], reason });
    return true;
  }

  private step(): void {
    this.waveMs += STEP_MS;
    this.elapsedMs += STEP_MS;
    if (this.invulnMs > 0) this.invulnMs -= STEP_MS;

    // 플레이어 이동
    if (this.mx !== 0 || this.my !== 0) {
      this.px = clamp(this.px + this.mx * this.speed * STEP, PLAYER_R, WIDTH - PLAYER_R);
      this.py = clamp(this.py + this.my * this.speed * STEP, PLAYER_R, HEIGHT - PLAYER_R);
      this.facing = Math.atan2(this.my, this.mx);
    }

    this.spawn();
    this.moveEnemies();
    this.fireWeapons();
    this.moveBolts();
    this.moveShots();
    this.contact();
    this.collectKills();
    this.moveGems();
    if (this.status !== 'running') return;

    // 레벨업
    let leveled = false;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level += 1;
      this.pending += 1;
      leveled = true;
      this.emit({ type: 'level', level: this.level });
    }
    if (leveled && this.drawOffers('level')) return;
    if (leveled) this.pending = 0;

    if (this.waveMs >= B.waves[this.waveIdx].ms) this.endWave();
  }

  private endWave(): void {
    this.emit({ type: 'waveEnd', index: this.waveIdx, ratio: this.waveRatio(this.waveIdx) });
    this.enemies = [];
    this.bolts = [];
    this.shots = [];
    this.gems = [];
    if (this.waveIdx >= B.waves.length - 1) {
      this.status = 'finished';
      this.emit({ type: 'end', died: false });
      return;
    }
    this.songBreak = true;
    this.pending += 1;
    if (!this.drawOffers('song')) {
      this.pending = 0;
      this.resume();
    }
  }

  private spawn(): void {
    if (this.waveMs < B.breatherMs) return;
    const p = B.persona[this.persona];
    this.spawnAcc += B.spawnPerSec[this.waveIdx] * p.rate * STEP;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.enemies.length >= B.cap) continue;
      const mixW: readonly number[] = p.mix[this.waveIdx];
      const total = mixW.reduce((a, b) => a + b, 0);
      let r = this.rng() * total;
      let k = 0;
      for (; k < ENEMY_IDS.length - 1; k++) {
        r -= mixW[k];
        if (r < 0) break;
      }
      const kind = ENEMY_IDS[k];
      const def = B.enemies[kind];
      const side = Math.floor(this.rng() * 4);
      const along = this.rng();
      const out = def.radius + 0.35;
      const x = side === 0 ? -out : side === 1 ? WIDTH + out : along * WIDTH;
      const y = side === 2 ? -out : side === 3 ? HEIGHT + out : along * HEIGHT;
      const hp = Math.max(1, Math.round(def.hp * B.hpGrowth[this.waveIdx] * p.hpMult));
      this.enemies.push({
        id: this.nextId++,
        kind,
        x,
        y,
        hp,
        maxHp: hp,
        radius: def.radius,
        speed: def.speed * B.speedGrowth[this.waveIdx],
        orbitMs: 0,
        burstMs: kind === 'elite' ? B.enemies.elite.burstMs * (0.5 + this.rng() * 0.5) : 0,
        flashMs: 0,
      });
    }
  }

  private moveEnemies(): void {
    const list = this.enemies;
    for (const e of list) {
      if (e.orbitMs > 0) e.orbitMs -= STEP_MS;
      if (e.flashMs > 0) e.flashMs -= STEP_MS;
      const dx = this.px - e.x;
      const dy = this.py - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (e.kind === 'elite') {
        const el = B.enemies.elite;
        // 엘리트는 keepDist까지 다가와서 멈추고 탄막을 쏜다
        if (d > el.keepDist) {
          e.x += (dx / d) * e.speed * STEP;
          e.y += (dy / d) * e.speed * STEP;
        }
        e.burstMs -= STEP_MS;
        if (e.burstMs <= 0) {
          e.burstMs += el.burstMs;
          const off = this.rng() * Math.PI * 2;
          for (let i = 0; i < el.burstShots; i++) {
            const a = off + (i / el.burstShots) * Math.PI * 2;
            this.shots.push({ x: e.x, y: e.y, vx: Math.cos(a) * el.shotSpeed, vy: Math.sin(a) * el.shotSpeed, lifeMs: el.shotLifeMs });
          }
          this.emit({ type: 'burst', x: e.x, y: e.y });
        }
      } else {
        e.x += (dx / d) * e.speed * STEP;
        e.y += (dy / d) * e.speed * STEP;
      }
    }
    // 서로 겹치지 않게 밀어낸다
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.85;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.001;
        const push = (min - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  private nearest(maxDist = Infinity, skip?: Set<number>): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.hp <= 0 || (skip && skip.has(e.id))) continue;
      const d = (e.x - this.px) ** 2 + (e.y - this.py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private hurt(e: Enemy, dmg: number): void {
    e.hp -= dmg;
    e.flashMs = 90;
  }

  private fireWeapons(): void {
    const W = B.weapons;
    // 스포트라이트: 가장 가까운 드론에게 빔을 쏜다
    if (this.weapons.spot > 0) {
      const lv = this.weapons.spot - 1;
      this.cd.spot -= STEP_MS;
      if (this.cd.spot <= 0) {
        const t = this.nearest();
        if (t) {
          this.cd.spot += W.spot.intervalMs[lv];
          const base = Math.atan2(t.y - this.py, t.x - this.px);
          const n = W.spot.count[lv];
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * ((W.spot.spreadDeg * Math.PI) / 180);
            this.bolts.push({ x: this.px, y: this.py, vx: Math.cos(a) * W.spot.speed, vy: Math.sin(a) * W.spot.speed, dmg: W.spot.dmg[lv], pierce: W.spot.pierce[lv], lifeMs: W.spot.lifeMs, hit: [] });
          }
        } else this.cd.spot = 0;
      }
    }
    // 조명: 플레이어 둘레를 도는 조명이 닿은 드론을 때린다
    if (this.weapons.orbit > 0) {
      const lv = this.weapons.orbit - 1;
      this.orbitAngle += W.orbit.spin[lv] * STEP;
      const n = W.orbit.count[lv];
      const reach = W.orbit.lightRadius;
      for (let i = 0; i < n; i++) {
        const a = this.orbitAngle + (i / n) * Math.PI * 2;
        const lx = this.px + Math.cos(a) * W.orbit.radius[lv];
        const ly = this.py + Math.sin(a) * W.orbit.radius[lv];
        for (const e of this.enemies) {
          if (e.hp <= 0 || e.orbitMs > 0) continue;
          if ((e.x - lx) ** 2 + (e.y - ly) ** 2 < (e.radius + reach) ** 2) {
            this.hurt(e, W.orbit.dmg[lv]);
            e.orbitMs = W.orbit.hitCdMs;
          }
        }
      }
    }
    // 레이저: 가까운 드론 쪽으로 길게 뻗어 지나가는 드론을 모두 때린다
    if (this.weapons.laser > 0) {
      const lv = this.weapons.laser - 1;
      this.cd.laser -= STEP_MS;
      if (this.cd.laser <= 0) {
        const first = this.nearest();
        if (first) {
          this.cd.laser += W.laser.intervalMs[lv];
          const used = new Set<number>([first.id]);
          const targets: Enemy[] = [first];
          if (W.laser.beams[lv] > 1) {
            const second = this.nearest(Infinity, used);
            if (second) targets.push(second);
          }
          for (const t of targets) {
            const a = Math.atan2(t.y - this.py, t.x - this.px);
            const x2 = this.px + Math.cos(a) * W.laser.length;
            const y2 = this.py + Math.sin(a) * W.laser.length;
            for (const e of this.enemies) {
              if (e.hp <= 0) continue;
              if (segDist2(e.x, e.y, this.px, this.py, x2, y2) < (W.laser.width / 2 + e.radius) ** 2) this.hurt(e, W.laser.dmg[lv]);
            }
            this.emit({ type: 'laser', x1: this.px, y1: this.py, x2, y2 });
          }
        } else this.cd.laser = 0;
      }
    }
    // 폭죽: 가까이 있는 드론 몇 마리 위에서 터진다
    if (this.weapons.firework > 0) {
      const lv = this.weapons.firework - 1;
      this.cd.firework -= STEP_MS;
      if (this.cd.firework <= 0) {
        const near = this.enemies.filter((e) => e.hp > 0 && (e.x - this.px) ** 2 + (e.y - this.py) ** 2 < W.firework.range ** 2);
        if (near.length > 0) {
          this.cd.firework += W.firework.intervalMs[lv];
          const r = W.firework.radius[lv];
          for (let i = 0; i < W.firework.count[lv] && near.length > 0; i++) {
            const t = near.splice(Math.floor(this.rng() * near.length), 1)[0];
            for (const e of this.enemies) if (e.hp > 0 && (e.x - t.x) ** 2 + (e.y - t.y) ** 2 < (r + e.radius) ** 2) this.hurt(e, W.firework.dmg[lv]);
            this.emit({ type: 'boom', x: t.x, y: t.y, r });
          }
        } else this.cd.firework = 0;
      }
    }
  }

  private moveBolts(): void {
    const R = B.weapons.spot.radius;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      b.lifeMs -= STEP_MS;
      let dead = b.lifeMs <= 0 || b.x < -1 || b.x > WIDTH + 1 || b.y < -1 || b.y > HEIGHT + 1;
      if (!dead) {
        for (const e of this.enemies) {
          if (e.hp <= 0 || b.hit.includes(e.id)) continue;
          if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.radius + R) ** 2) {
            this.hurt(e, b.dmg);
            b.hit.push(e.id);
            if (b.pierce > 0) b.pierce -= 1;
            else {
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) this.bolts.splice(i, 1);
    }
  }

  private moveShots(): void {
    const r = B.enemies.elite.shotRadius + PLAYER_R * 0.8;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.x += s.vx * STEP;
      s.y += s.vy * STEP;
      s.lifeMs -= STEP_MS;
      if (s.lifeMs <= 0 || s.x < -1 || s.x > WIDTH + 1 || s.y < -1 || s.y > HEIGHT + 1) {
        this.shots.splice(i, 1);
        continue;
      }
      if ((s.x - this.px) ** 2 + (s.y - this.py) ** 2 < r * r) {
        this.shots.splice(i, 1);
        this.damagePlayer();
        if (this.status === 'finished') return;
      }
    }
  }

  /** 드론이 닿으면 하트가 하나 줄고 잠깐 무적이 된다. 닿은 드론은 밀려난다. */
  private contact(): void {
    if (this.status !== 'running') return;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = this.px - e.x;
      const dy = this.py - e.y;
      const min = e.radius + PLAYER_R * 0.85;
      if (dx * dx + dy * dy >= min * min) continue;
      if (this.invulnMs > 0) continue;
      const d = Math.hypot(dx, dy) || 1;
      e.x -= (dx / d) * B.knockback;
      e.y -= (dy / d) * B.knockback;
      this.damagePlayer();
      return;
    }
  }

  private damagePlayer(): void {
    if (this.invulnMs > 0 || this.status !== 'running') return;
    this.hearts -= 1;
    this.invulnMs = B.invulnMs;
    this.emit({ type: 'hurt' });
    if (this.hearts <= 0) {
      this.died = true;
      this.status = 'finished';
      this.emit({ type: 'end', died: true });
    }
  }

  private collectKills(): void {
    if (this.status !== 'running') return;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.hp > 0) continue;
      this.enemies.splice(i, 1);
      this.kills += 1;
      const def = B.enemies[e.kind];
      this.gems.push({ x: e.x, y: e.y, value: def.value, heart: false, lifeMs: B.gem.lifeMs });
      if (this.rng() < B.heartDrop[e.kind]) this.gems.push({ x: e.x + 0.25, y: e.y, value: 0, heart: true, lifeMs: B.gem.lifeMs });
      this.emit({ type: 'kill', kind: e.kind, x: e.x, y: e.y });
    }
  }

  private moveGems(): void {
    const mag = this.magnetRadius;
    const reach = PLAYER_R + B.gem.radius;
    const amp = 1 + B.ampStep * this.passives.amp;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.lifeMs -= STEP_MS;
      if (g.lifeMs <= 0) {
        this.gems.splice(i, 1);
        continue;
      }
      const dx = this.px - g.x;
      const dy = this.py - g.y;
      const d = Math.hypot(dx, dy);
      if (d < reach) {
        this.gems.splice(i, 1);
        if (g.heart) {
          if (this.hearts < this.maxHearts) {
            this.hearts += 1;
            this.emit({ type: 'heal' });
          }
        } else {
          const v = g.value * amp;
          this.collected[this.waveIdx] += v;
          this.gemTotal += v;
          this.xp += v;
          this.emit({ type: 'gem', value: v });
        }
      } else if (d < mag) {
        g.x += (dx / d) * B.gem.magnetSpeed * STEP;
        g.y += (dy / d) * B.gem.magnetSpeed * STEP;
      }
    }
  }
}
