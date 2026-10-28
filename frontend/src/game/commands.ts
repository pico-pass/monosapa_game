import { BALANCE, STAGES, manualGameOf, type ManualGame } from './balance';
import { pickComments, type AlbumDef } from './content';
import {
  clampResource,
  equipmentCost,
  previewAlbum,
  previewSingle,
  productionMultiplier,
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
  const gained = BALANCE.click.value * productionMultiplier(state);
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
  const next: GameState = withFlag(
    {
      ...state,
      [rhymeKey]: Math.max(0, rhymesOf(state, persona) - prev.needRhymes),
      coins: clampResource(state.coins + prev.coins),
      fans: clampResource(state.fans + prev.fans),
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
  };
}

/* ---------- 장비 ---------- */

export function buyEquipment(state: GameState, kind: EquipmentKind): CommandResult<{ cost: number; level: number }> {
  const level = state.equipment[kind];
  if (level >= BALANCE.equipment.maxLevel) return fail(state, 'max_level');
  const cost = equipmentCost(kind, level);
  if (state.coins < cost) return fail(state, 'insufficient_coins');
  const next = withFlag(
    { ...state, coins: state.coins - cost, equipment: { ...state.equipment, [kind]: level + 1 } },
    'buy',
  );
  return { ok: true, state: next, cost, level: level + 1 };
}

/* ---------- 앨범 ---------- */

export interface AlbumInfo {
  album: Album;
  def: AlbumDef;
  /** 1부터 세는 앨범 순번 */
  ordinal: number;
  cost: number;
  fans: number;
}

/** 카탈로그의 다음 앨범을 발매한다. 발매한 싱글과는 무관하다. */
export function releaseAlbum(state: GameState): CommandResult<AlbumInfo> {
  const preview = previewAlbum(state);
  if (!preview) return fail(state, 'no_more_albums');
  if (!preview.affordable) return fail(state, 'insufficient_coins');
  const { def, index, cost, fans } = preview;
  const album: Album = { id: def.id, title: def.title, type: def.type, releasedAt: state.lastSettledAt };
  const next = withFlag(
    {
      ...state,
      coins: state.coins - cost,
      fans: clampResource(state.fans + fans),
      albums: [...state.albums, album],
    },
    'album',
  );
  return { ok: true, state: next, album, def, ordinal: index + 1, cost, fans };
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
  const started = startCooldown(state, id);
  const next: GameState = {
    ...started,
    coins: clampResource(state.coins + def.baseCoins + bonus),
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
  const reward = manualConcertReward(def.baseCoins, score, run.persona, run.game, cleared);
  const next: GameState = {
    ...state,
    coins: clampResource(state.coins + reward + bonus),
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
    },
  };
}

export function abandonConcert(run: ConcertRun): ConcertRun {
  return run.status === 'running' ? { ...run, status: 'abandoned' } : run;
}
