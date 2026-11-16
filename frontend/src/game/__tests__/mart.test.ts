import { describe, expect, it } from 'vitest';
import { BALANCE, GOODS_IDS, ITEM_IDS, PHOTO_GRADES, PHOTO_SETS, SNACK_IDS, nurtureActionById, photoCardId } from '../balance';
import { hasAllPhotos, photoPull, rollPhoto } from '../photocards';
import { beginArcade, finishArcade } from '../arcade';
import { buyEquipment, runAutoConcert } from '../commands';
import { nurtureAct, nurtureWaitMs, previewNurture } from '../nurture';
import { createInitialState, emptyMart, validateState } from '../persistence';
import { bonuses } from '../packdata';
import { chocoMult, cooldownMult, equipmentCost, goodsBonus, heatUpMult, itemBonus, maxRoyaltyPerSec, milkMult, odenMult, powerBonusNow, previewEquipment, proteinPower, receiptDiscount, rhymeRate, royaltyBreakdown, shopPrice, streamBoostMult, streamCoinsPerSec, streamTotal } from '../selectors';
import { advance, makeReport, settleOffline } from '../simulation';
import { dayKey } from '../missions';
import { buyGoods, buyItem, buyMeal, buyPack, buyReceipt, buyScratch, buySleeve, buySnack, goodsPrice, itemPrice, mealPrice, packPrice, packsLeft, receiptPrice, redeemCoupon, scratchMult, scratchPrice, scratchesLeft, sleevePrice, stampMart } from '../shop';
import { towerPower } from '../tower';
import type { GameState, GoodsId, ItemId, Mart, Single } from '../types';

const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 3600_000;
const base = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), ...over });
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const withItem = (s: GameState, id: ItemId, until = s.lastSettledAt + HOUR): GameState => ({ ...s, buffs: { ...s.buffs, item: { id, until } } });
const mart = (over: Partial<Mart> = {}): Mart => ({ ...emptyMart(), ...over });
const withGoods = (s: GameState, id: GoodsId, until = s.lastSettledAt + HOUR): GameState => ({ ...s, buffs: { ...s.buffs, goods: { id, until } } });
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
    const s = base({ mart: mart({ nightMeals: 2, stamps: 0, coupon: null }) });
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
    const s = base({ mart: mart({ nightMeals: 1, stamps: 0, coupon: null }) });
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
    const s = base({ counters: { ...base().counters, snacks: 41 }, mart: mart({ nightMeals: 0, stamps: goal - 1, coupon: null }) });
    const a = stampMart(s).mart.coupon;
    expect(stampMart(s).mart.coupon).toBe(a);
    expect(SNACK_IDS).toContain(a);
    // 구매 횟수가 달라지면 쿠폰도 달라질 수 있다(여러 값이 나온다)
    const seen = new Set<string | null>();
    for (let n = 0; n < 200; n++) seen.add(stampMart({ ...s, counters: { ...s.counters, snacks: n } }).mart.coupon);
    expect(seen.size).toBe(SNACK_IDS.length);
  });

  it('쿠폰을 쓰면 돈 없이 그 간식이 켜지고 간식 구매 횟수·스탬프에는 세지 않는다', () => {
    const s = base({ coins: 0, mart: mart({ nightMeals: 0, stamps: 3, coupon: 'lunchbox' }) });
    const r = ok(redeemCoupon(s));
    expect(r.snack).toBe('lunchbox');
    expect(r.state.coins).toBe(0);
    expect(r.state.buffs.snack).toEqual({ id: 'lunchbox', until: T0 + BALANCE.shop.snacks.lunchbox.durationMs });
    expect(r.state.mart).toEqual(mart({ nightMeals: 0, stamps: 3, coupon: null }));
    expect(r.state.counters.snacks).toBe(s.counters.snacks);
    expect(failReason(redeemCoupon(r.state))).toBe('not_ready');
  });

  it('같은 간식이 켜져 있으면 시간이 더해지고, 더 쌓을 수 없으면 쿠폰이 남는다', () => {
    const d = BALANCE.shop.snacks.kimbap.durationMs;
    const s = { ...base({ mart: mart({ nightMeals: 0, stamps: 0, coupon: 'kimbap' }) }), buffs: { snack: { id: 'kimbap' as const, until: T0 + d }, campaign: null, item: null, goods: null } };
    const r = ok(redeemCoupon(s));
    expect(r.extended).toBe(true);
    expect(r.state.buffs.snack?.until).toBe(T0 + 2 * d);
    const full = { ...s, buffs: { ...s.buffs, snack: { id: 'kimbap' as const, until: T0 + d * BALANCE.shop.maxStack } } };
    expect(failReason(redeemCoupon(full))).toBe('already_done');
    expect(full.mart.coupon).toBe('kimbap');
  });

  it('쿠폰을 쓰기 전에는 스탬프가 목표에서 멈추고, 쓰면 새 쿠폰이 이어서 뽑힌다', () => {
    let s = base({ coins: 1e15, mart: mart({ nightMeals: 0, stamps: 0, coupon: 'coffee' }) });
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
    const s = withItem(base({ mart: mart({ nightMeals: 2, stamps: 7, coupon: 'energy' }) }), 'milk', T0 + 5 * MIN);
    const v = ok(validateState(JSON.parse(JSON.stringify(s))));
    expect(v.state.buffs.item).toEqual({ id: 'milk', until: T0 + 5 * MIN });
    expect(v.state.mart).toEqual(mart({ nightMeals: 2, stamps: 7, coupon: 'energy' }));
  });

  it('예전 저장(필드 없음)은 빈 편의점으로 읽고, 알 수 없는 값은 버리거나 한도로 줄인다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    delete raw.mart;
    raw.buffs = { snack: null, campaign: null };
    const v = ok(validateState(raw));
    expect(v.state.mart).toEqual(mart({ nightMeals: 0, stamps: 0, coupon: null }));
    expect(v.state.buffs.item).toBeNull();
    raw.mart = { nightMeals: 99, stamps: 99, coupon: '없는간식' };
    raw.buffs = { snack: null, campaign: null, item: { id: '없는상품', until: 5 } };
    const w = ok(validateState(raw));
    expect(w.state.mart).toEqual(mart({ nightMeals: BALANCE.shop.meal.max, stamps: goalOf(), coupon: null }));
    expect(w.state.buffs.item).toBeNull();
    // 모양이 이상하면 거절한다
    expect(validateState({ ...raw, mart: 'x' }).ok).toBe(false);
    expect(validateState({ ...raw, buffs: { snack: null, campaign: null, item: { id: 'oden', until: 'x' } } }).ok).toBe(false);
  });
});

