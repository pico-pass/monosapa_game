import { describe, expect, it } from 'vitest';
import { BALANCE, ITEM_IDS, SNACK_IDS, nurtureActionById } from '../balance';
import { beginArcade, finishArcade } from '../arcade';
import { runAutoConcert } from '../commands';
import { nurtureAct, nurtureWaitMs, previewNurture } from '../nurture';
import { createInitialState, validateState } from '../persistence';
import { chocoMult, cooldownMult, itemBonus, milkMult, odenMult, rhymeRate, royaltyBreakdown } from '../selectors';
import { advance, makeReport, settleOffline } from '../simulation';
import { buyItem, buyMeal, buySnack, itemPrice, mealPrice, redeemCoupon, stampMart } from '../shop';
import type { GameState, ItemId, Single } from '../types';

const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 3600_000;
const base = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), ...over });
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const withItem = (s: GameState, id: ItemId, until = s.lastSettledAt + HOUR): GameState => ({ ...s, buffs: { ...s.buffs, item: { id, until } } });
const singles = (n: number): Single[] => Array.from({ length: n }, (_, i) => ({ id: `single-${i + 1}`, persona: 'normal', title: `곡${i + 1}`, releasedAt: T0 }));
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const failReason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);

describe('편의점 상품: 사기와 버프 칸', () => {
  it('상품은 코인으로 사고 간식과 따로 켜진다', () => {
    const s0 = base({ coins: 1e9 });
    const snack = ok(buySnack(s0, 'coffee'));
    const r = ok(buyItem(snack.state, 'oden'));
    expect(r.cost).toBe(itemPrice(snack.state, 'oden'));
    expect(r.state.buffs.snack?.id).toBe('coffee'); // 간식은 그대로
    expect(r.state.buffs.item).toEqual({ id: 'oden', until: T0 + BALANCE.shop.items.oden.durationMs });
    expect(r.state.coins).toBe(snack.state.coins - r.cost);
    expect(r.state.counters.snacks).toBe(2);
  });

  it('가격: 어묵·얼음컵·딸기우유는 간식과 같은 식(기본가 × 25 × 레벨 배율)이다', () => {
    for (const id of ['oden', 'iced', 'milk'] as const) {
      expect(itemPrice(base({ fans: 0 }), id)).toBe(BALANCE.shop.items[id].base * BALANCE.shop.priceMult);
      expect(itemPrice(base({ fans: 20 }), id)).toBe(Math.ceil(BALANCE.shop.items[id].base * BALANCE.shop.priceMult * 1.25));
    }
  });

  it('가격: 코인이 늘어나는 초코바·야식은 인세 N초 분량과 기본 가격 중 큰 쪽이라 후반에도 공짜가 되지 않는다', () => {
    // 팬이 적을 때는 기본 가격이 더 크다
    const early = base({ fans: 100 });
    expect(itemPrice(early, 'choco')).toBe(Math.ceil(BALANCE.shop.items.choco.base * BALANCE.shop.priceMult * (1 + BALANCE.shop.priceLevelStep * (1 + Math.floor(Math.sqrt(100 / BALANCE.level.fansPerStep)) - 1))));
    // 팬이 많을 때는 인세 분량이 더 크다: 어느 자아로 사도 같은 값이고, 인세가 오르면 가격도 오른다
    const rich = base({ fans: 1e7 });
    const perSec = Math.max(royaltyBreakdown(rich, 'normal').perSec, royaltyBreakdown(rich, 'dark').perSec);
    expect(itemPrice(rich, 'choco')).toBe(Math.ceil(perSec * BALANCE.shop.items.choco.incomeSecs!));
    expect(mealPrice(rich)).toBe(Math.ceil(perSec * BALANCE.shop.meal.incomeSecs));
    expect(itemPrice({ ...rich, activePersona: 'dark' }, 'choco')).toBe(itemPrice(rich, 'choco'));
    expect(itemPrice(base({ fans: 2e7 }), 'choco')).toBeGreaterThan(itemPrice(rich, 'choco'));
    // 야식 한 개가 주는 것(상한 +1시간, 효율 70%의 인세)이 가격보다 크지만 수십 배는 아니다
    const gain = perSec * (BALANCE.shop.meal.extraMs / 1000) * BALANCE.offline.efficiency;
    expect(gain / mealPrice(rich)).toBeGreaterThan(1);
    expect(gain / mealPrice(rich)).toBeLessThan(2);
  });

  it('같은 상품은 시간이 더해지고 최대 배수까지만 쌓이며, 다른 상품은 바뀐다', () => {
    let s = base({ coins: 1e12 });
    const d = BALANCE.shop.items.iced.durationMs;
    for (let i = 0; i < BALANCE.shop.maxStack; i++) {
      const r = ok(buyItem(s, 'iced'));
      expect(r.extended).toBe(i > 0);
      s = r.state;
    }
    expect(s.buffs.item?.until).toBe(T0 + d * BALANCE.shop.maxStack);
    expect(failReason(buyItem(s, 'iced'))).toBe('already_done');
    const swapped = ok(buyItem(s, 'milk'));
    expect(swapped.state.buffs.item).toEqual({ id: 'milk', until: T0 + BALANCE.shop.items.milk.durationMs });
  });

  it('코인이 모자라면 못 사고, 끝난 버프는 효과가 없다', () => {
    expect(failReason(buyItem(base({ coins: 10 }), 'choco'))).toBe('insufficient_coins');
    const s = withItem(base(), 'choco', T0 + 10 * MIN);
    expect(chocoMult(s)).toBe(1.5);
    expect(chocoMult(at(s, T0 + 10 * MIN))).toBe(1); // 끝나는 시각부터는 꺼진다
    expect(itemBonus(s, 'oden')).toBe(0); // 다른 상품의 효과는 없다
  });
});

