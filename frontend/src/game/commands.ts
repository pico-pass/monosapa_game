import { BALANCE, STAGES, manualGameOf, type ManualGame } from './balance';
import { pickComments, type AlbumDef } from './content';
import {
  clampResource,
  clickGain,
  clickPowerOf,
  equipmentCost,
  equipmentDef,
  diamondUpgradeCost,
  equipmentOf,
  isPenaltyActive,
  levelUpDiamonds,
  musicPowerCost,
  previewAlbum,
  previewSingle,
  rhymesOf,
  stageDifficulty,
  stageStatus,
  stageTaskGrowth,
  switchStatus,
} from './selectors';
import type {
  Album,
  CommandResult,
  EquipmentKind,
  DiamondUpgradeKind,
  Fail,
  FailReason,
  GameState,
  Persona,
  Single,
  StageId,
  VirtualComment,
} from './types';

/*
 * 모든 명령은 "이미 now까지 정산된 상태"를 받는다. (state.lastSettledAt이 곧 now)
 * 호출자(store)가 명령 직전에 settle을 한 번 돌리고, 명령은 조건 재검사 + 한 번의 상태 변경으로 끝난다.
 * 실패하면 상태를 그대로 돌려준다.
 */

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

const withFlag = (s: GameState, flag: string): GameState =>
  s.tutorialFlags[flag] ? s : { ...s, tutorialFlags: { ...s.tutorialFlags, [flag]: true } };

/* ---------- 작업하기(클릭) ---------- */

/** 입력 상한 검사는 InputLimiter가 맡고, 여기서는 인정된 입력 1회의 효과만 계산한다. */
export function work(state: GameState): CommandResult<{ gained: number }> {
  const gained = clickGain(state);
  const key = state.activePersona === 'normal' ? 'normalRhymes' : 'darkRhymes';
  const next = withFlag({ ...state, [key]: clampResource(state[key] + gained) }, 'work');
  return { ok: true, state: next, gained };
}

/* ---------- 자아 전환 ---------- */

export function switchPersona(state: GameState, target: Persona): CommandResult {
  const st = switchStatus(state, target);
  if (!st.allowed) {
    const reason: FailReason =
      st.reason === 'same'
        ? 'same_persona'
        : st.reason === 'lock'
          ? 'switch_lock'
          : st.reason === 'recovery'
            ? 'recovery'
            : 'heat_too_high';
    return fail(state, reason);
  }
  const next: GameState = {
    ...state,
    activePersona: target,
    switchLockedUntil: state.lastSettledAt + BALANCE.persona.switchLockMs,
    // 어둠으로 재진입에 성공하면 마이크 압수의 재진입 조건은 해소된다.
    recoveryReentryRequired: target === 'dark' ? false : state.recoveryReentryRequired,
  };
  return { ok: true, state: withFlag(next, 'switch') };
}

/* ---------- 싱글 ---------- */

export interface ReleaseInfo {
  single: Single;
  comments: VirtualComment[];
  coins: number;
  fans: number;
  /** 팬이 늘어 플레이어 레벨이 오르면서 받은 다이아 */
  diamonds: number;
}

export function releaseSingle(state: GameState): CommandResult<ReleaseInfo> {
  const persona = state.activePersona;
  const prev = previewSingle(state, persona);
  if (state.singles.length >= BALANCE.maxSingles || !prev.affordable) {
    return fail(state, 'insufficient_rhymes');
  }
  const single: Single = {
    id: `single-${state.singles.length + 1}`,
    persona,
    title: prev.title,
    releasedAt: state.lastSettledAt,
  };
  const rhymeKey = persona === 'normal' ? 'normalRhymes' : 'darkRhymes';
  const fans = clampResource(state.fans + prev.fans);
  const diamonds = levelUpDiamonds(state.fans, fans);
  const next: GameState = withFlag(
    {
      ...state,
      [rhymeKey]: Math.max(0, rhymesOf(state, persona) - prev.needRhymes),
      coins: clampResource(state.coins + prev.coins),
      fans,
      diamonds: clampResource(state.diamonds + diamonds),
      singles: [...state.singles, single],
    },
    'release',
  );
  return {
    ok: true,
    state: next,
    single,
    comments: pickComments(persona, prev.n),
    coins: prev.coins,
    fans: prev.fans,
    diamonds,
  };
}

/* ---------- 장비 ---------- */

export function buyEquipment(
  state: GameState,
  kind: EquipmentKind,
  persona: Persona = 'normal',
): CommandResult<{ cost: number; level: number }> {
  const level = equipmentOf(state, persona)[kind];
  if (level >= equipmentDef(persona).maxLevel) return fail(state, 'max_level');
  const cost = equipmentCost(kind, level, persona);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const key = persona === 'normal' ? 'equipment' : 'darkEquipment';
  const next = withFlag({ ...state, coins: state.coins - cost, [key]: { ...state[key], [kind]: level + 1 } }, 'buy');
  return { ok: true, state: next, cost, level: level + 1 };
}

/* ---------- 클릭 업그레이드 (일반: 순수 음악력, 어둠: 음지 드립력) ---------- */

