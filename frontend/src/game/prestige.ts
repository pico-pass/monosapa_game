import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 월드투어 인크리멘탈: 월클 콘서트의 직접 공연. 곡 하나 동안 무대를 눌러 팬을 모으고, 팬으로 대륙 응원단을 사서 자동으로 팬이 늘게 한다.
 * 곡이 끝나면 팬과 응원단이 전부 리셋되는 대신 그 곡에서 만든 팬만큼 별빛(영구 배율)을 얻고 영구 퍼크를 하나 고른다. 끝이자 시작.
 * 규칙은 React·DOM과 무관하고 무작위(월드 스포트라이트가 뜨는 때와 자리)는 씨앗 난수다. 시간은 고정 50ms 걸음이다. 수치와 규칙 설명은 balance.ts의 BALANCE.prestige.
 */

const B = BALANCE.prestige;
export const STEP_MS = 50;
export const GEN_COUNT = B.gens.length;

export const PERK_IDS = ['tapx', 'autox', 'seed', 'discount', 'luck', 'star'] as const;
export type PerkId = (typeof PERK_IDS)[number];
export const UPGRADE_IDS = ['tap', 'choir'] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export type PrestigeStatus = 'running' | 'picking' | 'finished';

export interface Golden {
  /** 0~1, 무대 안에서의 위치 */
  x: number;
  y: number;
  leftMs: number;
}

export type PrestigeEvent =
  | { type: 'tap'; value: number }
  | { type: 'buy'; kind: 'gen' | 'upgrade'; index: number }
  | { type: 'goldenOn' }
  | { type: 'goldenCatch'; reward: number }
  | { type: 'goldenMiss' }
  | { type: 'waveEnd'; index: number; produced: number; gain: number; ratio: number }
  | { type: 'pick'; offers: PerkId[] }
  | { type: 'wave'; index: number }
  | { type: 'end' };

export interface PrestigeSummary {
  /** 모든 곡에서 만든 팬 합 */
  produced: number;
  /** 얻은 별빛 합 */
  stars: number;
  /** 마지막 영구 배율 */
  mult: number;
  taps: number;
  goldens: number;
  perks: Record<PerkId, number>;
  /** 곡별 열기 목표 달성률(%, 100이 상한) */
  waves: number[];
  seconds: number;
}

