import { BALANCE, PHOTO_CARD_IDS, PHOTO_GRADES, PHOTO_SETS, photoCardId } from './balance';
import { completedSets, parsePhotoId } from './packdata';
import { mulberry32 } from './runner';
import { clampResource } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { CommandResult, Fail, FailReason, GameState } from './types';

/*
 * 포토카드: 티켓으로 뽑고(6등급, 천장), 중복은 조각으로 바꿔 원하는 카드를 만든다.
 * 결과는 씨앗과 "몇 번째 뽑기인가"로만 정해진다. 새로고침해도 같은 번호면 같은 결과라 되돌려 다시 뽑을 수 없다.
 */

const P = BALANCE.photo;
const PULL_SALT = 0x70686f74;

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

const withPhoto = (s: GameState, photo: Partial<GameState['photo']>): GameState => ({ ...s, photo: { ...s.photo, ...photo } });

/** 티켓을 더한다 (싱글·앨범·첫 클리어 보상). 상한을 넘으면 잘라낸다. */
export const addTickets = (s: GameState, n: number): GameState => withPhoto(s, { tickets: Math.min(P.maxTickets, s.photo.tickets + n) });

/** 천장까지 남은 횟수 */
export const pullsToPity = (s: Pick<GameState, 'photo'>): number => P.pityAt - s.photo.pity;

export interface PhotoPullResult {
  id: string;
  set: number;
  grade: number;
  /** 처음 얻은 카드인가 */
  isNew: boolean;
  /** 천장으로 나온 카드인가 */
  pity: boolean;
  /** 이미 가진 카드가 나와서 카드 슬리브 한 장이 같은 등급의 새 세트 카드로 바꿔 준 결과인가 */
  sleeve: boolean;
}

/** 36장을 모두 가졌는가(이 뒤로는 카드 슬리브가 쓸모없다) */
export const hasAllPhotos = (owned: Record<string, number>): boolean => completedSets(owned).length >= PHOTO_SETS;

/** 같은 등급에서 아직 없는 카드가 있는 세트를 찾는다. 뽑힌 세트 다음 번호부터 돌아가며 보고, 없으면 null. */
function freshSetOf(owned: Record<string, number>, set: number, grade: number): number | null {
  for (let k = 1; k < PHOTO_SETS; k++) {
    const next = ((set - 1 + k) % PHOTO_SETS) + 1;
    if (!(owned[photoCardId(next, grade)] > 0)) return next;
  }
  return null;
}

/** n번째(1부터) 뽑기의 등급·세트. pity는 그 뽑기 직전까지 쌓인 천장 카운터. */
export function rollPhoto(seed: number, seq: number, pity: number): { grade: number; set: number; byPity: boolean } {
  const rng = mulberry32(mix(seed ^ PULL_SALT, seq));
  rng(); // 첫 값은 씨앗과 닮기 쉬워 버린다
  const r = rng();
  const set = 1 + Math.floor(rng() * PHOTO_SETS);
  const forced = pity + 1 >= P.pityAt;
  let grade: number = PHOTO_GRADES;
  let acc = 0;
  for (let g = 1; g <= PHOTO_GRADES; g++) {
    acc += P.rates[g - 1];
    if (r < acc) {
      grade = g;
      break;
    }
  }
  if (r >= acc) grade = 1;
  if (forced && grade < P.pityGrade) {
    // 천장: 5등급 이상 중에서 원래 확률 비율대로 정한다.
    const top = P.rates.slice(P.pityGrade - 1);
    const total = top.reduce((a, b) => a + b, 0);
    let x = rng() * total;
    grade = P.pityGrade;
    for (let i = 0; i < top.length; i++) {
      x -= top[i];
      if (x < 0) {
        grade = P.pityGrade + i;
        break;
      }
    }
    return { grade, set, byPity: true };
  }
  return { grade, set, byPity: false };
}

export interface SetClaim {
  state: GameState;
  /** 이번에 처음 완성한 세트 번호 */
  sets: number[];
  diamonds: number;
}

/** 새로 완성된 세트의 일회성 다이아를 지급한다. */
export function settleSets(s: GameState): SetClaim {
  const sets = completedSets(s.photo.owned).filter((x) => !s.photo.claimedSets.includes(x));
  if (sets.length === 0) return { state: s, sets, diamonds: 0 };
  const diamonds = sets.length * P.setDiamonds;
  return { state: { ...withPhoto(s, { claimedSets: [...s.photo.claimedSets, ...sets] }), diamonds: clampResource(s.diamonds + diamonds) }, sets, diamonds };
}