/** 코인으로 그 속성의 클릭 업그레이드를 1레벨 올린다. 최대 레벨은 없다(코인이 모자라면 실패). */
export function buyMusicPower(state: GameState, persona: Persona = 'normal'): CommandResult<{ cost: number; level: number }> {
  const level = clickPowerOf(state, persona);
  const cost = musicPowerCost(level, persona);
  if (!Number.isFinite(cost) || state.coins < cost) return fail(state, 'insufficient_coins');
  const key = persona === 'normal' ? 'musicPower' : 'dripPower';
  return { ok: true, state: { ...state, coins: state.coins - cost, [key]: level + 1 }, cost, level: level + 1 };
}

/* ---------- 앨범 ---------- */

export interface AlbumInfo {
  album: Album;
  def: AlbumDef;
  /** 1부터 세는 앨범 순번 */
  ordinal: number;
  cost: number;
  fans: number;
  /** 앨범 발매 보상 + 팬이 늘어 레벨이 오르면서 받은 다이아 */
  diamonds: number;
}

/** 카탈로그의 다음 앨범을 발매한다. 발매한 싱글과는 무관하다. */
export function releaseAlbum(state: GameState): CommandResult<AlbumInfo> {
  const preview = previewAlbum(state);
  if (!preview) return fail(state, 'no_more_albums');
  if (!preview.affordable) return fail(state, 'insufficient_coins');
  const { def, index, cost, fans } = preview;
  const album: Album = { id: def.id, title: def.title, type: def.type, releasedAt: state.lastSettledAt };
  const newFans = clampResource(state.fans + fans);
  const diamonds = (BALANCE.diamond.album[index] ?? 0) + levelUpDiamonds(state.fans, newFans);
  const next = withFlag(
    {
      ...state,
      coins: state.coins - cost,
      fans: newFans,
      diamonds: clampResource(state.diamonds + diamonds),
      albums: [...state.albums, album],
    },
    'album',
  );
  return { ok: true, state: next, album, def, ordinal: index + 1, cost, fans, diamonds };
}

/* ---------- 공연 ---------- */

export interface ConcertRun {
  /** 공연별 고유 ID. 종료 상태와 함께 보상 중복 지급을 막는다. */
  id: string;
  stageId: StageId;
  /** 시작 시점에 고정되는 공연 자아 */
  persona: Persona;
  /** 이 공연장의 직접 공연 종류 */
  game: ManualGame;
  /** 시작 시점에 고정되는 난이도(판정 폭 배율의 역수). 타이밍에서만 쓴다. */
  difficulty: number;
  /** 과제를 넘길 때마다 난이도에 곱해지는 배수. 타이밍에서만 쓴다. */
  taskGrowth: number;
  status: 'running' | 'finished' | 'abandoned';
}

export interface ConcertOutcome {
  stageId: StageId;
  mode: 'auto' | 'manual';
  persona: Persona;
  score: number | null;
  coins: number;
  cleared: boolean;
  firstClear: boolean;
  firstClearCoins: number;
  /** 공연장을 처음 클리어해서 받은 다이아 (이미 클리어한 공연장이면 0) */
  diamonds: number;
}

/**
 * 직접 공연 보상 = 기본 코인 × (1 + 점수/1000) × 자아 배율. 클리어하지 못하면 failRewardRate배.
 * 타이밍은 점수 600 이상이 클리어, 모노사파런은 완주가 클리어(cleared로 넘긴다). 어둠 배율은 타이밍 1.5, 모노사파런 4.
 */
export function manualConcertReward(
  baseCoins: number,
  score: number,
  persona: Persona,
  game: ManualGame = 'timing',
  cleared: boolean = score >= BALANCE.concert.clearScore,
): number {
  const mult = game === 'run' ? BALANCE.run.persona[persona].rewardMult : BALANCE.concert.personaRewardMult[persona];
  const raw = baseCoins * (1 + score / 1000) * mult;
  return Math.floor(cleared ? raw : raw * BALANCE.concert.failRewardRate);
}

const stageDef = (id: StageId) => STAGES.find((s) => s.id === id)!;

function checkStage(state: GameState, id: StageId): Fail | null {
  const st = stageStatus(state, id);
  if (!st.unlocked) return fail(state, 'locked');
  if (st.cooldownLeftMs > 0) return fail(state, 'cooldown');
  return null;
}

const startCooldown = (state: GameState, id: StageId): GameState => ({
  ...state,
  concerts: {
    ...state.concerts,
    [id]: { ...state.concerts[id], cooldownUntil: state.lastSettledAt + BALANCE.concert.cooldownMs },
  },
});