describe('어묵 꼬치: 자동 라임 생산', () => {
  it('켜진 동안 두 자아의 자동 라임 생산이 늘고 인세 코인은 그대로다', () => {
    const plain = base({ fans: 1000 });
    const odeni = withItem(plain, 'oden');
    expect(odenMult(odeni)).toBeCloseTo(1.4);
    for (const persona of ['normal', 'dark'] as const) {
      expect(rhymeRate(odeni, persona)).toBeCloseTo(rhymeRate(plain, persona) * 1.4);
    }
    const a = advance(plain, 10_000).state;
    const b = advance(odeni, 10_000).state;
    expect(b.normalRhymes).toBeCloseTo(a.normalRhymes * 1.4);
    expect(b.coins).toBeCloseTo(a.coins); // 인세는 올리지 않아서 사서 되파는 순환이 없다
    const d = advance({ ...plain, activePersona: 'dark' }, 10_000).state;
    const e = advance({ ...odeni, activePersona: 'dark' }, 10_000).state;
    expect(e.darkRhymes).toBeCloseTo(d.darkRhymes * 1.4);
  });

  it('끝나는 시각에서 구간을 쪼개 계산하고, 한 번에 굴려도 나눠 굴려도 같다', () => {
    const s = withItem(base({ fans: 500 }), 'oden', T0 + 30_000);
    const rate = rhymeRate(base(), 'normal');
    const one = advance(s, 60_000).state;
    expect(one.normalRhymes).toBeCloseTo(rate * 30 * 1.4 + rate * 30);
    let split = s;
    for (let i = 0; i < 60; i++) split = advance(split, 1000).state;
    expect(split.normalRhymes).toBeCloseTo(one.normalRhymes, 6);
    // 이미 끝난 버프는 보너스가 없다
    expect(advance(withItem(base(), 'oden', T0 - 1), 60_000).state.normalRhymes).toBeCloseTo(rate * 60);
  });

  it('어둠 과열 경계와 어묵 끝이 겹쳐도 큰 전진과 작은 전진이 같다', () => {
    const s = withItem(base({ activePersona: 'dark', heat: 60 }), 'oden', T0 + 25_000);
    const one = advance(s, 120_000).state;
    let split = s;
    for (let i = 0; i < 120; i++) split = advance(split, 1000).state;
    expect(split.darkRhymes).toBeCloseTo(one.darkRhymes, 5);
    expect(split.normalRhymes).toBeCloseTo(one.normalRhymes, 5);
    expect(split.activePersona).toBe(one.activePersona);
  });
});