describe('편의점 생활용품: 사기와 두 번째 버프 칸', () => {
  it('생활용품은 코인으로 사고 간식·상품과 따로 켜진다', () => {
    const s0 = base({ coins: 1e9 });
    const a = ok(buySnack(s0, 'coffee'));
    const b = ok(buyItem(a.state, 'oden'));
    const r = ok(buyGoods(b.state, 'icebar'));
    expect(r.cost).toBe(goodsPrice(b.state, 'icebar'));
    expect(r.state.buffs.snack?.id).toBe('coffee');
    expect(r.state.buffs.item?.id).toBe('oden'); // 상품은 그대로
    expect(r.state.buffs.goods).toEqual({ id: 'icebar', until: T0 + BALANCE.shop.goods.icebar.durationMs });
    expect(r.state.coins).toBe(b.state.coins - r.cost);
    expect(r.state.counters.snacks).toBe(3);
    expect(r.state.mart.stamps).toBe(3);
  });

  it('같은 용품은 시간이 더해지고 최대 배수까지만 쌓이며, 다른 용품은 바뀐다', () => {
    let s = base({ coins: 1e12 });
    const d = BALANCE.shop.goods.earbuds.durationMs;
    for (let i = 0; i < BALANCE.shop.maxStack; i++) {
      const r = ok(buyGoods(s, 'earbuds'));
      expect(r.extended).toBe(i > 0);
      s = r.state;
    }
    expect(s.buffs.goods?.until).toBe(T0 + d * BALANCE.shop.maxStack);
    expect(failReason(buyGoods(s, 'earbuds'))).toBe('already_done');
    expect(ok(buyGoods(s, 'protein')).state.buffs.goods).toEqual({ id: 'protein', until: T0 + BALANCE.shop.goods.protein.durationMs });
  });

  it('코인이 모자라면 못 사고, 끝난 버프·다른 용품의 효과는 없다', () => {
    expect(failReason(buyGoods(base({ coins: 10 }), 'protein'))).toBe('insufficient_coins');
    const s = withGoods(base(), 'icebar', T0 + 10 * MIN);
    expect(goodsBonus(s, 'icebar')).toBe(0.4);
    expect(goodsBonus(s, 'earbuds')).toBe(0);
    expect(goodsBonus(at(s, T0 + 10 * MIN), 'icebar')).toBe(0); // 끝나는 시각부터는 꺼진다
    expect(heatUpMult(s)).toBeCloseTo(0.6);
    expect(streamBoostMult(s)).toBe(1);
  });

  it('가격: 수입 N초 분량과 기본 가격 중 큰 쪽이라 후반에도 공짜가 되지 않는다', () => {
    const early = base({ fans: 100 });
    for (const id of GOODS_IDS) expect(goodsPrice(early, id)).toBe(shopPrice(BALANCE.shop.goods[id].base, 100));
    const rich = base({ fans: 1e7 });
    for (const id of ['icebar', 'protein'] as const) expect(goodsPrice(rich, id)).toBe(Math.ceil(maxRoyaltyPerSec(rich) * BALANCE.shop.goods[id].incomeSecs!));
    expect(goodsPrice(rich, 'earbuds')).toBe(Math.ceil(streamCoinsPerSec(rich) * BALANCE.shop.goods.earbuds.incomeSecs!));
    // 수입이 늘면 가격도 오른다(유통사 호감도를 올려도 공짜가 되지 않는다)
    expect(goodsPrice({ ...rich, distributor: 10 }, 'earbuds')).toBeGreaterThan(goodsPrice(rich, 'earbuds'));
    // 이어폰을 다 쓰면 가격의 1.2배쯤 돌려받는다(수십 배가 아니다)
    const gain = streamCoinsPerSec(rich) * BALANCE.shop.goods.earbuds.bonus * (BALANCE.shop.goods.earbuds.durationMs / 1000);
    expect(gain / goodsPrice(rich, 'earbuds')).toBeGreaterThan(1);
    expect(gain / goodsPrice(rich, 'earbuds')).toBeLessThan(1.5);
  });
});

