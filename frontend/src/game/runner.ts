import { BALANCE } from './balance';
import type { Persona } from './types';

/*
 * 모노사파런: 달리면서 점점 빨라지고, 코스 끝까지 완주하면 성공. 점수는 먹은 젤리 비율(0~1000).
 * 규칙은 React·DOM과 무관하다. 화면은 RunGame의 상태를 읽어 그리기만 한다.
 * 가로 길이는 스크롤 단위(u)로 다루고, 화면에 보이는 거리(m)는 코스 길이에 비례해 환산한다.
 */

const R = BALANCE.run;

export interface Obstacle {
  x: number;
  w: number;
  h: number;
}

export interface Jelly {
  x: number;
  y: number;
}

export interface Course {
  persona: Persona;
  lengthU: number;
  goalM: number;
  startSpeed: number;
  endSpeed: number;
  obstacles: Obstacle[];
  jellies: Jelly[];
}

export type RunStatus = 'running' | 'cleared' | 'failed';

/** 시드 고정 난수. 같은 시드면 같은 코스가 나온다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 코스 위 x(u) 지점의 기본 속도(u/s). 진행할수록 startSpeed → endSpeed로 선형 증가한다. */
export function speedAt(course: Pick<Course, 'lengthU' | 'startSpeed' | 'endSpeed'>, x: number): number {
  return lerp(course.startSpeed, course.endSpeed, Math.max(0, Math.min(1, x / course.lengthU)));
}

export function buildCourse(persona: Persona, seed: number): Course {
  const cfg = R.persona[persona];
  const rng = mulberry32(seed);
  const course: Course = {
    persona,
    lengthU: cfg.lengthU,
    goalM: cfg.goalM,
    startSpeed: cfg.startSpeed,
    endSpeed: cfg.endSpeed,
    obstacles: [],
    jellies: [],
  };
  const limit = cfg.lengthU - R.finishClearU;
  let x = R.leadInU;
  for (;;) {
    const p = x / cfg.lengthU;
    const speed = speedAt(course, x);
    const w = 1 + rng() * 0.8;
    const h = 0.9 + rng() * 0.4;
    if (x + w > limit) break;
    course.obstacles.push({ x, w, h });

    // 장애물 위를 지나가는 점프 궤적을 따라 젤리 5개
    for (let k = 0; k < 5; k++) {
      const t = (k / 4) * 2 - 1;
      course.jellies.push({ x: x + w / 2 + t * (w / 2 + 1.6), y: 0.7 + (h + 1.2 - 0.7) * (1 - t * t) });
    }

    const sec = lerp(lerp(R.gapSec.min[0], R.gapSec.max[0], rng()), lerp(R.gapSec.min[1], R.gapSec.max[1], rng()), p);
    const gap = speed * sec;
    // 다음 장애물 전까지 빈 구간에 젤리 줄
    if (rng() < R.jellyPerGapChance) {
      const room = gap - 3.8;
      const count = Math.min(6, Math.floor(room / 1.2));
      if (count >= 3) {
        const air = count >= 4 && rng() < 0.35;
        for (let k = 0; k < count; k++) course.jellies.push({ x: x + w + 2.2 + k * 1.2, y: air ? 2.4 : 0.7 });
      }
    }
    x += w + gap;
  }
  course.jellies.sort((a, b) => a.x - b.x);
  return course;
}

/** 고정 시간 간격(ms). 프레임 속도와 상관없이 같은 입력이면 같은 결과가 나온다. */
export const STEP_MS = 1000 / 120;
const MAX_FRAME_MS = 100;
/** 판정을 너그럽게 하는 안쪽 여백 */
const HIT_INSET = 0.12;
const JELLY_R = 0.35;

