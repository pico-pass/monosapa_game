import { BALANCE } from './balance';
import { weekKey } from './missions';
import { bonuses } from './packdata';
import { mulberry32 } from './runner';
import { clampResource, clickPowerOf, equipmentOf, playerLevel, royaltyBreakdown } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { CommandResult, Fail, FailReason, GameState, Persona } from './types';

/*
 * 무한의 계단: 층마다 적 전투력이 정해져 있고, 내 전투력(레벨·장비·수집품)이 약점 배율과 무작위 ±15%를 곱하고도 모자라면 쓰러진다.
 * 주(월요일)마다 층이 1로 돌아가고 최고 기록은 남는다. 결과는 (씨앗, 층, 시도 횟수)로만 정해진다.
 */

const T = BALANCE.tower;
const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export interface TowerEnemy {
  floor: number;
  power: number;
  boss: boolean;
  /** 이 자아로 도전하면 weakMult배 */
  weak: Persona;
}

const seedOf = (s: Pick<GameState, 'feat'>) => s.feat.seed ^ 0x746f7772;

export function towerEnemy(s: Pick<GameState, 'feat'>, floor: number): TowerEnemy {
  const boss = floor % T.bossEvery === 0;
  const power = T.baseEnemy * T.growth ** (floor - 1) * (boss ? T.bossMult : 1);
  const weak: Persona = mulberry32(mix(seedOf(s), floor))() < 0.5 ? 'normal' : 'dark';
  return { floor, power, boss, weak };
}

/** 그 자아로 도전할 때의 내 전투력(약점 배율 전) */
export function towerPower(s: GameState, persona: Persona): number {
  const e = equipmentOf(s, persona);
  const gear = e.mic + e.studio + e.promotion;
  const click = Math.min(T.clickCap, clickPowerOf(s, persona));
  const base = T.basePower + T.perLevel * (playerLevel(s.fans) - 1);
  return base * (1 + T.perGear * gear + T.perClick * click) * (1 + bonuses(s).power);
}

/** 새 주가 시작됐으면 이번 주 기록을 비운다. 바뀐 게 없으면 같은 상태를 돌려준다. */
export function rollTower(s: GameState): GameState {
  const week = weekKey(s.lastSettledAt);
  if (s.arcade.tower.week === week) return s;
  return { ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, week, floor: 1, claimed: [], cooldownUntil: 0, attempts: 0 } } };
}

export interface TowerStatus {
  floor: number;
  best: number;
  cooldownLeftMs: number;
  enemy: TowerEnemy;
  /** 자아별 도전 전투력(약점 배율 반영) */
  power: Record<Persona, number>;
  /** 자아별 승산: 무작위 범위 안에서 이길 확률 */
  chance: Record<Persona, number>;
}

/** 전투력이 적 전투력을 넘을 확률(균등 ±variance 무작위) */
export function winChance(power: number, enemyPower: number): number {
  const need = enemyPower / Math.max(1e-9, power); // roll이 이 이상이어야 이긴다
  const lo = 1 - T.variance;
  const hi = 1 + T.variance;
  return Math.max(0, Math.min(1, (hi - need) / (hi - lo)));
}

export function towerStatus(s: GameState): TowerStatus {
  const enemy = towerEnemy(s, s.arcade.tower.floor);
  const power = { normal: 0, dark: 0 } as Record<Persona, number>;
  const chance = { normal: 0, dark: 0 } as Record<Persona, number>;
  for (const p of ['normal', 'dark'] as const) {
    power[p] = towerPower(s, p) * (enemy.weak === p ? T.weakMult : 1);
    chance[p] = winChance(power[p], enemy.power);
  }
  return { floor: s.arcade.tower.floor, best: s.arcade.tower.best, cooldownLeftMs: Math.max(0, s.arcade.tower.cooldownUntil - s.lastSettledAt), enemy, power, chance };
}

export interface TowerOutcome {
  win: boolean;
  floor: number;
  enemy: TowerEnemy;
  power: number;
  roll: number;
  coins: number;
  diamonds: number;
  /** 이번 주에 이 층을 처음 깼다(보상이 나왔다) */
  first: boolean;
  newBest: boolean;
}

export function climbTower(state: GameState, persona: Persona): CommandResult<{ outcome: TowerOutcome }> {
  if (state.singles.length < 1) return fail(state, 'need_single');
  const t = state.arcade.tower;
  if (t.cooldownUntil > state.lastSettledAt) return fail(state, 'cooldown');
  const floor = t.floor;
  const enemy = towerEnemy(state, floor);
  const power = towerPower(state, persona) * (enemy.weak === persona ? T.weakMult : 1);
  const rng = mulberry32(mix(seedOf(state) ^ 0x2468ace, floor * 131 + t.attempts));
  rng();
  const roll = 1 + (rng() * 2 - 1) * T.variance;
  const win = power * roll >= enemy.power;
  const attempts = t.attempts + 1;

  if (!win) {
    const next = { ...state, arcade: { ...state.arcade, tower: { ...t, attempts, cooldownUntil: state.lastSettledAt + T.failCooldownMs } } };
    return { ok: true, state: next, outcome: { win, floor, enemy, power, roll, coins: 0, diamonds: 0, first: false, newBest: false } };
  }
  const first = !t.claimed.includes(floor);
  let coins = 0;
  let diamonds = 0;
  if (first) {
    coins = Math.max(10, Math.ceil(royaltyBreakdown(state, persona).perSec * (T.coinSecs + T.coinSecsPerFloor * floor)));
    if (enemy.boss) diamonds += T.bossDiamonds;
    if (floor % T.milestoneEvery === 0) diamonds += T.milestoneDiamonds;
  }
  const best = Math.max(t.best, floor);
  const next = track(
    track(
      {
        ...state,
        coins: clampResource(state.coins + coins),
        diamonds: clampResource(state.diamonds + diamonds),
        arcade: {
          ...state.arcade,
          tower: { ...t, attempts, floor: floor + 1, best, claimed: first ? [...t.claimed, floor] : t.claimed, cooldownUntil: state.lastSettledAt + T.winCooldownMs },
        },
      },
      'towerClears',
    ),
    'arcades',
  );
  return { ok: true, state: next, outcome: { win, floor, enemy, power, roll, coins, diamonds, first, newBest: floor > t.best } };
}
