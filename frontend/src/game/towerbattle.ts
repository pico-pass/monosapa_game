import { BALANCE } from './balance';
import { mulberry32 } from './runner';

/*
 * 무한의 계단 보스전: 위쪽의 보스가 탄을 쏘고, 아래의 마이크(플레이어)가 보스를 자동 조준해 쏜다.
 * 플레이어는 움직여서 탄을 피한다. 고정 시간 단계로만 진행하고 무작위는 씨앗 난수라, 같은 씨앗·같은 입력이면 같은 판이다.
 * 한 발의 위력은 두 전투력의 비율에 비례한다(BALANCE.tower 주석 참고).
 */

const B = BALANCE.tower.battle;

export interface Input {
  x: number;
  y: number;
}

interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export type BattleStatus = 'running' | 'won' | 'lost';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

/** 전투력 비율(내 / 적)로 보는 난이도 */
export function difficultyOf(ratio: number): Difficulty {
  if (ratio >= B.easyRatio) return 'easy';
  if (ratio >= B.normalRatio) return 'normal';
  if (ratio >= B.hardRatio) return 'hard';
  return 'brutal';
}

/** 층별 보스 탄의 세기 */
export function bossTuning(floor: number): { fireMs: number; dmg: number; speed: number } {
  return {
    fireMs: Math.max(B.fireMin, B.fireBase - B.fireStep * floor),
    dmg: Math.min(B.dmgMax, B.dmgBase + B.dmgStep * floor),
    speed: Math.min(B.speedMax, B.speedBase + B.speedStep * floor),
  };
}

export class TowerBattle {
  private readonly rng: () => number;
  private readonly tuning: ReturnType<typeof bossTuning>;
  /** 내 탄 한 발의 위력 */
  readonly shotDmg: number;

  timeMs = 0;
  status: BattleStatus = 'running';
  px = 0;
  py = B.half * 0.7;
  hp: number = B.hp;
  invMs = 0;
  bossX = 0;
  bossY = -B.half * 0.6;
  bossHp: number = B.bossHp;
  shots: Shot[] = [];
  enemyShots: Shot[] = [];
  /** 지금까지 보스가 쏜 횟수 */
  volleys = 0;

  private bossVx = 0;
  private pvx = 0;
  private pvy = 0;
  private fireCd = 900;
  private playerCd = 0;
  private readonly phase: number;
  private acc = 0;

  constructor(
    seed: number,
    readonly floor: number,
    ratio: number,
    readonly bossFloor: boolean,
  ) {
    this.rng = mulberry32(seed);
    this.rng();
    this.phase = this.rng() * Math.PI * 2;
    this.tuning = bossTuning(floor);
    this.shotDmg = B.shotDmg * Math.max(B.ratioMin, Math.min(B.ratioMax, Number.isFinite(ratio) ? ratio : B.ratioMin));
  }

  get bossFrac(): number {
    return Math.max(0, this.bossHp / B.bossHp);
  }

  get hpFrac(): number {
    return Math.max(0, this.hp / B.hp);
  }

  private enraged(): boolean {
    return this.bossFloor || this.bossHp < B.bossHp / 2;
  }

  private fire(angle: number): void {
    const t = this.tuning;
    this.enemyShots.push({ x: this.bossX, y: this.bossY, vx: Math.cos(angle) * t.speed, vy: Math.sin(angle) * t.speed, life: 6 });
  }