describe('아이스바: 어둠속성 과열', () => {
  const dark = (over: Partial<GameState> = {}) => base({ activePersona: 'dark', heat: 0, ...over });

  it('켜진 동안 과열이 40% 덜 오르고 라임 생산은 그대로다', () => {
    const plain = advance(dark(), 10_000).state;
    const cool = advance(withGoods(dark(), 'icebar'), 10_000).state;
    expect(plain.heat).toBeCloseTo(6);
    expect(cool.heat).toBeCloseTo(3.6);
    expect(cool.darkRhymes).toBeCloseTo(plain.darkRhymes);
  });

  it('끝나는 시각에서 구간을 쪼갠다', () => {
    const s = withGoods(dark(), 'icebar', T0 + 10_000);
    expect(advance(s, 20_000).state.heat).toBeCloseTo(0.36 * 10 + 0.6 * 10);
    // 이미 끝난 버프는 효과가 없다
    expect(advance(withGoods(dark(), 'icebar', T0 - 1), 10_000).state.heat).toBeCloseTo(6);
  });

  it('마이크 압수까지 더 오래 걸린다', () => {
    // 0 → 100이 0.6/s로 약 167초 걸려서 170초 뒤에는 압수당했지만, 아이스바가 켜져 있으면 아직 어둠이다
    const plain = advance(dark(), 170_000).state;
    expect(plain.activePersona).toBe('normal');
    expect(plain.counters.seizures).toBe(1);
    const cool = advance(withGoods(dark(), 'icebar', T0 + HOUR), 170_000).state;
    expect(cool.activePersona).toBe('dark');
    expect(cool.counters.seizures).toBe(0);
    expect(cool.heat).toBeCloseTo(0.36 * 170);
  });

  it('식는 속도와 일반속성은 그대로다', () => {
    const s = withGoods(base({ heat: 50 }), 'icebar');
    expect(advance(s, 10_000).state.heat).toBeCloseTo(40); // 1/s로 식는다
  });

  it('과열 경계(80·100)와 아이스바 끝이 겹쳐도 큰 전진과 작은 전진이 같다', () => {
    const s = withGoods(dark({ heat: 60 }), 'icebar', T0 + 40_000);
    const one = advance(s, 240_000).state;
    let split = s;
    for (let i = 0; i < 240; i++) split = advance(split, 1000).state;
    expect(split.heat).toBeCloseTo(one.heat, 6);
    expect(split.darkRhymes).toBeCloseTo(one.darkRhymes, 4);
    expect(split.normalRhymes).toBeCloseTo(one.normalRhymes, 4);
    expect(split.activePersona).toBe(one.activePersona);
    expect(split.counters.seizures).toBe(one.counters.seizures);
  });

  it('어묵과 아이스바가 함께 켜져도 구간이 맞는다', () => {
    const s = withGoods(withItem(dark({ heat: 40 }), 'oden', T0 + 33_000), 'icebar', T0 + 71_000);
    const one = advance(s, 300_000).state;
    let split = s;
    for (let i = 0; i < 300; i++) split = advance(split, 1000).state;
    expect(split.heat).toBeCloseTo(one.heat, 6);
    expect(split.darkRhymes).toBeCloseTo(one.darkRhymes, 3);
    expect(split.counters.seizures).toBe(one.counters.seizures);
  });
});

describe('무선 이어폰: 스트리밍 속도', () => {
  const fans = 1000;
  const perSec = fans * BALANCE.streaming.perFanPerSec;

  it('켜진 동안 스트리밍이 1.5배로 쌓이고 끝나는 시각에서 쪼갠다', () => {
    const plain = base({ fans });
    expect(streamTotal(advance(plain, 60_000).state.streaming)).toBeCloseTo(perSec * 60, 4);
    expect(streamTotal(advance(withGoods(plain, 'earbuds'), 60_000).state.streaming)).toBeCloseTo(perSec * 60 * 1.5, 4);
    const half = withGoods(plain, 'earbuds', T0 + 30_000);
    expect(streamTotal(advance(half, 60_000).state.streaming)).toBeCloseTo(perSec * 30 * 1.5 + perSec * 30, 4);
    expect(streamTotal(advance(withGoods(plain, 'earbuds', T0 - 1), 60_000).state.streaming)).toBeCloseTo(perSec * 60, 4); // 이미 끝난 버프
  });

  it('한 번에 굴려도 나눠 굴려도 같다', () => {
    const s = withGoods(base({ fans }), 'earbuds', T0 + 25_000);
    const one = advance(s, 90_000).state;
    let split = s;
    for (let i = 0; i < 90; i++) split = advance(split, 1000).state;
    expect(streamTotal(split.streaming)).toBeCloseTo(streamTotal(one.streaming), 3);
    expect(streamTotal(one.streaming)).toBeCloseTo(perSec * 25 * 1.5 + perSec * 65, 3);
  });

  it('라임·인세는 늘지 않고, 다른 용품은 효과가 없다', () => {
    const a = advance(base({ fans }), 60_000).state;
    const b = advance(withGoods(base({ fans }), 'earbuds'), 60_000).state;
    expect(b.normalRhymes).toBeCloseTo(a.normalRhymes);
    expect(b.coins).toBeCloseTo(a.coins);
    expect(streamTotal(advance(withGoods(base({ fans }), 'protein'), 60_000).state.streaming)).toBeCloseTo(perSec * 60, 4);
  });

  it('오프라인 정산에도 켜진 시간만큼 붙는다', () => {
    const s = withGoods(base({ fans }), 'earbuds', T0 + HOUR);
    const r = settleOffline(s, T0 + 2 * HOUR);
    const eff = BALANCE.offline.efficiency;
    expect(streamTotal(r.state.streaming)).toBeCloseTo(perSec * eff * (3600 * 1.5 + 3600), 2);
  });
});