export class PrestigeGame {
  readonly persona: Persona;
  readonly seed: number;
  fans = 0;
  /** 이 곡에서 만든 팬(쓴 것도 포함) */
  produced = 0;
  status: PrestigeStatus = 'running';
  waveIdx = 0;
  waveMs = 0;
  elapsedMs = 0;
  gens: number[] = Array.from({ length: GEN_COUNT }, () => 0);
  ups: Record<UpgradeId, number> = { tap: 0, choir: 0 };
  perks: Record<PerkId, number> = { tapx: 0, autox: 0, seed: 0, discount: 0, luck: 0, star: 0 };
  stars = 0;
  /** 곡별로 만든 팬 */
  producedWave: number[] = B.waves.map(() => 0);
  taps = 0;
  goldens = 0;
  golden: Golden | null = null;
  offers: PerkId[] = [];
  /** 방금 끝난 곡에서 얻은 별빛과 그 곡에서 만든 팬(고르는 창에 보인다) */
  lastGain = 0;
  lastProduced = 0;
  /** 바뀔 때마다 오르는 번호 */
  rev = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: PrestigeEvent[] = [];
  private rng: () => number;
  private acc = 0;
  private goldenIn: number;
  private picks = 0;

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.rng = mulberry32(mix(this.seed, 1313));
    this.goldenIn = B.golden.firstMs;
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
  get cash(): number {
    return this.fans;
  }
  /** 영구 배율(별빛이 만든다) */
  get mult(): number {
    return 1 + B.persona[this.persona].starStep * this.stars;
  }
  /** 자동 생산에 곱해지는 배율(영구 배율 × 합창 × 월드 응원단) */
  get autoMult(): number {
    return this.mult * B.upgrades.choir.mult ** this.ups.choir * B.perks.autox.mult ** this.perks.autox;
  }
  /** 초당 팬 */
  get rate(): number {
    let sum = 0;
    for (let i = 0; i < GEN_COUNT; i++) sum += this.gens[i] * B.gens[i].out;
    return sum * this.autoMult;
  }
  get tapValue(): number {
    return (B.baseTap * this.mult + B.tapShare * this.rate) * B.upgrades.tap.mult ** this.ups.tap * B.perks.tapx.mult ** this.perks.tapx;
  }
  genCost(i: number): number {
    const p = B.persona[this.persona];
    return Math.ceil(B.gens[i].cost * p.costMult * B.perks.discount.mult ** this.perks.discount * p.costGrowth ** this.gens[i]);
  }
  upgradeCost(id: UpgradeId): number {
    const p = B.persona[this.persona];
    const u = B.upgrades[id];
    return Math.ceil(u.cost * p.costMult * B.perks.discount.mult ** this.perks.discount * u.growth ** this.ups[id]);
  }
  canBuyGen(i: number): boolean {
    return this.status === 'running' && this.gens[i] < B.genMax && this.fans >= this.genCost(i);
  }
  canBuyUpgrade(id: UpgradeId): boolean {
    return this.status === 'running' && this.ups[id] < B.upgrades[id].max && this.fans >= this.upgradeCost(id);
  }
  /**
   * 곡 i의 열기 목표 달성률(0~1). 팬은 자릿수 단위로 불어나서 자릿수(로그) 기준으로 잰다:
   * 목표만큼 만들면 1, 목표의 1/10^logSpan 이하면 0이고 그 사이는 자릿수에 비례한다.
   */
  waveRatio(i: number): number {
    const goal = B.persona[this.persona].goals[i];
    const v = 1 - (Math.log10(goal) - Math.log10(1 + this.producedWave[i])) / B.logSpan;
    return v < 0 ? 0 : v > 1 ? 1 : v;
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
  get summary(): PrestigeSummary {
    return {
      produced: Math.round(this.producedWave.reduce((a, b) => a + b, 0)),
      stars: this.stars,
      mult: Math.round(this.mult * 100) / 100,
      taps: this.taps,
      goldens: this.goldens,
      perks: { ...this.perks },
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  private emit(e: PrestigeEvent): void {
    this.events.push(e);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  private gain(amount: number): void {
    this.fans += amount;
    this.produced += amount;
    this.producedWave[this.waveIdx] += amount;
  }

  /** 무대를 한 번 눌러 팬을 모은다 */
  tap(): boolean {
    if (this.status !== 'running') return false;
    const v = this.tapValue;
    this.gain(v);
    this.taps += 1;
    this.emit({ type: 'tap', value: v });
    return true;
  }

  buyGen(i: number): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= GEN_COUNT || !this.canBuyGen(i)) return false;
    this.fans -= this.genCost(i);
    this.gens[i] += 1;
    this.rev += 1;
    this.emit({ type: 'buy', kind: 'gen', index: i });
    return true;
  }

  buyUpgrade(id: UpgradeId): boolean {
    if (!UPGRADE_IDS.includes(id) || !this.canBuyUpgrade(id)) return false;
    this.fans -= this.upgradeCost(id);
    this.ups[id] += 1;
    this.rev += 1;
    this.emit({ type: 'buy', kind: 'upgrade', index: UPGRADE_IDS.indexOf(id) });
    return true;
  }

  /** 떠 있는 월드 스포트라이트를 눌러 팬을 한꺼번에 받는다 */
  catchGolden(): boolean {
    if (this.status !== 'running' || !this.golden) return false;
    const reward = Math.max(B.golden.minReward * this.mult, this.rate * B.golden.rewardSec) * (1 + B.perks.luck.reward * this.perks.luck);
    this.gain(reward);
    this.goldens += 1;
    this.golden = null;
    this.scheduleGolden();
    this.rev += 1;
    this.emit({ type: 'goldenCatch', reward });
    return true;
  }

  /** 실제 경과 시간을 넣는다. 영구 퍼크를 고르는 동안과 끝난 뒤에는 시간이 흐르지 않는다. */
  advance(dtMs: number): void {
    if (this.status !== 'running') return;
    this.acc += Math.max(0, Number.isFinite(dtMs) ? dtMs : 0);
    while (this.acc >= STEP_MS && this.status === 'running') {
      this.acc -= STEP_MS;
      this.step();
    }
    if (this.status !== 'running') this.acc = 0;
  }

  /** 영구 퍼크 후보 중 i번째를 고르고 다음 곡을 시작한다(팬과 응원단은 리셋된다). */
  pick(i: number): boolean {
    if (this.status !== 'picking') return false;
    const id = this.offers[i];
    if (!id) return false;
    this.perks[id] += 1;
    this.offers = [];
    this.startNextWave();
    return true;
  }

  private scheduleGolden(): void {
    const gap = (B.golden.minGapMs + this.rng() * (B.golden.maxGapMs - B.golden.minGapMs)) * B.perks.luck.gapRate ** this.perks.luck;
    this.goldenIn = gap;
  }

  private step(): void {
    this.waveMs += STEP_MS;
    this.elapsedMs += STEP_MS;
    const r = this.rate;
    if (r > 0) this.gain(r * (STEP_MS / 1000));

    if (this.golden) {
      this.golden.leftMs -= STEP_MS;
      if (this.golden.leftMs <= 0) {
        this.golden = null;
        this.scheduleGolden();
        this.emit({ type: 'goldenMiss' });
      }
    } else {
      this.goldenIn -= STEP_MS;
      if (this.goldenIn <= 0) {
        this.golden = {
          x: 0.12 + this.rng() * 0.76,
          y: 0.12 + this.rng() * 0.76,
          leftMs: B.golden.lifeMs + B.perks.luck.lifeMs * this.perks.luck,
        };
        this.emit({ type: 'goldenOn' });
      }
    }

    if (this.waveMs >= B.waves[this.waveIdx].ms) this.endWave();
  }

  private endWave(): void {
    const made = this.producedWave[this.waveIdx];
    const gain = Math.floor(Math.log2(1 + made / B.star.div) * (1 + B.perks.star.amp * this.perks.star));
    this.lastProduced = made;
    this.lastGain = gain;
    this.golden = null;
    this.emit({ type: 'waveEnd', index: this.waveIdx, produced: made, gain, ratio: this.waveRatio(this.waveIdx) });
    if (this.waveIdx >= B.waves.length - 1) {
      this.status = 'finished';
      this.emit({ type: 'end' });
      return;
    }
    this.stars += gain;
    const rng = mulberry32(mix(this.seed, 2000 + this.picks++));
    const pool = PERK_IDS.filter((id) => this.perks[id] < B.perkMax);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.offers = pool.slice(0, B.offers);
    this.rev += 1;
    if (this.offers.length === 0) {
      this.startNextWave();
      return;
    }
    this.status = 'picking';
    this.emit({ type: 'pick', offers: [...this.offers] });
  }

  private startNextWave(): void {
    this.waveIdx += 1;
    this.waveMs = 0;
    this.acc = 0;
    this.gens = this.gens.map(() => 0);
    this.ups = { tap: 0, choir: 0 };
    this.produced = 0;
    const lv = this.perks.seed;
    this.fans = lv > 0 ? B.perks.seed.fans[lv - 1] : 0;
    this.golden = null;
    this.goldenIn = B.golden.firstMs * B.perks.luck.gapRate ** this.perks.luck;
    this.status = 'running';
    this.rev += 1;
    this.emit({ type: 'wave', index: this.waveIdx });
  }
}
