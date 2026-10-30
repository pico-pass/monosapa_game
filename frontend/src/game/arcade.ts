import { BALANCE } from './balance';
import { bonuses } from './packdata';
import { clampResource, levelUpDiamonds, royaltyBreakdown } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { ArcadeKind, CommandResult, Fail, FailReason, GameState, Persona } from './types';

/*
 * 아케이드(리듬·생존·가사 덱·피켓팅) 공통 규칙. 콘서트와 같은 방식이다:
 *   시작할 때 쿨다운을 확정한다(포기해도 유지) → 끝나면 점수(0~1000)로 등급을 정하고 보상한다 → 같은 실행은 한 번만 정산한다.
 * 점수를 만드는 게임 규칙은 각 게임 파일(rhythm·survival·lyricdeck·ticketing)에 있다.
 */

export type Grade = 'S' | 'A' | 'B' | 'C';
export type RhythmLevel = 'easy' | 'normal' | 'hard';

const A = BALANCE.arcade;

export function gradeOf(score: number): Grade {
  if (score >= A.grades.S) return 'S';
  if (score >= A.grades.A) return 'A';
  if (score >= A.grades.B) return 'B';
  return 'C';
}

export interface ArcadeRun {
  /** 실행별 고유 ID. 종료 상태와 함께 보상 중복 지급을 막는다. */
  id: string;
  kind: ArcadeKind;
  /** 시작 시점에 고정되는 자아 */
  persona: Persona;
  /** 시작 시점에 고정되는 전투력 보너스(비율) */
  power: number;
  /** 게임이 쓰는 씨앗 */
  seed: number;
  /** 리듬: 고른 싱글 ID */
  target: string | null;
  level: RhythmLevel;
  status: 'running' | 'finished' | 'abandoned';
}

export interface ArcadeOutcome {
  kind: ArcadeKind;
  score: number;
  grade: Grade;
  coins: number;
  fans: number;
  /** A·S 등급에 처음 닿아서 받은 다이아 + 팬이 늘어 레벨이 오르며 받은 다이아 */
  diamonds: number;
  newBest: boolean;
  /** 피켓팅: 다음 공연 코인 배율(매진이면 null) */
  boost: number | null;
  /** 가사 덱: 다음 싱글에 붙는 팬 보너스(비율) */
  lyricBonus: number | null;
}

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const arcadeCooldownLeft = (s: Pick<GameState, 'arcade' | 'lastSettledAt'>, kind: ArcadeKind): number =>
  Math.max(0, s.arcade[kind].cooldownUntil - s.lastSettledAt);

/** 지금 시작할 수 있는가 (첫 싱글 필요 + 쿨다운) */
export function arcadeBlocked(s: GameState, kind: ArcadeKind): FailReason | null {
  if (s.singles.length < 1) return 'need_single';
  if (arcadeCooldownLeft(s, kind) > 0) return 'cooldown';
  return null;
}

export function beginArcade(
  state: GameState,
  kind: ArcadeKind,
  runId: string,
  opts: { target?: string; level?: RhythmLevel } = {},
): CommandResult<{ run: ArcadeRun }> {
  const blocked = arcadeBlocked(state, kind);
  if (blocked) return fail(state, blocked);
  let seed = mix(state.feat.seed ^ 0x61726364, state.arcade[kind].plays + 1 + state.counters.arcades * 7919);
  if (kind === 'rhythm') {
    if (!opts.target || !state.singles.some((x) => x.id === opts.target)) return fail(state, 'not_found');
    // 같은 곡은 항상 같은 채보: 곡 번호와 곡 카드 씨앗으로만 정한다.
    seed = mix(state.cards.seed ^ 0x72687974, Number(opts.target.slice(7)) || 0);
  }
  const record = state.arcade[kind];
  const next = track(
    {
      ...state,
      arcade: { ...state.arcade, [kind]: { ...record, cooldownUntil: state.lastSettledAt + A.kinds[kind].cooldownMs, plays: record.plays + 1 } },
    },
    'arcades',
  );
  return {
    ok: true,
    state: next,
    run: { id: runId, kind, persona: state.activePersona, power: bonuses(state).power, seed, target: opts.target ?? null, level: opts.level ?? 'normal', status: 'running' },
  };
}