describe('프로틴 바: 전투력', () => {
  it('켜진 동안 영구 전투력 보너스에 +10%가 더해진다', () => {
    const plain = base();
    const protein = withGoods(plain, 'protein');
    expect(proteinPower(plain)).toBe(0);
    expect(proteinPower(protein)).toBeCloseTo(0.1);
    expect(powerBonusNow(protein)).toBeCloseTo(bonuses(protein).power + 0.1);
    expect(powerBonusNow(at(protein, T0 + HOUR))).toBeCloseTo(bonuses(protein).power); // 끝났다
    expect(powerBonusNow(withGoods(plain, 'icebar'))).toBeCloseTo(bonuses(plain).power);
  });

  it('아케이드 판 전투력과 계단 전투력에 모두 붙는다', () => {
    const s = base({ singles: singles(1), fans: 2000 });
    const run = (st: GameState) => ok(beginArcade(st, 'survival', 'r1')).run.power;
    expect(run(withGoods(s, 'protein'))).toBeCloseTo(run(s) + 0.1);
    expect(towerPower(withGoods(s, 'protein'), 'normal')).toBeCloseTo((towerPower(s, 'normal') * (1 + bonuses(s).power + 0.1)) / (1 + bonuses(s).power));
    expect(towerPower(withGoods(s, 'protein'), 'normal')).toBeGreaterThan(towerPower(s, 'normal'));
  });
});

describe('할인 영수증: 다음 장비 구매 할인', () => {
  it('사면 하나 늘고 최대 개수에서 멈추며 스탬프가 쌓인다', () => {
    let s = base({ coins: 1e12 });
    for (let i = 0; i < BALANCE.shop.receipt.max; i++) {
      const r = ok(buyReceipt(s));
      expect(r.cost).toBe(receiptPrice(s));
      s = r.state;
    }
    expect(s.mart.receipts).toBe(BALANCE.shop.receipt.max);
    expect(s.mart.stamps).toBe(BALANCE.shop.receipt.max);
    expect(failReason(buyReceipt(s))).toBe('already_done');
    expect(failReason(buyReceipt(base({ coins: 1 })))).toBe('insufficient_coins');
  });

  it('깎아 주는 코인은 비용의 20%이되 인세 15분 분량을 넘지 않고, 영수증이 없으면 0이다', () => {
    const rich = base({ fans: 1e7, mart: mart({ receipts: 1 }) });
    const perSec = maxRoyaltyPerSec(rich);
    expect(perSec).toBeGreaterThan(0);
    const small = Math.floor(perSec * 60);
    expect(receiptDiscount(rich, small)).toBe(Math.floor(small * BALANCE.shop.receipt.rate)); // 싼 장비는 20%
    expect(receiptDiscount(rich, 1e30)).toBe(Math.floor(perSec * BALANCE.shop.receipt.capSecs)); // 비싼 장비는 한도
    expect(receiptDiscount({ ...rich, mart: mart() }, small)).toBe(0);
    expect(receiptDiscount(rich, 0)).toBe(0);
    expect(receiptDiscount(rich, Infinity)).toBe(0);
  });

  it('가격은 기본가와 인세 10분 분량 중 큰 쪽이고, 한 장의 최대 이득은 가격의 1.5배다', () => {
    expect(receiptPrice(base({ fans: 100 }))).toBe(shopPrice(BALANCE.shop.receipt.base, 100));
    const rich = base({ fans: 1e7, mart: mart({ receipts: 1 }) });
    expect(receiptPrice(rich)).toBe(Math.ceil(maxRoyaltyPerSec(rich) * BALANCE.shop.receipt.incomeSecs));
    expect(receiptDiscount(rich, 1e30) / receiptPrice(rich)).toBeCloseTo(BALANCE.shop.receipt.capSecs / BALANCE.shop.receipt.incomeSecs, 2);
  });

  it('장비를 살 때 한 장이 쓰이고, 미리보기 값과 실제 값이 같다', () => {
    const s = base({ fans: 1e6, coins: 1e12, mart: mart({ receipts: 2 }) });
    const pv = previewEquipment(s, 'studio', 'normal');
    const raw = equipmentCost('studio', 0, 'normal');
    expect(pv.discount).toBe(receiptDiscount(s, raw));
    expect(pv.discount).toBeGreaterThan(0);
    expect(pv.cost).toBe(raw - pv.discount);
    const r = ok(buyEquipment(s, 'studio', 'normal'));
    expect(r.cost).toBe(pv.cost);
    expect(r.discount).toBe(pv.discount);
    expect(r.state.coins).toBe(s.coins - pv.cost);
    expect(r.state.mart.receipts).toBe(1);
    expect(r.state.equipment.studio).toBe(1);
  });

  it('할인된 값으로 살 수 있으면 사진다(원가에는 모자라도)', () => {
    const rich = base({ fans: 1e6, mart: mart({ receipts: 1 }) });
    const raw = equipmentCost('mic', 0, 'normal');
    const discount = receiptDiscount(rich, raw);
    expect(discount).toBeGreaterThan(0);
    const exact = { ...rich, coins: raw - discount };
    expect(ok(buyEquipment(exact, 'mic', 'normal')).state.coins).toBe(0);
    expect(failReason(buyEquipment({ ...exact, mart: mart() }, 'mic', 'normal'))).toBe('insufficient_coins'); // 영수증이 없으면 원가
    // 코인이 모자라 실패하면 영수증은 그대로다
    const poor = { ...rich, coins: raw - discount - 1 };
    const failed = buyEquipment(poor, 'mic', 'normal');
    expect(failed.ok).toBe(false);
    expect(failed.state.mart.receipts).toBe(1);
  });

  it('영수증이 없으면 지금과 똑같이 원가로 산다', () => {
    const s = base({ coins: 1e12 });
    const r = ok(buyEquipment(s, 'mic', 'normal'));
    expect(r.discount).toBe(0);
    expect(r.cost).toBe(equipmentCost('mic', 0, 'normal'));
    expect(r.state.mart).toEqual(s.mart);
    expect(previewEquipment(s, 'mic', 'normal').discount).toBe(0);
  });
});

