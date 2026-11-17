import { BALANCE, featDefById } from './balance';
import { songCardOf } from './packdata';
import { clampResource, fanGainMult, levelUpDiamonds, royaltyBreakdown } from './selectors';
import { mix } from './streaming';
import type { CommandResult, Fail, FailReason, GameState, Persona, Radio, RadioKind, RadioSlot, Single } from './types';

/*
 * 라디오국 「모노사파 FM」. 기기 시간대 0~23시 24칸 편성표(하루가 되풀이된다)를 짜 두면, 정산할 때 지난 정시마다 칸을 계산해 코인·팬을 준다.
 * 시간은 모두 state.lastSettledAt(실제 경과 시간)이고, 시각 계산이 편성표의 시(時)에 묶여서 advance 엔진에는 넣지 않고 정산 방식(스트리밍과 같다)으로 둔다.
 * 시간마다 ±10% 변수는 씨앗과 정시 번호로만 정해서 같은 상태는 같은 결과다. 수치는 balance.ts의 BALANCE.radio.
 * 편성표를 바꾸면 그 전까지 쌓인 시간을 옛 편성표로 먼저 정산한다(새 편성표로 지난 시간을 거슬러 받지 못하게).
 */

const R = BALANCE.radio;
const H = 3600_000;
const SLOTS = 24;
const NOISE_SALT = 0x72616469;
/** 자동 편성이 팬 비율을 코인(인세 초 분량)으로 환산하는 값: 곡 한 칸의 코인과 팬이 비슷한 무게가 되게 한다 */
const FANS_WEIGHT = 250_000;
/** 자동 편성이 곡 후보로 보는 최대 곡 수와 불러올 최대 게스트 수 */
const AUTO_SONGS = 12;
const AUTO_GUESTS = 4;
const AUTO_PASSES = 10;

const OFF: RadioSlot = { k: 'off' };
const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const RADIO_KINDS: readonly RadioKind[] = ['song', 'talk', 'ad', 'guest', 'off'];
export type RadioPeriod = 'day' | 'evening' | 'night';

/** 칸에 붙는 설명(화면이 문구로 바꾼다) */
export type RadioNote = 'talk' | 'afterAd' | 'afterOff' | 'fatigue' | 'streak' | 'switch' | 'guest' | 'tasteGood' | 'tasteBad' | 'missing';

export const radioUnlocked = (fans: number): boolean => fans >= R.unlockFans;