describe('얼음컵 아메리카노: 아케이드·육성 대기시간', () => {
  it('아케이드 쿨다운이 줄어 확정된다', () => {
    const s = base({ singles: singles(1) });
    const plain = ok(beginArcade(s, 'survival', 'r1'));
    const iced = ok(beginArcade(withItem(s, 'iced'), 'survival', 'r2'));
    const cd = BALANCE.arcade.kinds.survival.cooldownMs;
    expect(plain.state.arcade.survival.cooldownUntil).toBe(T0 + cd);
    expect(iced.state.arcade.survival.cooldownUntil).toBe(T0 + Math.round(cd * 0.7));
    expect(cooldownMult(withItem(s, 'iced'))).toBeCloseTo(0.7);
    // 이미 확정된 쿨다운은 버프가 끝나도 그대로다
    expect(iced.state.arcade.survival.cooldownUntil).toBe(T0 + Math.round(cd * 0.7));
  });

  it('육성 돌보기 대기시간도 줄고, 대기 남은 시간은 상한을 넘지 않는다', () => {
    const fans = BALANCE.nurture.unlockFans;
    const s = base({ fans, coins: 1e12 });
    const plain = ok(nurtureAct(s, 'normal', 'n-feed'));
    const iced = ok(nurtureAct(withItem(s, 'iced'), 'normal', 'n-feed'));
    expect(plain.state.nurture.normal.readyAt['n-feed']).toBe(T0 + BALANCE.nurture.cooldownMs);
    expect(iced.state.nurture.normal.readyAt['n-feed']).toBe(T0 + Math.round(BALANCE.nurture.cooldownMs * 0.7));
    expect(nurtureWaitMs(iced.state, 'normal', 'n-feed')).toBe(Math.round(BALANCE.nurture.cooldownMs * 0.7));
    expect(nurtureWaitMs(at(iced.state, T0 + 42 * 1000), 'normal', 'n-feed')).toBe(0);
  });
});

describe('초코바: 공연·아케이드 코인 보상', () => {
  const stage = () => base({ fans: 1e7, coins: 0 });

  it('자동 공연 코인이 늘고 첫 클리어 보너스는 곱하지 않는다', () => {
    const s = stage();
    const plain = ok(runAutoConcert(s, 'room'));
    const choco = ok(runAutoConcert(withItem(s, 'choco'), 'room'));
    const bonus = plain.outcome.firstClearCoins;
    const baseCoins = plain.outcome.coins - bonus;
    expect(choco.outcome.firstClearCoins).toBe(bonus);
    expect(choco.outcome.coins - bonus).toBe(Math.floor(baseCoins * 1.5));
    expect(choco.state.coins).toBe(choco.outcome.coins);
  });

  it('아케이드 코인 보상이 늘지만 팬·다이아는 그대로다', () => {
    const s = base({ singles: singles(1), fans: 2000 });
    const run = (st: GameState) => {
      const begun = ok(beginArcade(st, 'survival', 'r1'));
      return ok(finishArcade(begun.state, begun.run, 950));
    };
    const plain = run(s);
    const choco = run(withItem(s, 'choco'));
    expect(choco.outcome.coins).toBe(Math.ceil(plain.outcome.coins * 1.5));
    expect(choco.outcome.fans).toBe(plain.outcome.fans);
    expect(choco.outcome.diamonds).toBe(plain.outcome.diamonds);
    expect(BALANCE.arcade.kinds.ticketing.coinSecs.S).toBe(0); // 코인이 없는 종류는 곱해도 0
  });
});

describe('딸기우유: 육성 성장도', () => {
  it('성장도가 늘고 미리보기와 실제 값이 같다', () => {
    const fans = BALANCE.nurture.unlockFans;
    const s = base({ fans, coins: 1e12 });
    const def = nurtureActionById('n-feed')!;
    const plain = previewNurture(s, 'normal', def).xp;
    const milk = withItem(s, 'milk');
    expect(milkMult(milk)).toBeCloseTo(1.5);
    const boosted = previewNurture(milk, 'normal', def).xp;
    expect(boosted).toBeGreaterThan(plain);
    expect(boosted).toBeGreaterThanOrEqual(Math.floor(plain * 1.4));
    expect(boosted).toBeLessThanOrEqual(Math.ceil(plain * 1.6));
    const r = ok(nurtureAct(milk, 'normal', 'n-feed'));
    expect(r.xp).toBe(boosted);
    expect(r.state.nurture.normal.xp).toBe(boosted);
  });
});