describe('카드팩: 코인으로 포토카드 티켓', () => {
  it('티켓이 1장 늘고 하루 한도까지 사며, 날짜가 바뀌면 다시 살 수 있다', () => {
    let s = base({ coins: 1e12 });
    expect(packsLeft(s)).toBe(BALANCE.shop.pack.perDay);
    for (let i = 0; i < BALANCE.shop.pack.perDay; i++) {
      const r = ok(buyPack(s));
      expect(r.cost).toBe(packPrice(s));
      expect(r.left).toBe(BALANCE.shop.pack.perDay - i - 1);
      expect(r.state.photo.tickets).toBe(s.photo.tickets + 1);
      expect(r.state.coins).toBe(s.coins - r.cost);
      s = r.state;
    }
    expect(s.mart.packDay).toBe(dayKey(T0));
    expect(s.mart.packs).toBe(BALANCE.shop.pack.perDay);
    expect(s.mart.stamps).toBe(BALANCE.shop.pack.perDay);
    expect(packsLeft(s)).toBe(0);
    expect(failReason(buyPack(s))).toBe('daily_limit');
    const tomorrow = at(s, T0 + 25 * HOUR);
    expect(packsLeft(tomorrow)).toBe(BALANCE.shop.pack.perDay);
    const again = ok(buyPack(tomorrow));
    expect(again.state.mart.packDay).toBe(dayKey(T0 + 25 * HOUR));
    expect(again.state.mart.packs).toBe(1);
  });

  it('코인이 모자라거나 티켓이 가득이면 못 산다', () => {
    expect(failReason(buyPack(base({ coins: 1 })))).toBe('insufficient_coins');
    const full = base({ coins: 1e12 });
    expect(failReason(buyPack({ ...full, photo: { ...full.photo, tickets: BALANCE.photo.maxTickets } }))).toBe('already_done');
  });

  it('가격은 기본가와 인세 30분 분량 중 큰 쪽이다', () => {
    expect(packPrice(base({ fans: 100 }))).toBe(shopPrice(BALANCE.shop.pack.base, 100));
    const rich = base({ fans: 1e7 });
    expect(packPrice(rich)).toBe(Math.ceil(maxRoyaltyPerSec(rich) * BALANCE.shop.pack.incomeSecs));
  });
});

