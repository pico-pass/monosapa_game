import { BALANCE, LYRIC_CARDS, LYRIC_CARD_IDS, lyricCardById, type LyricCardDef, type Vowel } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { CommandResult, Fail, FailReason, GameState } from './types';

/*
 * 가사 덱빌딩: turns턴 동안 매 턴 손패를 뽑아 에너지만큼 카드를 낸다.
 * 이어서 낸 카드의 모음이 같으면 라임 체인이 쌓여 위력이 커진다(1 + chain × 체인 수). 끝난 뒤 완성도가 점수가 된다.
 * 모든 무작위는 (씨앗, 카운터)로 정해져서 같은 덱·같은 씨앗이면 같은 손패가 나온다.
 */

const L = BALANCE.lyric;
const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export interface LyricRun {
  seed: number;
  /** 전투력 보너스(위력에 더해진다) */
  power: number;
  rolls: number;
  drawPile: string[];
  discard: string[];
  hand: string[];
  turn: number;
  energy: number;
  total: number;
  lastVowel: Vowel | null;
  chain: number;
  doubleNext: boolean;
  keepNext: boolean;
  status: 'playing' | 'done';
  /** 마지막으로 낸 카드가 더한 완성도(화면 표시용) */
  lastGain: number;
}

const rnd = (seed: number, n: number): number => {
  const r = mulberry32(mix(seed ^ 0x6c797263, n));
  r();
  return r();
};

/** 보유 장수 표를 카드 ID 배열로 편다 (maxDeck장까지) */
export function deckFromCounts(counts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const id of LYRIC_CARD_IDS) for (let i = 0; i < (counts[id] ?? 0); i++) out.push(id);
  return out.slice(0, L.maxDeck);
}

export const deckSize = (counts: Record<string, number>): number => Object.values(counts).reduce((a, b) => a + b, 0);

function shuffled(ids: readonly string[], seed: number, salt: number): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(seed, salt * 1000 + i) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function draw(run: LyricRun, n: number): LyricRun {
  let { drawPile, discard, hand, rolls } = run;
  drawPile = [...drawPile];
  hand = [...hand];
  for (let i = 0; i < n; i++) {
    if (drawPile.length === 0) {
      if (discard.length === 0) break;
      rolls += 1;
      drawPile = shuffled(discard, run.seed, rolls);
      discard = [];
    }
    hand.push(drawPile.shift()!);
  }
  return { ...run, drawPile, discard, hand, rolls };
}

const resetChain = (run: LyricRun): LyricRun => ({ ...run, lastVowel: null, chain: 0, doubleNext: false, keepNext: false });

export function startLyric(counts: Record<string, number>, seed: number, power = 0): LyricRun {
  const base: LyricRun = {
    seed,
    power: Math.max(0, power),
    rolls: 1,
    drawPile: shuffled(deckFromCounts(counts), seed, 1),
    discard: [],
    hand: [],
    turn: 1,
    energy: L.energy,
    total: 0,
    lastVowel: null,
    chain: 0,
    doubleNext: false,
    keepNext: false,
    status: 'playing',
    lastGain: 0,
  };
  return draw(base, L.hand);
}

export const canPlay = (run: LyricRun, handIndex: number): boolean => {
  const def = lyricCardById(run.hand[handIndex] ?? '');
  return run.status === 'playing' && !!def && def.cost <= run.energy;
};

/** 이 카드가 앞 카드와 모음이 달라 체인을 끊는가 (와일드는 끊지 않는다) */
const breaksChain = (run: LyricRun, def: LyricCardDef): boolean =>
  run.lastVowel !== null && run.lastVowel !== 'any' && def.vowel !== 'any' && def.vowel !== run.lastVowel;

/** 이 카드를 지금 내면 더해지는 완성도(미리보기). 효과 카드의 부가 효과는 포함하지 않는다. */
export function previewGain(run: LyricRun, def: LyricCardDef): { gain: number; chain: number } {
  const chain = run.lastVowel === null ? 0 : !breaksChain(run, def) || run.keepNext ? run.chain + 1 : 0;
  const gain = def.power * (1 + L.chain * chain) * (run.doubleNext ? 2 : 1) * (1 + run.power);
  return { gain, chain };
}