describe('야식 컵라면 세트: 오프라인 정산 상한', () => {
  it('사면 하나 늘고 최대 개수에서 멈춘다', () => {
    let s = base({ coins: 1e12 });
    for (let i = 0; i < BALANCE.shop.meal.max; i++) {
      const r = ok(buyMeal(s));
      expect(r.cost).toBe(mealPrice(s));
      s = r.state;
    }
    expect(s.mart.nightMeals).toBe(BALANCE.shop.meal.max);
    expect(failReason(buyMeal(s))).toBe('already_done');
    expect(failReason(buyMeal(base({ coins: 1 })))).toBe('insufficient_coins');
  });

  it('상한을 넘겨 자리를 비웠을 때만 하나를 써서 상한이 1시간 늘어난다', () => {
    const s = base({ mart: { nightMeals: 2, stamps: 0, coupon: null } });
    const cap = 2 * HOUR;
    const r = settleOffline(s, T0 + 5 * HOUR);
    expect(r.meal).toBe(true);
    expect(r.paidMs).toBe(cap + HOUR);
    expect(r.capped).toBe(true);
    expect(r.state.mart.nightMeals).toBe(1);
    expect(makeReport(s, r).meal).toBe(true);
    // 보상은 상한이 늘어난 만큼 더 받는다
    const none = settleOffline(base(), T0 + 5 * HOUR);
    expect(none.meal).toBe(false);
    expect(r.state.normalRhymes).toBeCloseTo(none.state.normalRhymes * 1.5);
  });

  it('상한 안에서 돌아오면 아껴 두고, 상한을 조금만 넘겨도 하나가 쓰인다', () => {
    const s = base({ mart: { nightMeals: 1, stamps: 0, coupon: null } });
    const early = settleOffline(s, T0 + 90 * MIN);
    expect(early.meal).toBe(false);
    expect(early.state.mart.nightMeals).toBe(1);
    const late = settleOffline(s, T0 + 2 * HOUR + 10 * MIN);
    expect(late.meal).toBe(true);
    expect(late.paidMs).toBe(2 * HOUR + 10 * MIN); // 늘어난 상한 안이라 전부 반영
    expect(late.capped).toBe(false);
    expect(late.state.mart.nightMeals).toBe(0);
    // 세트가 없으면 쓰이지 않는다
    expect(settleOffline(base(), T0 + 3 * HOUR).meal).toBe(false);
  });
});