describe('저장: 생활용품·영수증·카드팩', () => {
  it('새 필드가 저장·불러오기를 거쳐도 그대로다', () => {
    const s = withGoods(base({ mart: mart({ receipts: 2, packDay: '2026-11-04', packs: 1 }) }), 'earbuds', T0 + 5 * MIN);
    const v = ok(validateState(JSON.parse(JSON.stringify(s))));
    expect(v.state.buffs.goods).toEqual({ id: 'earbuds', until: T0 + 5 * MIN });
    expect(v.state.mart).toEqual(mart({ receipts: 2, packDay: '2026-11-04', packs: 1 }));
  });

  it('예전 저장은 빈 값으로 읽고, 알 수 없는 값은 버리거나 한도로 줄인다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    raw.mart = { nightMeals: 1, stamps: 2, coupon: null }; // 영수증·카드팩 필드가 없던 때
    raw.buffs = { snack: null, campaign: null, item: null };
    const v = ok(validateState(raw));
    expect(v.state.mart).toEqual(mart({ nightMeals: 1, stamps: 2 }));
    expect(v.state.buffs.goods).toBeNull();
    raw.mart = { nightMeals: 0, stamps: 0, coupon: null, receipts: 99, packDay: '어제', packs: 99 };
    raw.buffs = { snack: null, campaign: null, item: null, goods: { id: '없는용품', until: 5 } };
    const w = ok(validateState(raw));
    expect(w.state.mart).toEqual(mart({ receipts: BALANCE.shop.receipt.max, packDay: '', packs: BALANCE.shop.pack.perDay }));
    expect(w.state.buffs.goods).toBeNull();
    expect(validateState({ ...raw, buffs: { snack: null, campaign: null, item: null, goods: 'x' } }).ok).toBe(false);
    expect(validateState({ ...raw, buffs: { snack: null, campaign: null, item: null, goods: { id: 'icebar', until: 'x' } } }).ok).toBe(false);
  });
});

/** 구매 횟수(counters.snacks)를 바꿔서 원하는 배수가 나오는 상태를 찾는다(결과가 씨앗과 그 횟수로만 정해지기 때문). */
function withScratchMult(s: GameState, mult: number): GameState {
  for (let n = 0; n < 5000; n++) {
    if (scratchMult(s.feat.seed, n) === mult) return { ...s, counters: { ...s.counters, snacks: n } };
  }
  throw new Error(`배수 ${mult}가 나오는 구매 횟수를 못 찾았어요`);
}

describe('스크래치 복권: 코인을 내고 바로 긁기', () => {
  it('당첨 표는 합이 1000이고 기댓값이 낸 값의 80~85%다', () => {
    const prizes = BALANCE.shop.scratch.prizes;
    expect(prizes.reduce((a, p) => a + p.weight, 0)).toBe(1000);
    const ev = prizes.reduce((a, p) => a + p.mult * (p.weight / 1000), 0);
    expect(ev).toBeGreaterThan(0.8);
    expect(ev).toBeLessThan(0.85);
    expect(prizes.some((p) => p.mult === 0)).toBe(true); // 꽝이 있다
  });

  it('결과 빈도가 표와 비슷하고, 같은 (씨앗, 횟수)면 늘 같은 결과다', () => {
    const seed = base().feat.seed;
    const N = 20000;
    const count = new Map<number, number>();
    for (let n = 0; n < N; n++) {
      const m = scratchMult(seed, n);
      count.set(m, (count.get(m) ?? 0) + 1);
      expect(scratchMult(seed, n)).toBe(m);
    }
    for (const p of BALANCE.shop.scratch.prizes) {
      const got = (count.get(p.mult) ?? 0) / N;
      expect(Math.abs(got - p.weight / 1000)).toBeLessThan(0.015);
    }
  });

  it('사면 값을 내고 낸 값 × 배수를 바로 돌려받으며 편의점 구매로 세어진다', () => {
    const s0 = withScratchMult(base({ coins: 1e12 }), 2);
    const r = ok(buyScratch(s0));
    expect(r.cost).toBe(scratchPrice(s0));
    expect(r.mult).toBe(2);
    expect(r.prize).toBe(r.cost * 2);
    expect(r.state.coins).toBe(s0.coins - r.cost + r.prize);
    expect(r.left).toBe(BALANCE.shop.scratch.perDay - 1);
    expect(r.state.counters.snacks).toBe(s0.counters.snacks + 1);
    expect(r.state.mart.scratches).toBe(1);
    expect(r.state.mart.scratchDay).toBe(dayKey(T0));
    expect(r.state.mart.stamps).toBe(1);
  });

  it('꽝이면 낸 값만 잃고, 0.5배면 절반을 올림 없이 돌려받는다', () => {
    const lose = ok(buyScratch(withScratchMult(base({ coins: 1e12 }), 0)));
    expect(lose.prize).toBe(0);
    expect(lose.state.coins).toBe(1e12 - lose.cost);
    const half = ok(buyScratch(withScratchMult(base({ coins: 1e12 }), 0.5)));
    expect(half.prize).toBe(Math.floor(half.cost * 0.5));
    expect(half.state.coins).toBe(1e12 - half.cost + half.prize);
  });

  it('되돌려 다시 긁을 수 없다: 같은 상태는 같은 결과이고, 한 장 긁으면 다음 장은 다른 번호다', () => {
    const s = base({ coins: 1e12 });
    expect(ok(buyScratch(s)).mult).toBe(ok(buyScratch(s)).mult);
    const first = ok(buyScratch(s));
    expect(first.state.counters.snacks).toBe(s.counters.snacks + 1);
    expect(ok(buyScratch(first.state)).mult).toBe(scratchMult(s.feat.seed, s.counters.snacks + 1));
  });

  it('하루 한도까지 사고, 날짜가 바뀌면 다시 살 수 있다', () => {
    let s = base({ coins: 1e12 });
    expect(scratchesLeft(s)).toBe(BALANCE.shop.scratch.perDay);
    for (let i = 0; i < BALANCE.shop.scratch.perDay; i++) s = ok(buyScratch(s)).state;
    expect(scratchesLeft(s)).toBe(0);
    expect(failReason(buyScratch(s))).toBe('daily_limit');
    const tomorrow = at(s, T0 + 25 * HOUR);
    expect(scratchesLeft(tomorrow)).toBe(BALANCE.shop.scratch.perDay);
    const again = ok(buyScratch(tomorrow));
    expect(again.state.mart.scratchDay).toBe(dayKey(T0 + 25 * HOUR));
    expect(again.state.mart.scratches).toBe(1);
  });

  it('코인이 모자라면 못 사고 아무것도 바뀌지 않는다', () => {
    const s = base({ coins: 1 });
    const r = buyScratch(s);
    expect(failReason(r)).toBe('insufficient_coins');
    expect((r as { state: GameState }).state).toBe(s);
  });

  it('가격은 기본가와 인세 5분 분량 중 큰 쪽이다', () => {
    expect(scratchPrice(base({ fans: 100 }))).toBe(shopPrice(BALANCE.shop.scratch.base, 100));
    const rich = base({ fans: 1e7 });
    expect(scratchPrice(rich)).toBe(Math.ceil(maxRoyaltyPerSec(rich) * BALANCE.shop.scratch.incomeSecs));
  });

  it('코인이 상한에 닿아 있어도 상한을 넘지 않는다', () => {
    const s = withScratchMult(base({ coins: BALANCE.maxResource }), 20);
    expect(ok(buyScratch(s)).state.coins).toBeLessThanOrEqual(BALANCE.maxResource);
  });
});