export function runAutoConcert(state: GameState, id: StageId): CommandResult<{ outcome: ConcertOutcome }> {
  const blocked = checkStage(state, id);
  if (blocked) return blocked;
  const def = stageDef(id);
  const rec = state.concerts[id];
  const firstClear = !rec.cleared;
  const bonus = firstClear ? def.firstClearCoins : 0;
  const diamonds = firstClear ? def.firstClearDiamonds : 0;
  const started = startCooldown(state, id);
  const next: GameState = {
    ...started,
    coins: clampResource(state.coins + def.baseCoins + bonus),
    diamonds: clampResource(state.diamonds + diamonds),
    concerts: { ...started.concerts, [id]: { ...started.concerts[id], cleared: true } },
  };
  return {
    ok: true,
    state: next,
    outcome: {
      stageId: id,
      mode: 'auto',
      persona: state.activePersona,
      score: null,
      coins: def.baseCoins + bonus,
      cleared: true,
      firstClear,
      firstClearCoins: bonus,
      diamonds,
    },
  };
}

/** 직접 공연 시작: 쿨다운을 이 시점에 확정한다. 중도 포기해도 쿨다운은 유지된다. */
export function beginManualConcert(state: GameState, id: StageId, runId: string): CommandResult<{ run: ConcertRun }> {
  const blocked = checkStage(state, id);
  if (blocked) return blocked;
  return {
    ok: true,
    state: startCooldown(state, id),
    run: {
      id: runId,
      stageId: id,
      persona: state.activePersona,
      game: manualGameOf(id),
      difficulty: stageDifficulty(id),
      taskGrowth: stageTaskGrowth(id),
      status: 'running',
    },
  };
}

export function finishManualConcert(
  state: GameState,
  run: ConcertRun,
  rawScore: number,
  /** 모노사파런처럼 점수와 별개로 클리어가 정해지는 공연이면 넘긴다. 없으면 점수 600 이상이 클리어. */
  clearedOverride?: boolean,
): CommandResult<{ outcome: ConcertOutcome; run: ConcertRun }> {
  if (run.status !== 'running') return fail(state, 'session_closed');
  const score = Math.max(0, Math.min(1000, Math.round(Number.isFinite(rawScore) ? rawScore : 0)));
  const def = stageDef(run.stageId);
  const rec = state.concerts[run.stageId];
  const cleared = clearedOverride ?? score >= BALANCE.concert.clearScore;
  const firstClear = cleared && !rec.cleared;
  const bonus = firstClear ? def.firstClearCoins : 0;
  const diamonds = firstClear ? def.firstClearDiamonds : 0;
  const reward = manualConcertReward(def.baseCoins, score, run.persona, run.game, cleared);
  const next: GameState = {
    ...state,
    coins: clampResource(state.coins + reward + bonus),
    diamonds: clampResource(state.diamonds + diamonds),
    concerts: {
      ...state.concerts,
      [run.stageId]: {
        ...rec,
        cleared: rec.cleared || cleared,
        bestScore: Math.max(rec.bestScore, score),
      },
    },
  };
  return {
    ok: true,
    state: next,
    run: { ...run, status: 'finished' },
    outcome: {
      stageId: run.stageId,
      mode: 'manual',
      persona: run.persona,
      score,
      coins: reward + bonus,
      cleared,
      firstClear,
      firstClearCoins: bonus,
      diamonds,
    },
  };
}

export function abandonConcert(run: ConcertRun): ConcertRun {
  return run.status === 'running' ? { ...run, status: 'abandoned' } : run;
}

/* ---------- 다이아 사용 ---------- */

/** 쿨다운 중인 공연장의 쿨다운을 다이아로 바로 끝낸다. */
export function skipConcertCooldown(state: GameState, id: StageId): CommandResult<{ cost: number }> {
  const st = stageStatus(state, id);
  if (!st.unlocked) return fail(state, 'locked');
  if (st.cooldownLeftMs <= 0) return fail(state, 'nothing_to_skip');
  const cost = BALANCE.diamond.skipCooldown;
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const next: GameState = {
    ...state,
    diamonds: state.diamonds - cost,
    concerts: { ...state.concerts, [id]: { ...state.concerts[id], cooldownUntil: state.lastSettledAt } },
  };
  return { ok: true, state: next, cost };
}

/** 마이크 압수 회복을 다이아로 바로 끝낸다: 생산 패널티 해제, 어둠 재진입 조건 해소, 과열 0. */
export function clearSeizure(state: GameState): CommandResult<{ cost: number }> {
  if (!isPenaltyActive(state)) return fail(state, 'nothing_to_skip');
  const cost = BALANCE.diamond.clearSeizure;
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const next: GameState = {
    ...state,
    diamonds: state.diamonds - cost,
    heat: 0,
    recoveryPenaltyUntil: state.lastSettledAt,
    recoveryReentryRequired: false,
  };
  return { ok: true, state: next, cost };
}

/** 다이아 전용 영구 업그레이드를 1레벨 올린다. */
export function buyDiamondUpgrade(state: GameState, kind: DiamondUpgradeKind): CommandResult<{ cost: number; level: number }> {
  const level = state.diamondUpgrades[kind];
  if (level >= BALANCE.diamond.upgrade.maxLevel) return fail(state, 'max_level');
  const cost = diamondUpgradeCost(kind, level);
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const next: GameState = {
    ...state,
    diamonds: state.diamonds - cost,
    diamondUpgrades: { ...state.diamondUpgrades, [kind]: level + 1 },
  };
  return { ok: true, state: next, cost, level: level + 1 };
}