describe('멤버십: 스탬프와 무료 간식 쿠폰', () => {
  const goal = BALANCE.shop.stamps.goal;

  it('간식·상품·야식을 살 때마다 스탬프가 쌓이고 목표를 채우면 쿠폰이 뽑힌다', () => {
    let s = base({ coins: 1e15 });
    for (let i = 0; i < goal - 2; i++) {
      s = ok(i % 2 === 0 ? buySnack(s, SNACK_IDS[(i / 2) % SNACK_IDS.length]) : buyItem(s, ITEM_IDS[((i - 1) / 2) % ITEM_IDS.length])).state;
      expect(s.mart.stamps).toBe(i + 1);
    }
    s = ok(buyMeal(s)).state; // 야식도 스탬프를 준다
    expect(s.mart.stamps).toBe(goal - 1);
    expect(s.mart.coupon).toBeNull();
    s = ok(buySnack(s, 'coffee')).state;
    expect(s.mart.stamps).toBe(0);
    expect(SNACK_IDS).toContain(s.mart.coupon);
  });

  it('쿠폰은 씨앗과 구매 횟수로만 정해져 같은 저장은 같은 쿠폰이 나온다', () => {
    const s = base({ counters: { ...base().counters, snacks: 41 }, mart: { nightMeals: 0, stamps: goal - 1, coupon: null } });
    const a = stampMart(s).mart.coupon;
    expect(stampMart(s).mart.coupon).toBe(a);
    expect(SNACK_IDS).toContain(a);
    // 구매 횟수가 달라지면 쿠폰도 달라질 수 있다(여러 값이 나온다)
    const seen = new Set<string | null>();
    for (let n = 0; n < 200; n++) seen.add(stampMart({ ...s, counters: { ...s.counters, snacks: n } }).mart.coupon);
    expect(seen.size).toBe(SNACK_IDS.length);
  });

  it('쿠폰을 쓰면 돈 없이 그 간식이 켜지고 간식 구매 횟수·스탬프에는 세지 않는다', () => {
    const s = base({ coins: 0, mart: { nightMeals: 0, stamps: 3, coupon: 'lunchbox' } });
    const r = ok(redeemCoupon(s));
    expect(r.snack).toBe('lunchbox');
    expect(r.state.coins).toBe(0);
    expect(r.state.buffs.snack).toEqual({ id: 'lunchbox', until: T0 + BALANCE.shop.snacks.lunchbox.durationMs });
    expect(r.state.mart).toEqual({ nightMeals: 0, stamps: 3, coupon: null });
    expect(r.state.counters.snacks).toBe(s.counters.snacks);
    expect(failReason(redeemCoupon(r.state))).toBe('not_ready');
  });

  it('같은 간식이 켜져 있으면 시간이 더해지고, 더 쌓을 수 없으면 쿠폰이 남는다', () => {
    const d = BALANCE.shop.snacks.kimbap.durationMs;
    const s = { ...base({ mart: { nightMeals: 0, stamps: 0, coupon: 'kimbap' } }), buffs: { snack: { id: 'kimbap' as const, until: T0 + d }, campaign: null, item: null } };
    const r = ok(redeemCoupon(s));
    expect(r.extended).toBe(true);
    expect(r.state.buffs.snack?.until).toBe(T0 + 2 * d);
    const full = { ...s, buffs: { ...s.buffs, snack: { id: 'kimbap' as const, until: T0 + d * BALANCE.shop.maxStack } } };
    expect(failReason(redeemCoupon(full))).toBe('already_done');
    expect(full.mart.coupon).toBe('kimbap');
  });

  it('쿠폰을 쓰기 전에는 스탬프가 목표에서 멈추고, 쓰면 새 쿠폰이 이어서 뽑힌다', () => {
    let s = base({ coins: 1e15, mart: { nightMeals: 0, stamps: 0, coupon: 'coffee' } });
    for (let i = 0; i < goal + 3; i++) s = ok(buySnack(s, SNACK_IDS[i % SNACK_IDS.length])).state;
    expect(s.mart.stamps).toBe(goal); // 더 쌓이지 않는다
    expect(s.mart.coupon).toBe('coffee');
    const used = ok(redeemCoupon(at(s, T0)));
    expect(used.state.mart.stamps).toBe(0);
    expect(SNACK_IDS).toContain(used.state.mart.coupon); // 가득 찼던 스탬프가 새 쿠폰이 된다
  });
});

describe('저장: 새 필드', () => {
  it('편의점 상태와 상품 버프가 저장·불러오기를 거쳐도 그대로다', () => {
    const s = withItem(base({ mart: { nightMeals: 2, stamps: 7, coupon: 'energy' } }), 'milk', T0 + 5 * MIN);
    const v = ok(validateState(JSON.parse(JSON.stringify(s))));
    expect(v.state.buffs.item).toEqual({ id: 'milk', until: T0 + 5 * MIN });
    expect(v.state.mart).toEqual({ nightMeals: 2, stamps: 7, coupon: 'energy' });
  });

  it('예전 저장(필드 없음)은 빈 편의점으로 읽고, 알 수 없는 값은 버리거나 한도로 줄인다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    delete raw.mart;
    raw.buffs = { snack: null, campaign: null };
    const v = ok(validateState(raw));
    expect(v.state.mart).toEqual({ nightMeals: 0, stamps: 0, coupon: null });
    expect(v.state.buffs.item).toBeNull();
    raw.mart = { nightMeals: 99, stamps: 99, coupon: '없는간식' };
    raw.buffs = { snack: null, campaign: null, item: { id: '없는상품', until: 5 } };
    const w = ok(validateState(raw));
    expect(w.state.mart).toEqual({ nightMeals: BALANCE.shop.meal.max, stamps: goalOf(), coupon: null });
    expect(w.state.buffs.item).toBeNull();
    // 모양이 이상하면 거절한다
    expect(validateState({ ...raw, mart: 'x' }).ok).toBe(false);
    expect(validateState({ ...raw, buffs: { snack: null, campaign: null, item: { id: 'oden', until: 'x' } } }).ok).toBe(false);
  });
});

function goalOf(): number {
  return BALANCE.shop.stamps.goal;
}