describe('카드 슬리브: 포토카드 중복을 새 카드로', () => {
  /** 첫 뽑기에서 나올 카드를 미리 알아내서, 그 카드를 가진 채 뽑게 한다. */
  const rigged = (owned: Record<string, number>, sleeves: number, tickets = 1): { s: GameState; set: number; grade: number } => {
    const s0 = base({ coins: 1e12 });
    const roll = rollPhoto(s0.photo.seed, s0.photo.pulls + 1, s0.photo.pity);
    const s = { ...s0, mart: mart({ sleeves }), photo: { ...s0.photo, tickets, owned: { [photoCardId(roll.set, roll.grade)]: 1, ...owned } } };
    return { s, set: roll.set, grade: roll.grade };
  };

  it('사면 한 장이 늘고 최대 장수까지만 가지며, 스탬프도 쌓인다', () => {
    let s = base({ coins: 1e12 });
    for (let i = 0; i < BALANCE.shop.sleeve.max; i++) {
      const r = ok(buySleeve(s));
      expect(r.cost).toBe(sleevePrice(s));
      expect(r.state.coins).toBe(s.coins - r.cost);
      s = r.state;
    }
    expect(s.mart.sleeves).toBe(BALANCE.shop.sleeve.max);
    expect(s.mart.stamps).toBe(BALANCE.shop.sleeve.max);
    expect(failReason(buySleeve(s))).toBe('already_done');
  });

  it('코인이 모자라면 못 산다. 36장을 모두 모았으면 살 필요가 없다', () => {
    expect(failReason(buySleeve(base({ coins: 1 })))).toBe('insufficient_coins');
    const owned: Record<string, number> = {};
    for (let set = 1; set <= PHOTO_SETS; set++) for (let g = 1; g <= PHOTO_GRADES; g++) owned[photoCardId(set, g)] = 1;
    const full = base({ coins: 1e12 });
    const all = { ...full, photo: { ...full.photo, owned } };
    expect(hasAllPhotos(all.photo.owned)).toBe(true);
    expect(hasAllPhotos(full.photo.owned)).toBe(false);
    expect(failReason(buySleeve(all))).toBe('already_done');
  });

  it('가격은 기본가와 인세 20분 분량 중 큰 쪽이고 카드팩보다 조금 싸다', () => {
    expect(sleevePrice(base({ fans: 100 }))).toBe(shopPrice(BALANCE.shop.sleeve.base, 100));
    const rich = base({ fans: 1e7 });
    expect(sleevePrice(rich)).toBe(Math.ceil(maxRoyaltyPerSec(rich) * BALANCE.shop.sleeve.incomeSecs));
    expect(sleevePrice(rich)).toBeLessThan(packPrice(rich));
  });

  it('이미 가진 카드가 나오면 슬리브 한 장이 쓰여 같은 등급의 다음 세트 새 카드가 된다', () => {
    const { s, set, grade } = rigged({}, 2);
    const r = ok(photoPull(s, 1));
    const next = (set % PHOTO_SETS) + 1;
    expect(r.results[0]).toMatchObject({ set: next, grade, isNew: true, sleeve: true, id: photoCardId(next, grade) });
    expect(r.state.mart.sleeves).toBe(1);
    expect(r.state.photo.owned[photoCardId(set, grade)]).toBe(1); // 원래 나온 카드는 늘지 않는다
    expect(r.state.photo.owned[photoCardId(next, grade)]).toBe(1);
    expect(r.state.photo.tickets).toBe(0);
  });

  it('다음 세트도 이미 가졌으면 그다음 세트로 건너뛴다', () => {
    const { s, set, grade } = rigged({}, 1);
    const second = (set % PHOTO_SETS) + 1;
    const third = (second % PHOTO_SETS) + 1;
    const withSecond = { ...s, photo: { ...s.photo, owned: { ...s.photo.owned, [photoCardId(second, grade)]: 1 } } };
    const r = ok(photoPull(withSecond, 1));
    expect(r.results[0]).toMatchObject({ set: third, grade, isNew: true, sleeve: true });
  });

  it('새 카드가 나오면 슬리브는 쓰이지 않는다', () => {
    const s0 = base();
    const s = { ...s0, mart: mart({ sleeves: 3 }), photo: { ...s0.photo, tickets: 1 } };
    const r = ok(photoPull(s, 1));
    expect(r.results[0]).toMatchObject({ isNew: true, sleeve: false });
    expect(r.state.mart.sleeves).toBe(3);
  });

  it('바꿀 새 카드가 없으면(그 등급을 모든 세트에서 가졌으면) 슬리브는 그대로 남고 중복이 된다', () => {
    const s0 = base();
    const roll = rollPhoto(s0.photo.seed, s0.photo.pulls + 1, s0.photo.pity);
    const owned: Record<string, number> = {};
    for (let set = 1; set <= PHOTO_SETS; set++) owned[photoCardId(set, roll.grade)] = 1;
    const s = { ...s0, mart: mart({ sleeves: 2 }), photo: { ...s0.photo, tickets: 1, owned } };
    const r = ok(photoPull(s, 1));
    expect(r.results[0]).toMatchObject({ set: roll.set, grade: roll.grade, isNew: false, sleeve: false });
    expect(r.state.mart.sleeves).toBe(2);
    expect(r.state.photo.owned[photoCardId(roll.set, roll.grade)]).toBe(2);
  });

  it('슬리브가 없으면 예전과 똑같이 중복이 된다', () => {
    const { s, set, grade } = rigged({}, 0);
    const r = ok(photoPull(s, 1));
    expect(r.results[0]).toMatchObject({ set, grade, isNew: false, sleeve: false });
    expect(r.state.photo.owned[photoCardId(set, grade)]).toBe(2);
  });

  it('슬리브는 등급·천장 계산을 바꾸지 않는다', () => {
    const { s, grade } = rigged({}, 1);
    const withSleeve = ok(photoPull(s, 1));
    const without = ok(photoPull({ ...s, mart: mart() }, 1));
    expect(withSleeve.results[0].grade).toBe(grade);
    expect(without.results[0].grade).toBe(grade);
    expect(withSleeve.state.photo.pity).toBe(without.state.photo.pity);
    expect(withSleeve.state.photo.pulls).toBe(without.state.photo.pulls);
  });

  it('여러 번 뽑을 때 쓰인 만큼만 줄어들고, 뽑은 횟수와 티켓도 그대로 센다', () => {
    const s0 = base();
    const s = { ...s0, mart: mart({ sleeves: 5 }), photo: { ...s0.photo, tickets: 10 } };
    const r = ok(photoPull(s, 10));
    const used = r.results.filter((x) => x.sleeve).length;
    expect(r.state.mart.sleeves).toBe(5 - used);
    expect(r.state.photo.tickets).toBe(0);
    expect(r.state.photo.pulls).toBe(s0.photo.pulls + 10);
    // 슬리브가 쓰인 카드는 모두 새 카드다
    for (const x of r.results.filter((y) => y.sleeve)) expect(x.isNew).toBe(true);
  });
});

