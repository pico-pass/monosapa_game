import { BALANCE } from './balance';
import { weekKey } from './missions';
import { bonuses } from './packdata';
import { mulberry32 } from './runner';
import { clampResource, clickPowerOf, equipmentOf, playerLevel, royaltyBreakdown } from './selectors';
import { mix } from './streaming';
import { difficultyOf, type Difficulty } from './towerbattle';
import { track } from './tracking';
import type { CommandResult, Fail, FailReason, GameState, Persona } from './types';

/*
 * 무한의 계단: 층마다 보스가 있고 직접 플레이해서 쓰러뜨린다(전투는 towerbattle.ts). 이 파일은 도전을 시작·정산하는 규칙이다.
 * 내 전투력(레벨·장비·수집품)과 약점 배율은 내 탄의 위력만 정하고, 이기고 지는 건 플레이가 정한다.
 * 주(월요일)마다 층이 1로 돌아가고 최고 기록은 남는다. 보스 탄의 무늬는 (씨앗, 층, 시도 횟수)로 정해진다.
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
  /** 자아별 전투력 비율(내 / 적) */
  ratio: Record<Persona, number>;
  difficulty: Record<Persona, Difficulty>;
}

export const towerRatio = (power: number, enemyPower: number): number => power / Math.max(1e-9, enemyPower);

export function towerStatus(s: GameState): TowerStatus {
  const enemy = towerEnemy(s, s.arcade.tower.floor);
  const power = { normal: 0, dark: 0 } as Record<Persona, number>;
  const ratio = { normal: 0, dark: 0 } as Record<Persona, number>;
  const difficulty = { normal: 'brutal', dark: 'brutal' } as Record<Persona, Difficulty>;
  for (const p of ['normal', 'dark'] as const) {
    power[p] = towerPower(s, p) * (enemy.weak === p ? T.weakMult : 1);
    ratio[p] = towerRatio(power[p], enemy.power);
    difficulty[p] = difficultyOf(ratio[p]);
  }
  return { floor: s.arcade.tower.floor, best: s.arcade.tower.best, cooldownLeftMs: Math.max(0, s.arcade.tower.cooldownUntil - s.lastSettledAt), enemy, power, ratio, difficulty };
}

/** 진행 중인 도전. 시작할 때 층·자아·전투력·씨앗이 고정된다. */
export interface TowerRun {
  /** 도전별 고유 ID. 종료 상태와 함께 보상 중복 지급을 막는다. */
  id: string;
  persona: Persona;
  floor: number;
  enemy: TowerEnemy;
  /** 약점 배율까지 반영한 내 전투력 */
  power: number;
  ratio: number;
  seed: number;
  status: 'running' | 'finished' | 'abandoned';
}

export interface TowerOutcome {
  win: boolean;
  floor: number;
  enemy: TowerEnemy;
  power: number;
  ratio: number;
  coins: number;
  diamonds: number;
  /** 이번 주에 이 층을 처음 깼다(보상이 나왔다) */
  first: boolean;
  newBest: boolean;
}

/**
 * 도전을 시작한다. 쿨다운(failCooldownMs)을 이 시점에 확정하므로 중간에 나가거나 져도 그대로이고, 이기면 풀린다.
 */
export function beginTower(state: GameState, persona: Persona, runId: string): CommandResult<{ run: TowerRun }> {
  if (state.singles.length < 1) return fail(state, 'need_single');
  const t = state.arcade.tower;
  if (t.cooldownUntil > state.lastSettledAt) return fail(state, 'cooldown');
  const enemy = towerEnemy(state, t.floor);
  const power = towerPower(state, persona) * (enemy.weak === persona ? T.weakMult : 1);
  const attempts = t.attempts + 1;
  const run: TowerRun = {
    id: runId,
    persona,
    floor: t.floor,
    enemy,
    power,
    ratio: towerRatio(power, enemy.power),
    seed: mix(seedOf(state) ^ 0x2468ace, t.floor * 131 + attempts),
    status: 'running',
  };
  const next = { ...state, arcade: { ...state.arcade, tower: { ...t, attempts, cooldownUntil: state.lastSettledAt + T.failCooldownMs } } };
  return { ok: true, state: next, run };
}

/** 도전을 정산한다. 같은 도전은 한 번만 정산되고, 주가 바뀌어 층이 달라졌으면 받아들이지 않는다. */
export function finishTower(state: GameState, run: TowerRun, won: boolean): CommandResult<{ outcome: TowerOutcome; run: TowerRun }> {
  if (run.status !== 'running') return fail(state, 'session_closed');
  const t = state.arcade.tower;
  const finished: TowerRun = { ...run, status: 'finished' };
  const base = { floor: run.floor, enemy: run.enemy, power: run.power, ratio: run.ratio };
  if (!won) return { ok: true, state, run: finished, outcome: { ...base, win: false, coins: 0, diamonds: 0, first: false, newBest: false } };
  if (t.floor !== run.floor) return fail(state, 'not_ready');

  const first = !t.claimed.includes(run.floor);
  let coins = 0;
  let diamonds = 0;
  if (first) {
    coins = Math.max(10, Math.ceil(royaltyBreakdown(state, run.persona).perSec * (T.coinSecs + T.coinSecsPerFloor * run.floor)));
    if (run.enemy.boss) diamonds += T.bossDiamonds;
    if (run.floor % T.milestoneEvery === 0) diamonds += T.milestoneDiamonds;
  }
  const best = Math.max(t.best, run.floor);
  const next = track(
    track(
      {
        ...state,
        coins: clampResource(state.coins + coins),
        diamonds: clampResource(state.diamonds + diamonds),
        arcade: {
          ...state.arcade,
          tower: { ...t, floor: run.floor + 1, best, claimed: first ? [...t.claimed, run.floor] : t.claimed, cooldownUntil: state.lastSettledAt + T.winCooldownMs },
        },
      },
      'towerClears',
    ),
    'arcades',
  );
  return { ok: true, state: next, run: finished, outcome: { ...base, win: true, coins, diamonds, first, newBest: run.floor > t.best } };
}

export function abandonTower(run: TowerRun): TowerRun {
  return run.status === 'running' ? { ...run, status: 'abandoned' } : run;
}