export class RunGame {
  readonly course: Course;
  /** 달린 거리(u). 플레이어의 왼쪽 끝 위치다. */
  x = 0;
  /** 바닥에서의 높이(u) */
  y = 0;
  vy = 0;
  /** 이번 점프에서 쓴 점프 횟수 */
  jumpsUsed = 0;
  hearts: number = R.hearts;
  invincibleMs = 0;
  elapsedMs = 0;
  jellyCount = 0;
  hits = 0;
  status: RunStatus = 'running';
  readonly collected: boolean[];
  /** 마지막 충돌/점프/젤리 사건. 화면이 효과음을 낼 때 읽고 지운다. */
  events: ('jump' | 'jelly' | 'hit' | 'clear' | 'fail')[] = [];

  private acc = 0;
  private obstacleIdx = 0;
  private jellyIdx = 0;

  constructor(persona: Persona, seed: number) {
    this.course = buildCourse(persona, seed);
    this.collected = this.course.jellies.map(() => false);
  }

  /** 점프. 바닥에서 한 번, 공중에서 한 번 더(총 maxJumps번). */
  jump(): boolean {
    if (this.status !== 'running' || this.jumpsUsed >= R.maxJumps) return false;
    this.vy = this.jumpsUsed === 0 ? R.jumpV : R.doubleJumpV;
    this.jumpsUsed++;
    this.events.push('jump');
    return true;
  }

  /** 실제 경과 시간을 넣는다. 한 번에 너무 긴 시간이 들어와도 MAX_FRAME_MS만 진행한다. */
  advance(dtMs: number): void {
    if (this.status !== 'running' || !(dtMs > 0)) return;
    this.acc += Math.min(dtMs, MAX_FRAME_MS);
    while (this.acc >= STEP_MS && this.status === 'running') {
      this.acc -= STEP_MS;
      this.step(STEP_MS / 1000);
    }
  }

  get speed(): number {
    return speedAt(this.course, this.x) * (this.invincibleMs > 0 ? R.stumbleSpeedMult : 1);
  }

  get distanceM(): number {
    return Math.min(this.course.goalM, Math.floor((this.x / this.course.lengthU) * this.course.goalM));
  }

  get progress(): number {
    return Math.min(1, this.x / this.course.lengthU);
  }

  /** 점수 0~1000: 코스에 깔린 젤리 중 먹은 비율 */
  get score(): number {
    const total = this.course.jellies.length;
    return total === 0 ? 0 : Math.round((1000 * this.jellyCount) / total);
  }

  private step(dt: number): void {
    const c = this.course;
    this.x += this.speed * dt;
    this.vy -= R.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.jumpsUsed = 0;
    }
    this.invincibleMs = Math.max(0, this.invincibleMs - dt * 1000);
    this.elapsedMs += dt * 1000;

    const left = this.x + HIT_INSET;
    const right = this.x + R.playerW - HIT_INSET;

    while (this.obstacleIdx < c.obstacles.length && c.obstacles[this.obstacleIdx].x + c.obstacles[this.obstacleIdx].w < left) this.obstacleIdx++;
    const o = c.obstacles[this.obstacleIdx];
    if (o && this.invincibleMs === 0 && o.x < right && o.x + o.w > left && this.y < o.h - 0.1) {
      this.hearts--;
      this.hits++;
      this.invincibleMs = R.invincibleMs;
      this.events.push('hit');
      if (this.hearts <= 0) {
        this.status = 'failed';
        this.events.push('fail');
        return;
      }
    }

    while (this.jellyIdx < c.jellies.length && c.jellies[this.jellyIdx].x + JELLY_R < this.x) this.jellyIdx++;
    for (let k = this.jellyIdx; k < c.jellies.length && c.jellies[k].x - JELLY_R <= this.x + R.playerW; k++) {
      const j = c.jellies[k];
      if (this.collected[k]) continue;
      if (j.y + JELLY_R >= this.y && j.y - JELLY_R <= this.y + R.playerH) {
        this.collected[k] = true;
        this.jellyCount++;
        this.events.push('jelly');
      }
    }

    if (this.x >= c.lengthU) {
      this.x = c.lengthU;
      this.status = 'cleared';
      this.events.push('clear');
    }
  }
}