describe('저장: 스크래치 복권·카드 슬리브', () => {
  it('새 필드가 저장·불러오기를 거쳐도 그대로다', () => {
    const s = base({ mart: mart({ scratchDay: '2026-11-04', scratches: 2, sleeves: 3 }) });
    const v = ok(validateState(JSON.parse(JSON.stringify(s))));
    expect(v.state.mart).toEqual(mart({ scratchDay: '2026-11-04', scratches: 2, sleeves: 3 }));
  });

  it('예전 저장은 빈 값으로 읽고, 이상한 값은 버리거나 한도로 줄인다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    raw.mart = { nightMeals: 1, stamps: 2, coupon: null, receipts: 1, packDay: '2026-11-04', packs: 1 }; // 복권·슬리브 필드가 없던 때
    const v = ok(validateState(raw));
    expect(v.state.mart).toEqual(mart({ nightMeals: 1, stamps: 2, receipts: 1, packDay: '2026-11-04', packs: 1 }));
    raw.mart = { nightMeals: 0, stamps: 0, coupon: null, scratchDay: '어제', scratches: 99, sleeves: 99 };
    const w = ok(validateState(raw));
    expect(w.state.mart).toEqual(mart({ scratchDay: '', scratches: BALANCE.shop.scratch.perDay, sleeves: BALANCE.shop.sleeve.max }));
    raw.mart = { nightMeals: 0, stamps: 0, coupon: null, scratches: -1 };
    expect(validateState(raw).ok).toBe(false);
  });
});

function goalOf(): number {
  return BALANCE.shop.stamps.goal;
}