  /** 한 단계(stepMs) 진행한다. 끝난 판은 움직이지 않는다. */
  step(input: Input): void {
    if (this.status !== 'running') return;
    const dt = B.stepMs;
    const sec = dt / 1000;
    this.timeMs += dt;
    if (this.timeMs >= B.timeLimitMs) {
      this.status = 'lost';
      return;
    }

    // 플레이어 이동
    let ix = Number.isFinite(input.x) ? input.x : 0;
    let iy = Number.isFinite(input.y) ? input.y : 0;
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    this.pvx = ix * B.playerSpeed;
    this.pvy = iy * B.playerSpeed;
    this.px = Math.max(-B.half, Math.min(B.half, this.px + this.pvx * sec));
    this.py = Math.max(-B.half, Math.min(B.half, this.py + this.pvy * sec));
    this.invMs = Math.max(0, this.invMs - dt);

    // 보스 이동: 플레이어 쪽으로 천천히 따라오며 좌우로 흔들린다
    const targetX = Math.max(-B.half + 3, Math.min(B.half - 3, this.px * 0.6 + 12 * Math.sin(this.timeMs / 1800 + this.phase)));
    const dx = targetX - this.bossX;
    this.bossVx = Math.max(-B.bossSpeed, Math.min(B.bossSpeed, dx * 2));
    this.bossX += this.bossVx * sec;
    this.bossY = -B.half * 0.6 + 3 * Math.sin(this.timeMs / 1100 + this.phase);

    // 보스 발사
    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.volleys += 1;
      this.fireCd += this.tuning.fireMs * (this.enraged() ? 0.8 : 1);
      // 플레이어가 움직이는 쪽을 앞서 겨눈다
      const lead = (Math.hypot(this.px - this.bossX, this.py - this.bossY) / this.tuning.speed) * B.leadFactor;
      const aim = Math.atan2(this.py + this.pvy * lead - this.bossY, this.px + this.pvx * lead - this.bossX);
      const ringEvery = this.bossFloor ? B.ringEvery : this.floor >= B.ringFromFloor ? B.ringEveryNormal : 0;
      if (ringEvery > 0 && this.volleys % ringEvery === 0) {
        const off = this.rng() * Math.PI;
        const count = Math.min(B.ringCountMax, Math.round(B.ringCount + B.ringCountPerFloor * this.floor));
        for (let i = 0; i < count; i++) this.fire(off + (i / count) * Math.PI * 2);
      } else {
        const n = Math.min(B.fanMax, 1 + Math.floor(this.floor / B.fanEvery)) + (this.enraged() ? 1 : 0);
        for (let i = 0; i < n; i++) this.fire(aim + (i - (n - 1) / 2) * B.spread);
        if (this.floor >= B.spiralFromFloor) this.fire(this.volleys * 0.7);
      }
    }

    // 내 발사: 보스의 움직임을 읽어 앞을 겨눈다
    this.playerCd -= dt;
    if (this.playerCd <= 0) {
      this.playerCd += B.playerFireMs;
      const dist = Math.hypot(this.bossX - this.px, this.bossY - this.py);
      const lead = dist / B.shotSpeed;
      const tx = this.bossX + this.bossVx * lead;
      const angle = Math.atan2(this.bossY - this.py, tx - this.px);
      this.shots.push({ x: this.px, y: this.py, vx: Math.cos(angle) * B.shotSpeed, vy: Math.sin(angle) * B.shotSpeed, life: B.shotLife });
    }

    // 내 탄 → 보스
    const alive: Shot[] = [];
    for (const s of this.shots) {
      s.x += s.vx * sec;
      s.y += s.vy * sec;
      s.life -= sec;
      if (s.life <= 0) continue;
      const r = B.bossR + B.shotR;
      if ((s.x - this.bossX) ** 2 + (s.y - this.bossY) ** 2 <= r * r) {
        this.bossHp -= this.shotDmg;
        continue;
      }
      alive.push(s);
    }
    this.shots = alive;
    if (this.bossHp <= 0) {
      this.bossHp = 0;
      this.status = 'won';
      return;
    }

    // 보스 탄 → 나
    const keep: Shot[] = [];
    for (const s of this.enemyShots) {
      s.x += s.vx * sec;
      s.y += s.vy * sec;
      s.life -= sec;
      if (s.life <= 0 || Math.abs(s.x) > B.half + 6 || Math.abs(s.y) > B.half + 6) continue;
      const r = B.playerR + B.enemyShotR;
      if (this.invMs <= 0 && (s.x - this.px) ** 2 + (s.y - this.py) ** 2 <= r * r) {
        this.hp -= this.tuning.dmg;
        this.invMs = B.invincibleMs;
        continue;
      }
      keep.push(s);
    }
    this.enemyShots = keep;
    if (this.hp <= 0) {
      this.hp = 0;
      this.status = 'lost';
    }
  }

  /** 실제 경과 시간(ms)만큼 고정 단계로 진행한다. */
  advance(deltaMs: number, input: Input): void {
    this.acc += Math.max(0, Math.min(deltaMs, 250));
    while (this.acc >= B.stepMs && this.status === 'running') {
      this.acc -= B.stepMs;
      this.step(input);
    }
    if (this.status !== 'running') this.acc = 0;
  }
}