const COUNTER = { rhythm: 'rhythms', survival: 'survivals', lyric: 'lyrics', ticketing: 'ticketings' } as const;
const clamp01k = (n: number) => Math.max(0, Math.min(1000, Math.round(Number.isFinite(n) ? n : 0)));

/** 이 점수로 처음 닿는 등급의 다이아(그 대상의 이전 최고 점수 기준) */
export function firstGradeDiamonds(prevBest: number, score: number): number {
  let d = 0;
  if (prevBest < A.grades.A && score >= A.grades.A) d += A.firstDiamonds.A;
  if (prevBest < A.grades.S && score >= A.grades.S) d += A.firstDiamonds.S;
  return d;
}

export function finishArcade(state: GameState, run: ArcadeRun, rawScore: number): CommandResult<{ outcome: ArcadeOutcome; run: ArcadeRun }> {
  if (run.status !== 'running') return fail(state, 'session_closed');
  const score = clamp01k(rawScore);
  const grade = gradeOf(score);
  const k = A.kinds[run.kind];
  const levelMult = run.kind === 'rhythm' ? BALANCE.rhythm.levels[run.level].mult : 1;
  const perSec = royaltyBreakdown(state, run.persona).perSec;
  const coins = k.coinSecs[grade] > 0 ? Math.max(k.minCoins, Math.ceil(perSec * k.coinSecs[grade] * levelMult)) : 0;
  const fans = Math.ceil(state.fans * k.fansPct[grade] * levelMult);
  const newFans = clampResource(state.fans + fans);
  const record = state.arcade[run.kind];

  const prevBest = run.kind === 'rhythm' ? (run.target ? (state.arcade.rhythm.songs[run.target] ?? 0) : 0) : record.best;
  const diamonds = firstGradeDiamonds(prevBest, score) + levelUpDiamonds(state.fans, newFans);
  const best = Math.max(record.best, score);
  let arcade = { ...state.arcade, [run.kind]: { ...record, best } } as GameState['arcade'];
  let boost: number | null = null;
  let lyricBonus: number | null = null;

  if (run.kind === 'rhythm' && run.target) {
    arcade = { ...arcade, rhythm: { ...arcade.rhythm, songs: { ...arcade.rhythm.songs, [run.target]: Math.max(prevBest, score) } } };
  }
  if (run.kind === 'lyric') {
    lyricBonus = BALANCE.lyric.fanBonus[grade];
    arcade = { ...arcade, lyric: { ...arcade.lyric, bonus: Math.max(arcade.lyric.bonus, lyricBonus) } };
  }
  if (run.kind === 'ticketing' && score >= BALANCE.ticketing.failBelow) {
    boost = 1 + score / 1000;
    arcade = { ...arcade, ticketing: { ...arcade.ticketing, boost: { mult: boost, until: state.lastSettledAt + BALANCE.ticketing.boostMs } } };
  }
  const next = track(
    { ...state, coins: clampResource(state.coins + coins), fans: newFans, diamonds: clampResource(state.diamonds + diamonds), arcade },
    COUNTER[run.kind],
  );
  return { ok: true, state: next, run: { ...run, status: 'finished' }, outcome: { kind: run.kind, score, grade, coins, fans, diamonds, newBest: score > prevBest, boost, lyricBonus } };
}

export function abandonArcade(run: ArcadeRun): ArcadeRun {
  return run.status === 'running' ? { ...run, status: 'abandoned' } : run;
}

/** 쿨다운이 끝난 아케이드 종류 수 (알림용) */
export const arcadeReady = (s: GameState): number => (['rhythm', 'survival', 'lyric', 'ticketing'] as const).filter((k) => arcadeBlocked(s, k) === null).length;
