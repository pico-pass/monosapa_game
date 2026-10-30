import { BALANCE } from './balance';
import { POST_RESULT_COMMENTS } from './content';
import { mulberry32 } from './runner';
import { clampResource, fanGainMult, levelUpDiamonds } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { CommandResult, Fail, FailReason, GameState, Monogram, Post, PostKind } from './types';

/*
 * 모노그램(가상 SNS). 게시물을 올려 두면 끝나는 시각 뒤에 팬이 모인다.
 * 결과(보통·바이럴·악플)는 씨앗과 게시물 번호로만 정해진다.
 */

const G = BALANCE.monogram;
const POST_SALT = 0x706f7374;

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export function emptyMonogram(seed: number): Monogram {
  return { seed, seq: 0, slots: G.baseSlots, posts: [] };
}

export type PostOutcome = 'normal' | 'viral' | 'hate';

const postNo = (id: string) => Number(id.slice(5)) || 0;

/** 게시물 하나의 결과. 같은 씨앗·번호면 항상 같다. */
export function postOutcome(seed: number, id: string): { outcome: PostOutcome; diamonds: number } {
  const rng = mulberry32(mix(seed ^ POST_SALT, postNo(id)));
  rng(); // 첫 값은 씨앗과 닮기 쉬워 버린다
  const r = rng();
  if (r < G.viralChance) {
    const [lo, hi] = G.viralDiamonds;
    return { outcome: 'viral', diamonds: lo + Math.floor(rng() * (hi - lo + 1)) };
  }
  if (r < G.viralChance + G.hateChance) return { outcome: 'hate', diamonds: 0 };
  return { outcome: 'normal', diamonds: 0 };
}

/** 팬이 fans명일 때 그 종류 게시물이 모으는 팬(결과·캠페인 배율 전) */
export const postBaseFans = (fans: number, kind: PostKind): number => Math.max(1, Math.ceil(Math.sqrt(fans + G.fansOffset) * G.kinds[kind].k));

const outcomeMult = (o: PostOutcome) => (o === 'viral' ? G.viralMult : o === 'hate' ? G.hateMult : 1);

export interface PostStatus {
  post: Post;
  ready: boolean;
  remainingMs: number;
  /** 지금 수확하면 받는 팬(결과·캠페인 배율 포함) */
  fans: number;
  outcome: PostOutcome;
}

export function postStatuses(s: GameState): PostStatus[] {
  return s.monogram.posts.map((post) => {
    const { outcome } = postOutcome(s.monogram.seed, post.id);
    const fans = Math.max(1, Math.round(postBaseFans(s.fans, post.kind) * fanGainMult(s) * outcomeMult(outcome)));
    const remainingMs = Math.max(0, post.endsAt - s.lastSettledAt);
    return { post, ready: remainingMs === 0, remainingMs, fans, outcome };
  });
}

export const readyPosts = (s: GameState): number => s.monogram.posts.filter((p) => p.endsAt <= s.lastSettledAt).length;

/** 다음 슬롯을 사는 데 드는 다이아. 더 살 수 없으면 null. */
export function nextSlotCost(s: Pick<GameState, 'monogram'>): number | null {
  return G.slotCosts[s.monogram.slots - G.baseSlots] ?? null;
}

export function startPost(state: GameState, kind: PostKind): CommandResult<{ post: Post }> {
  if (!G.kinds[kind]) return fail(state, 'not_found');
  if (state.singles.length < 1) return fail(state, 'need_single');
  if (state.monogram.posts.length >= state.monogram.slots) return fail(state, 'slots_full');
  const seq = state.monogram.seq + 1;
  const post: Post = {
    id: `post-${seq}`,
    kind,
    persona: state.activePersona,
    at: state.lastSettledAt,
    endsAt: state.lastSettledAt + G.kinds[kind].durationMs,
  };
  const next = track({ ...state, monogram: { ...state.monogram, seq, posts: [...state.monogram.posts, post] } }, 'posts');
  return { ok: true, state: next, post };
}

export interface PostCollectInfo {
  post: Post;
  outcome: PostOutcome;
  fans: number;
  /** 바이럴 보상 + 팬이 늘어 레벨이 오르면서 받은 다이아 */
  diamonds: number;
  comment: string;
}

export function collectPost(state: GameState, id: string): CommandResult<PostCollectInfo> {
  const post = state.monogram.posts.find((p) => p.id === id);
  if (!post) return fail(state, 'not_found');
  if (post.endsAt > state.lastSettledAt) return fail(state, 'not_ready');
  const st = postStatuses(state).find((x) => x.post.id === id)!;
  const { diamonds: viralDiamonds } = postOutcome(state.monogram.seed, id);
  const fans = clampResource(state.fans + st.fans);
  const diamonds = viralDiamonds + levelUpDiamonds(state.fans, fans);
  let next: GameState = {
    ...state,
    fans,
    diamonds: clampResource(state.diamonds + diamonds),
    monogram: { ...state.monogram, posts: state.monogram.posts.filter((p) => p.id !== id) },
  };
  if (st.outcome === 'viral') next = track(next, 'virals');
  const pool = POST_RESULT_COMMENTS[st.outcome];
  return { ok: true, state: next, post, outcome: st.outcome, fans: st.fans, diamonds, comment: pool[postNo(id) % pool.length] };
}

/** 슬롯을 하나 더 산다 (다이아). */
export function buySlot(state: GameState): CommandResult<{ cost: number; slots: number }> {
  const cost = nextSlotCost(state);
  if (cost === null) return fail(state, 'max_level');
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  const slots = state.monogram.slots + 1;
  return { ok: true, state: { ...state, diamonds: state.diamonds - cost, monogram: { ...state.monogram, slots } }, cost, slots };
}