/** 시각이 속한 정시(기기 시간대) */
export function hourStart(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

const hourOfDay = (ms: number): number => new Date(ms).getHours();
export const radioPeriod = (hour: number): RadioPeriod => R.periods[((hour % SLOTS) + SLOTS) % SLOTS];

/** 처음 열었을 때(와 없는 예전 저장)의 라디오: 전부 비어 있고 지금 정시부터 센다 */
export function emptyRadio(now: number, seed: number): Radio {
  return { slots: Array.from({ length: SLOTS }, () => ({ ...OFF })), claimedAt: hourStart(now), seed };
}

const slotAt = (slots: readonly RadioSlot[], i: number): RadioSlot => slots[((i % SLOTS) + SLOTS) % SLOTS] ?? OFF;
const isTalkLike = (s: RadioSlot): boolean => s.k === 'talk' || s.k === 'guest';
/** 연달아 나온 멘트·게스트는 두 번째부터 이어짐 효과가 없다 */
const talkValid = (slots: readonly RadioSlot[], i: number): boolean => isTalkLike(slotAt(slots, i)) && !isTalkLike(slotAt(slots, i - 1));

/* ---------- 칸 계산 ---------- */

interface Ctx {
  state: GameState;
  singles: Map<string, Single>;
  royalty: Record<Persona, number>;
  maxRoyalty: number;
}

function makeCtx(state: GameState): Ctx {
  const royalty = { normal: royaltyBreakdown(state, 'normal').perSec, dark: royaltyBreakdown(state, 'dark').perSec };
  return { state, singles: new Map(state.singles.map((x) => [x.id, x])), royalty, maxRoyalty: Math.max(royalty.normal, royalty.dark) };
}

/** 계산에 쓰는 칸: 없는 곡이나 가지지 않은 게스트는 비운 칸으로 본다. missing은 그 칸 번호. */
function effective(ctx: Ctx, slots: readonly RadioSlot[]): { eff: RadioSlot[]; missing: boolean[] } {
  const missing: boolean[] = [];
  const eff = Array.from({ length: SLOTS }, (_, i) => {
    const s = slotAt(slots, i);
    const bad = (s.k === 'song' && !(s.id !== undefined && ctx.singles.has(s.id))) || (s.k === 'guest' && !(s.id !== undefined && (ctx.state.feat.owned[s.id] ?? 0) > 0 && featDefById(s.id)));
    missing.push(!!bad);
    return bad ? { ...OFF } : s;
  });
  return { eff, missing };
}

const songPersona = (ctx: Ctx, s: RadioSlot): Persona | null => (s.k === 'song' && s.id !== undefined ? (ctx.singles.get(s.id)?.persona ?? null) : null);

/** 곡의 등급 배율 = 곡 카드 등급 × (1 + 리마스터 × 레벨) */
function songQuality(ctx: Ctx, single: Single): number {
  const card = songCardOf(ctx.state.cards, single);
  return R.quality[card.rarity] * (1 + R.remaster * card.remaster);
}

export interface RadioHour {
  hour: number;
  /** 실제 계산에 쓰인 종류(없는 곡·가지지 않은 게스트는 off) */
  kind: RadioKind;
  songId: string | null;
  persona: Persona | null;
  period: RadioPeriod;
  /** 청취자 배율(곡선 × 취향 × 이어짐 × 게스트, 변수 제외) */
  mult: number;
  /** 화면에 보이는 청취자 수(표시용) */
  listeners: number;
  /** 이 칸이 주는 인세 초 분량(변수 포함) */
  coinSecs: number;
  coins: number;
  /** 이 칸이 주는 팬 비율(변수 포함) */
  fansPct: number;
  notes: RadioNote[];
}

/** 시간대 번호 h(0~23) 한 칸의 결과. eff는 effective()를 거친 칸이고 noise는 그 정시의 변수(1이면 변수 없음). */
function evalHour(ctx: Ctx, eff: readonly RadioSlot[], missing: readonly boolean[] | null, h: number, noise: number): RadioHour {
  const slot = slotAt(eff, h);
  const hour = ((h % SLOTS) + SLOTS) % SLOTS;
  const period = radioPeriod(hour);
  const notes: RadioNote[] = [];
  if (missing && missing[hour]) notes.push('missing');
  const persona = songPersona(ctx, slot);
  let mult = R.curve[hour];
  const out: RadioHour = { hour, kind: slot.k, songId: slot.k === 'song' ? (slot.id ?? null) : null, persona, period, mult, listeners: 0, coinSecs: 0, coins: 0, fansPct: 0, notes };
  if (slot.k === 'off') {
    out.listeners = Math.round(Math.sqrt(ctx.state.fans) * R.listenerK * mult);
    return out;
  }

  // 이어짐: 앞 칸들이 청취자를 붙잡거나 놓치게 한다
  let retention = 1;
  for (let i = 1; i <= R.talk.span; i++) {
    if (talkValid(eff, h - i)) {
      retention *= R.talk.next;
      notes.push('talk');
      break;
    }
  }
  const prev = slotAt(eff, h - 1);
  if (prev.k === 'ad') {
    retention *= R.ad.next;
    notes.push('afterAd');
  } else if (prev.k === 'off') {
    retention *= R.off.next;
    notes.push('afterOff');
  }
  mult *= retention;

  if (slot.k !== 'song') {
    out.mult = mult;
    out.listeners = Math.round(Math.sqrt(ctx.state.fans) * R.listenerK * mult);
    if (slot.k === 'ad') {
      out.coinSecs = R.ad.coinSecs * mult * noise;
      out.coins = out.coinSecs * ctx.maxRoyalty;
    } else {
      // 멘트·게스트: 코인은 없지만 팬과 이야기해서 팬이 조금 늘고, 다음 칸들의 청취자를 붙잡는다
      out.fansPct = R.talk.fansPct * mult * noise;
    }
    return out;
  }

  // 곡
  const single = ctx.singles.get(slot.id ?? '')!;
  const taste = R.taste[period][single.persona];
  mult *= taste;
  if (taste > 1) notes.push('tasteGood');
  else if (taste < 1) notes.push('tasteBad');

  for (let i = 1; i <= R.fatigue.window; i++) {
    const p = slotAt(eff, h - i);
    if (p.k === 'song' && p.id === slot.id) {
      mult *= R.fatigue.mult;
      notes.push('fatigue');
      break;
    }
  }
  let streak = 0;
  for (let i = 1; i <= R.streak.max; i++) {
    if (songPersona(ctx, slotAt(eff, h - i)) === single.persona) streak++;
    else break;
  }
  if (streak > 0) {
    mult *= 1 + R.streak.step * streak;
    notes.push('streak');
  }
  const before = songPersona(ctx, prev);
  if (before !== null && before !== single.persona) {
    mult *= R.switchMult;
    notes.push('switch');
  }
  let guest = 0;
  for (const n of [h - 1, h + 1]) {
    const g = slotAt(eff, n);
    const def = g.k === 'guest' && g.id !== undefined ? featDefById(g.id) : undefined;
    if (def) guest += R.guest[def.rarity];
  }
  if (guest > 0) {
    mult *= 1 + guest;
    notes.push('guest');
  }

  const quality = songQuality(ctx, single);
  out.mult = mult;
  out.listeners = Math.round(Math.sqrt(ctx.state.fans) * R.listenerK * mult);
  out.coinSecs = R.song.coinSecs * quality * mult * noise;
  out.coins = out.coinSecs * ctx.royalty[single.persona];
  out.fansPct = R.song.fansPct * quality * mult * noise;
  return out;
}

/** 편성표 하루(24칸)의 예상 결과. 변수를 빼고 계산해서 화면의 미리보기와 자동 편성이 쓴다. */
export interface RadioDay {
  hours: RadioHour[];
  coinSecs: number;
  coins: number;
  fansPct: number;
}

export function radioDay(state: GameState): RadioDay {
  const ctx = makeCtx(state);
  const { eff, missing } = effective(ctx, state.radio.slots);
  const hours = Array.from({ length: SLOTS }, (_, h) => evalHour(ctx, eff, missing, h, 1));
  return { hours, coinSecs: hours.reduce((a, x) => a + x.coinSecs, 0), coins: hours.reduce((a, x) => a + x.coins, 0), fansPct: hours.reduce((a, x) => a + x.fansPct, 0) };
}

/* ---------- 정산 ---------- */

const noiseAt = (seed: number, startMs: number): number => 1 + ((mix((seed ^ NOISE_SALT) >>> 0, Math.floor(startMs / H)) / 4294967296) * 2 - 1) * R.noise;

/** 정산 대기 중인 정시들(시작 시각). 완전히 지난 시간만이고, 마지막 capHours시간만 센다(그보다 오래된 시간은 사라진다). */
function pendingStarts(radio: Radio, now: number): number[] {
  const end = hourStart(now);
  let t = hourStart(Math.max(radio.claimedAt, end - R.capHours * H)); // 정시가 아닌 값이 들어와도 정시로 맞춘다
  const out: number[] = [];
  while (t < end && out.length < R.capHours) {
    out.push(t);
    t += H;
  }
  return out;
}

export interface RadioPending {
  /** 정산 대기 시간 수(완전히 지난 시간만) */
  hours: number;
  coinSecs: number;
  coins: number;
  /** 팬 비율의 합 */
  fansPct: number;
  /** 지금 정산하면 오르는 팬 수(팬 획득 배율 포함) */
  fans: number;
}

export function radioPending(state: GameState): RadioPending {
  const starts = pendingStarts(state.radio, state.lastSettledAt);
  if (starts.length === 0) return { hours: 0, coinSecs: 0, coins: 0, fansPct: 0, fans: 0 };
  const ctx = makeCtx(state);
  const { eff } = effective(ctx, state.radio.slots);
  let coinSecs = 0;
  let coins = 0;
  let fansPct = 0;
  for (const t of starts) {
    const e = evalHour(ctx, eff, null, hourOfDay(t), noiseAt(state.radio.seed, t));
    coinSecs += e.coinSecs;
    coins += e.coins;
    fansPct += e.fansPct;
  }
  return { hours: starts.length, coinSecs, coins: Math.floor(coins), fansPct, fans: Math.floor(state.fans * fansPct * fanGainMult(state)) };
}

export interface RadioPaid {
  hours: number;
  coins: number;
  fans: number;
  /** 팬이 늘어 플레이어 레벨이 오르며 받은 다이아 */
  diamonds: number;
}

/** 쌓인 시간을 정산한다(편성표를 바꾸기 전에도 이걸 거친다). 정산할 시간이 없으면 paid가 null이다. */
export function settleRadio(state: GameState): { state: GameState; paid: RadioPaid | null } {
  const p = radioPending(state);
  if (p.hours === 0) return { state, paid: null };
  const fans = clampResource(state.fans + p.fans);
  const diamonds = levelUpDiamonds(state.fans, fans);
  const next: GameState = {
    ...state,
    coins: clampResource(state.coins + p.coins),
    fans,
    diamonds: clampResource(state.diamonds + diamonds),
    radio: { ...state.radio, claimedAt: hourStart(state.lastSettledAt) },
  };
  return { state: next, paid: { hours: p.hours, coins: p.coins, fans: p.fans, diamonds } };
}

/** 더보기 알림 점: 정산 대기가 alertHours시간 이상이고 받을 코인이 있으면 1 */
export function radioAlerts(state: GameState): number {
  if (!radioUnlocked(state.fans)) return 0;
  const p = radioPending(state);
  return p.hours >= R.alertHours && p.coins > 0 ? 1 : 0;
}

/* ---------- 명령 ---------- */

/** 정산 대기를 받는다. 완전히 지난 시간이 없으면 아직 받을 수 없다. */
export function claimRadio(state: GameState): CommandResult<{ paid: RadioPaid }> {
  if (!radioUnlocked(state.fans)) return fail(state, 'radio_locked');
  const r = settleRadio(state);
  if (!r.paid) return fail(state, 'not_ready');
  return { ok: true, state: r.state, paid: r.paid };
}

/**
 * 한 칸을 바꾼다. 곡은 내 싱글이어야 하고 게스트는 가진 래퍼이며 한 편성표에 한 번씩만 넣는다. 바꾸기 전에 쌓인 시간을 옛 편성표로 먼저 정산한다.
 * song·guest는 id가 필요하고 나머지는 id를 무시한다.
 */
export function setRadioSlot(state: GameState, hour: number, slot: RadioSlot): CommandResult<{ paid: RadioPaid | null }> {
  if (!radioUnlocked(state.fans)) return fail(state, 'radio_locked');
  if (!Number.isInteger(hour) || hour < 0 || hour >= SLOTS || !RADIO_KINDS.includes(slot.k)) return fail(state, 'not_found');
  let next: RadioSlot;
  if (slot.k === 'song') {
    if (slot.id === undefined || !state.singles.some((x) => x.id === slot.id)) return fail(state, 'not_found');
    next = { k: 'song', id: slot.id };
  } else if (slot.k === 'guest') {
    if (slot.id === undefined || !featDefById(slot.id) || (state.feat.owned[slot.id] ?? 0) <= 0) return fail(state, 'not_owned');
    if (state.radio.slots.some((x, i) => i !== hour && x.k === 'guest' && x.id === slot.id)) return fail(state, 'already_done');
    next = { k: 'guest', id: slot.id };
  } else {
    next = { k: slot.k };
  }
  const settled = settleRadio(state);
  const slots = settled.state.radio.slots.map((x, i) => (i === hour ? next : x));
  return { ok: true, state: { ...settled.state, radio: { ...settled.state.radio, slots } }, paid: settled.paid };
}

/** 편성표를 모두 비운다(쌓인 시간은 먼저 정산). */
export function clearRadio(state: GameState): CommandResult<{ paid: RadioPaid | null }> {
  if (!radioUnlocked(state.fans)) return fail(state, 'radio_locked');
  const settled = settleRadio(state);
  const slots = Array.from({ length: SLOTS }, () => ({ ...OFF }));
  return { ok: true, state: { ...settled.state, radio: { ...settled.state.radio, slots } }, paid: settled.paid };
}

/* ---------- 자동 편성 ---------- */

/** 칸 하나를 바꿨을 때 점수가 달라지는 시간들(앞 칸 게스트 · 뒤로 번지는 피로·이어짐)의 합. 코인(인세 초)과 팬을 같은 무게로 더한다. */
function windowScore(ctx: Ctx, slots: readonly RadioSlot[], h: number): number {
  let sum = 0;
  for (let i = -1; i <= Math.max(R.streak.max, R.fatigue.window, R.talk.span); i++) {
    const e = evalHour(ctx, slots, null, h + i, 1);
    sum += e.coinSecs + e.fansPct * FANS_WEIGHT;
  }
  return sum;
}

/**
 * 가진 곡·래퍼로 좋은 편성표를 만든다(순수·결정적). 시간대에 맞는 자아의 좋은 곡을 돌려 가며 채운 뒤,
 * 한 칸씩 곡·멘트·광고·게스트를 바꿔 보며 점수가 오르면 바꾸는 일을 더 오르지 않을 때까지 되풀이한다.
 * 곡이 하나도 없으면 전부 비운 편성표를 돌려준다.
 */
export function autoSlots(state: GameState): RadioSlot[] {
  const ctx = makeCtx(state);
  const songs = [...ctx.singles.values()]
    .map((x) => ({ x, q: songQuality(ctx, x) }))
    .sort((a, b) => b.q - a.q || (a.x.id < b.x.id ? -1 : 1))
    .slice(0, AUTO_SONGS)
    .map((s) => s.x);
  if (songs.length === 0) return Array.from({ length: SLOTS }, () => ({ ...OFF }));
  const guests = Object.keys(state.feat.owned)
    .filter((id) => (state.feat.owned[id] ?? 0) > 0 && featDefById(id))
    .sort((a, b) => R.guest[featDefById(b)!.rarity] - R.guest[featDefById(a)!.rarity] || (a < b ? -1 : 1))
    .slice(0, AUTO_GUESTS);

  // 시작: 시간대에 맞는 자아의 곡(없으면 아무 곡)을 좋은 순서대로 돌려 채운다
  const byPersona: Record<Persona, Single[]> = { normal: songs.filter((x) => x.persona === 'normal'), dark: songs.filter((x) => x.persona === 'dark') };
  const cursor: Record<Persona, number> = { normal: 0, dark: 0 };
  const slots: RadioSlot[] = Array.from({ length: SLOTS }, (_, h) => {
    const want: Persona = radioPeriod(h) === 'night' ? 'dark' : radioPeriod(h) === 'day' ? 'normal' : songs[0].persona;
    const pool = byPersona[want].length > 0 ? byPersona[want] : songs;
    const pick = pool[cursor[want]++ % pool.length];
    return { k: 'song', id: pick.id };
  });

  const options: RadioSlot[] = [...songs.map((x) => ({ k: 'song' as const, id: x.id })), { k: 'talk' }, { k: 'ad' }, ...guests.map((id) => ({ k: 'guest' as const, id }))];
  for (let pass = 0; pass < AUTO_PASSES; pass++) {
    let changed = false;
    for (let h = 0; h < SLOTS; h++) {
      let best = slots[h];
      let bestScore = windowScore(ctx, slots, h);
      for (const opt of options) {
        if (opt.k === best.k && opt.id === best.id) continue;
        if (opt.k === 'guest' && slots.some((x, i) => i !== h && x.k === 'guest' && x.id === opt.id)) continue;
        const prev = slots[h];
        slots[h] = opt;
        const score = windowScore(ctx, slots, h);
        slots[h] = prev;
        if (score > bestScore + 1e-9) {
          best = opt;
          bestScore = score;
        }
      }
      if (best !== slots[h]) {
        slots[h] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return slots;
}

/** 자동 편성으로 바꾼다(쌓인 시간은 먼저 정산). 곡이 하나도 없으면 못 한다. */
export function autoRadio(state: GameState): CommandResult<{ paid: RadioPaid | null }> {
  if (!radioUnlocked(state.fans)) return fail(state, 'radio_locked');
  if (state.singles.length === 0) return fail(state, 'need_single');
  const settled = settleRadio(state);
  const slots = autoSlots(settled.state);
  return { ok: true, state: { ...settled.state, radio: { ...settled.state.radio, slots } }, paid: settled.paid };
}