export function photoPull(state: GameState, count = 1): CommandResult<{ results: PhotoPullResult[]; sets: number[]; diamonds: number }> {
  if (count < 1 || state.photo.tickets < count) return fail(state, 'no_ticket');
  const owned = { ...state.photo.owned };
  let pity = state.photo.pity;
  let pulls = state.photo.pulls;
  let sleeves = state.mart.sleeves;
  const results: PhotoPullResult[] = [];
  for (let i = 0; i < count; i++) {
    pulls += 1;
    const roll = rollPhoto(state.photo.seed, pulls, pity);
    let set = roll.set;
    let sleeve = false;
    // 이미 가진 카드가 나왔고 슬리브가 있으면 같은 등급의 새 카드로 바꾼다(바꿀 카드가 없으면 슬리브는 그대로 남는다)
    if (sleeves > 0 && owned[photoCardId(set, roll.grade)] > 0) {
      const fresh = freshSetOf(owned, set, roll.grade);
      if (fresh !== null) {
        set = fresh;
        sleeve = true;
        sleeves -= 1;
      }
    }
    const id = photoCardId(set, roll.grade);
    results.push({ id, set, grade: roll.grade, isNew: !(owned[id] > 0), pity: roll.byPity, sleeve });
    owned[id] = (owned[id] ?? 0) + 1;
    pity = roll.grade >= P.pityGrade ? 0 : pity + 1;
  }
  const withSleeves = sleeves === state.mart.sleeves ? state : { ...state, mart: { ...state.mart, sleeves } };
  const pulled = track(withPhoto(withSleeves, { owned, pity, pulls, tickets: state.photo.tickets - count }), 'pulls', count);
  const claim = settleSets(pulled);
  return { ok: true, state: claim.state, results, sets: claim.sets, diamonds: claim.diamonds };
}

/** 다이아로 티켓을 산다. */
export function buyTickets(state: GameState, n: number): CommandResult<{ cost: number }> {
  const count = Math.max(1, Math.min(P.maxBuy, Math.floor(n)));
  const cost = count * P.ticketDiamonds;
  if (state.photo.tickets + count > P.maxTickets) return fail(state, 'already_done');
  if (state.diamonds < cost) return fail(state, 'insufficient_diamonds');
  return { ok: true, state: withPhoto({ ...state, diamonds: state.diamonds - cost }, { tickets: state.photo.tickets + count }), cost };
}

/** 중복 카드 한 장을 조각으로 바꾼다. (한 장은 남긴다) */
export function dismantlePhoto(state: GameState, id: string): CommandResult<{ shards: number }> {
  const g = parsePhotoId(id);
  if (!g) return fail(state, 'not_found');
  if ((state.photo.owned[id] ?? 0) < 2) return fail(state, 'need_duplicate');
  const shards = P.shardValue[g.grade - 1];
  return { ok: true, state: withPhoto(state, { owned: { ...state.photo.owned, [id]: state.photo.owned[id] - 1 }, shards: state.photo.shards + shards }), shards };
}

/** 조각으로 아직 없는 카드를 만든다. */
export function craftPhoto(state: GameState, id: string): CommandResult<{ cost: number; sets: number[]; diamonds: number }> {
  const g = parsePhotoId(id);
  if (!g) return fail(state, 'not_found');
  if ((state.photo.owned[id] ?? 0) > 0) return fail(state, 'owned');
  const cost = P.craftCost[g.grade - 1];
  if (state.photo.shards < cost) return fail(state, 'insufficient_coins');
  const crafted = withPhoto(state, { owned: { ...state.photo.owned, [id]: 1 }, shards: state.photo.shards - cost });
  const claim = settleSets(crafted);
  return { ok: true, state: claim.state, cost, sets: claim.sets, diamonds: claim.diamonds };
}

/* ---------- 교환소(서버)가 쓰는 카드 이동 ---------- */

/** 교환에 내놓거나 보낼 카드 한 장을 뺀다. 중복(2장 이상)만 낼 수 있다. */
export function takeCard(state: GameState, id: string): CommandResult {
  if (!parsePhotoId(id)) return fail(state, 'not_found');
  if ((state.photo.owned[id] ?? 0) < 2) return fail(state, 'need_duplicate');
  return { ok: true, state: withPhoto(state, { owned: { ...state.photo.owned, [id]: state.photo.owned[id] - 1 } }) };
}

/** 받은(돌려받은) 카드를 더한다. 세트가 완성되면 보상도 준다. */
export function giveCard(state: GameState, id: string, countTrade = false): CommandResult<{ sets: number[]; diamonds: number }> {
  if (!parsePhotoId(id)) return fail(state, 'not_found');
  const added = withPhoto(state, { owned: { ...state.photo.owned, [id]: (state.photo.owned[id] ?? 0) + 1 } });
  const claim = settleSets(countTrade ? track(added, 'trades') : added);
  return { ok: true, state: claim.state, sets: claim.sets, diamonds: claim.diamonds };
}

export const photoOwnedCount = (s: Pick<GameState, 'photo'>): number => PHOTO_CARD_IDS.filter((id) => s.photo.owned[id] > 0).length;