export function playCard(run: LyricRun, handIndex: number): LyricRun {
  const def = lyricCardById(run.hand[handIndex] ?? '');
  if (!def || run.status !== 'playing' || def.cost > run.energy) return run;
  const { gain, chain } = previewGain(run, def);
  const broke = breaksChain(run, def);
  let next: LyricRun = {
    ...run,
    hand: run.hand.filter((_, i) => i !== handIndex),
    discard: [...run.discard, def.id],
    energy: run.energy - def.cost + (def.effect === 'energy' ? 1 : 0),
    total: run.total + gain,
    chain,
    // 와일드는 앞 모음을 이어받는다. 처음 낸 카드가 와일드면 모음은 아직 정해지지 않는다.
    lastVowel: def.vowel === 'any' ? run.lastVowel : def.vowel,
    doubleNext: def.effect === 'double',
    // 체인 유지 효과는 한 번 끊김을 막을 때 쓰이고 사라진다.
    keepNext: def.effect === 'keep' || (run.keepNext && !broke),
    lastGain: gain,
  };
  if (def.effect === 'draw') next = draw(next, 1);
  return next;
}

/** 턴을 끝낸다. 마지막 턴이면 곡이 완성된다. */
export function endTurn(run: LyricRun): LyricRun {
  if (run.status !== 'playing') return run;
  const discarded: LyricRun = { ...run, discard: [...run.discard, ...run.hand], hand: [] };
  if (run.turn >= L.turns) return { ...discarded, status: 'done' };
  const next = resetChain({ ...discarded, turn: run.turn + 1, energy: L.energy });
  return draw(next, L.hand);
}

/** 점수 0~1000 = 1000 × 완성도 / target */
export const lyricScore = (run: Pick<LyricRun, 'total'>): number => Math.min(1000, Math.round((1000 * run.total) / L.target));

/** 보상 후보 카드 draft장 (무게에 따라, 서로 다른 카드) */
export function draftChoices(seed: number): string[] {
  const pool = LYRIC_CARDS.filter((c) => c.weight > 0);
  const picks: string[] = [];
  const left = [...pool];
  for (let i = 0; i < L.draft && left.length > 0; i++) {
    const total = left.reduce((a, c) => a + c.weight, 0);
    let x = rnd(seed, 900 + i) * total;
    let idx = 0;
    for (let k = 0; k < left.length; k++) {
      x -= left[k].weight;
      if (x < 0) {
        idx = k;
        break;
      }
    }
    picks.push(left.splice(idx, 1)[0].id);
  }
  return picks;
}

/* ---------- 덱 관리(저장 상태 변경) ---------- */

export function addLyricCard(state: GameState, id: string): CommandResult {
  if (!lyricCardById(id)) return fail(state, 'not_found');
  const cards = state.arcade.lyric.cards;
  if (deckSize(cards) >= L.maxDeck) return fail(state, 'full_slots');
  return { ok: true, state: { ...state, arcade: { ...state.arcade, lyric: { ...state.arcade.lyric, cards: { ...cards, [id]: (cards[id] ?? 0) + 1 } } } } };
}

/** 덱에서 카드 한 장을 뺀다. minDeck장 아래로는 줄일 수 없다. */
export function trimLyricCard(state: GameState, id: string): CommandResult {
  const cards = state.arcade.lyric.cards;
  if ((cards[id] ?? 0) < 1) return fail(state, 'not_owned');
  if (deckSize(cards) <= L.minDeck) return fail(state, 'too_few_cards');
  const next = { ...cards, [id]: cards[id] - 1 };
  if (next[id] === 0) delete next[id];
  return { ok: true, state: { ...state, arcade: { ...state.arcade, lyric: { ...state.arcade.lyric, cards: next } } } };
}
