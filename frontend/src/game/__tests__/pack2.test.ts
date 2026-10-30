import { describe, expect, it } from 'vitest';
import { PAD_RATES, defaultPattern, emptyPattern, processSample, stepSeconds } from '../../audio/sampler';
import { ACHIEVEMENTS, BALANCE, FEAT_NPCS, LYRIC_CARDS, PHOTO_CARD_IDS, photoCardId } from '../balance';
import { abandonArcade, arcadeBlocked, beginArcade, finishArcade, firstGradeDiamonds, gradeOf } from '../arcade';
import { beginManualConcert, finishManualConcert, releaseSingle, runAutoConcert } from '../commands';
import { featPull, rollFeat, toggleFeat } from '../featuring';
import { tallyNick } from '../fanmail';
import { addLyricCard, deckSize, draftChoices, endTurn, lyricScore, playCard, previewGain, startLyric, trimLyricCard, type LyricRun } from '../lyricdeck';
import { claimPresent, feedCost, feedMascot, giftMascot, mascotView, playMascot } from '../mascot';
import { weekKey } from '../missions';
import { bonuses, cardRarityOf, completedSets, mascotMood, mascotStage, pickupOf, songCardOf } from '../packdata';
import { buyTickets, craftPhoto, dismantlePhoto, giveCard, photoPull, rollPhoto, settleSets, takeCard } from '../photocards';
import { createInitialState, validateState } from '../persistence';
import { buildChart, createRhythm, isRhythmFinished, pressLane, rhythmScore, tickTo } from '../rhythm';
import { achievementValue, clickGain, offlineCapMs, rhymeRate } from '../selectors';
import { applyChallengeClaim, applyChartClaim } from '../serverRewards';
import { advance, settleOffline } from '../simulation';
import { remasterCard, toggleDeck } from '../songcards';
import { SurvivalGame } from '../survival';
import { applyTicketBoost, captchaScore, createTicketing, pressTicket, reactionScore, scoreOf, submitCode, tickTicketing } from '../ticketing';
import { climbTower, rollTower, towerEnemy, towerPower, towerStatus, winChance } from '../tower';
import type { GameState, Single } from '../types';
import { buildWrapped, wrappedHeadline } from '../wrapped';

const T0 = new Date(2026, 9, 28, 12, 0, 0).getTime(); // 수요일 낮
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const singles = (n: number, persona: Single['persona'] = 'normal'): Single[] => Array.from({ length: n }, (_, i) => ({ id: `single-${i + 1}`, persona, title: `곡${i + 1}`, releasedAt: T0 }));
const base = (patch: Partial<GameState> = {}): GameState => at({ ...createInitialState(T0), ...patch }, T0);
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const failReason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);

/** 곡 카드 등급이 rarity가 되는 씨앗을 찾는다 */
function seedFor(rarity: 'N' | 'R' | 'SR' | 'SSR', id = 'single-1'): number {
  for (let seed = 1; seed < 100000; seed++) if (cardRarityOf(seed, id) === rarity) return seed;
  throw new Error('seed not found');
}

describe('콘텐츠 팩 2: 저장', () => {
  it('새 필드가 저장·불러오기를 거쳐도 그대로다', () => {
    let s = base({ singles: singles(3) });
    s = { ...s, photo: { ...s.photo, owned: { 'p1-1': 2, 'p3-4': 1 }, tickets: 7, pity: 12, pulls: 40, shards: 5, claimedSets: [2] } };
    s = { ...s, feat: { ...s.feat, owned: { 'f-han': 3, 'f-moon': 1 }, slots: ['f-han'], pity: 8, guaranteed: true } };
    s = { ...s, cards: { ...s.cards, deck: ['single-2'], remaster: { 'single-2': 2 } } };
    s = { ...s, mascot: { ...s.mascot, dark: { xp: 90, fullUntil: T0 + 5000, playReadyAt: 0, giftReadyAt: T0 } } };
    s = { ...s, stats: { normalMs: 1000, darkMs: 2000, nicks: { 새벽: 4 }, notes: ['한 줄'] } };
    s = { ...s, arcade: { ...s.arcade, rhythm: { ...s.arcade.rhythm, best: 900, songs: { 'single-1': 900 } }, tower: { ...s.arcade.tower, week: '2026-10-26', floor: 7, best: 12, claimed: [1, 2], attempts: 3 } } };
    const v = validateState(JSON.parse(JSON.stringify(s)));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.state).toEqual(s);
  });

  it('새 필드가 없는 예전 저장은 기본값으로 읽는다', () => {
    const raw = JSON.parse(JSON.stringify(base({ singles: singles(2) })));
    for (const k of ['cards', 'photo', 'feat', 'mascot', 'arcade', 'stats']) delete raw[k];
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.state.photo.tickets).toBe(0);
    expect(v.state.arcade.lyric.cards).toEqual(BALANCE.lyric.starter);
    expect(v.state.mascot.normal.xp).toBe(0);
    expect(bonuses(v.state).power).toBe(0);
  });

  it('서버 저장이 거부하는 키(. $)와 비정상 덱은 걸러 낸다', () => {
    const raw = JSON.parse(JSON.stringify(base({ singles: singles(1) })));
    raw.stats.nicks = { 'a.b': 3, $x: 2, 정상: 1 };
    raw.arcade.lyric.cards = { 'l-a1': 1 };
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.state.stats.nicks).toEqual({ 정상: 1 });
      expect(v.state.arcade.lyric.cards).toEqual(BALANCE.lyric.starter);
    }
    expect(tallyNick({}, 'x.y$z')).toEqual({ 'x·y·z': 1 });
    expect(tallyNick({ a: 1 }, 'a')).toEqual({ a: 2 });
    let many: Record<string, number> = {};
    for (let i = 0; i < 40; i++) many = tallyNick(many, `팬${i}`);
    expect(Object.keys(many).length).toBe(30);
  });

  it('알 수 없는 ID는 조용히 버리고, 이상한 숫자는 거부한다', () => {
    const raw = JSON.parse(JSON.stringify(base({ singles: singles(1) })));
    raw.photo.owned = { 'p1-1': 1, 'p9-9': 3, zzz: 1 };
    raw.feat.owned = { 'f-han': 1, 'f-nope': 2 };
    raw.cards.deck = ['single-1', 'single-99'];
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.state.photo.owned).toEqual({ 'p1-1': 1 });
      expect(v.state.feat.owned).toEqual({ 'f-han': 1 });
      expect(v.state.cards.deck).toEqual(['single-1']);
    }
    type Mutate = (r: Record<string, any>) => unknown;
    const mutations: Mutate[] = [(r) => (r.photo.tickets = -1), (r) => (r.feat.owned['f-han'] = 99), (r) => (r.arcade.survival.best = 1001), (r) => (r.mascot.normal.xp = 1.5)];
    for (const mutate of mutations) {
      const bad = JSON.parse(JSON.stringify(base({ singles: singles(1) })));
      bad.feat.owned = { 'f-han': 1 };
      mutate(bad);
      expect(validateState(bad).ok).toBe(false);
    }
  });
});

describe('수집 보너스', () => {
  it('아무것도 없으면 보너스가 0이라 기존 수치가 그대로다', () => {
    const s = base({ singles: singles(2) });
    const b = bonuses(s);
    expect(b).toEqual({ rhyme: { normal: 0, dark: 0 }, coin: 0, fan: 0, power: 0, offlineMs: 0 });
  });

  it('곡 카드 덱: 등급·바이브·리마스터가 보너스에 합산되고 라임은 그 곡의 자아에만 붙는다', () => {
    const seed = seedFor('SSR');
    let s = base({ singles: singles(1, 'dark') });
    s = { ...s, cards: { ...s.cards, seed } };
    const card = songCardOf(s.cards, s.singles[0]);
    expect(card.rarity).toBe('SSR');
    s = ok(toggleDeck(s, 'single-1')).state;
    const b = bonuses(s);
    const key = card.vibe === 'rhyme' ? 'rhyme' : card.vibe;
    if (card.vibe === 'rhyme') {
      expect(b.rhyme.dark).toBeCloseTo(BALANCE.cards.base.SSR);
      expect(b.rhyme.normal).toBe(0);
    } else expect(b[key as 'coin']).toBeCloseTo(BALANCE.cards.base.SSR);
    // 리마스터는 코인을 쓰고 보너스를 키운다
    const poor = remasterCard({ ...s, coins: 0 }, 'single-1');
    expect(failReason(poor)).toBe('insufficient_coins');
    const rich = ok(remasterCard({ ...s, coins: 1e9 }, 'single-1'));
    expect(rich.level).toBe(1);
    expect(songCardOf(rich.state.cards, rich.state.singles[0]).bonus).toBeCloseTo(BALANCE.cards.base.SSR * (1 + BALANCE.cards.remasterBonus));
  });

  it('덱은 6장까지, 같은 곡은 한 번 더 누르면 빠진다', () => {
    let s = base({ singles: singles(8) });
    for (let i = 1; i <= 6; i++) s = ok(toggleDeck(s, `single-${i}`)).state;
    expect(failReason(toggleDeck(s, 'single-7'))).toBe('full_slots');
    s = ok(toggleDeck(s, 'single-3')).state;
    expect(s.cards.deck).not.toContain('single-3');
    expect(failReason(toggleDeck(s, 'single-99'))).toBe('not_found');
  });

  it('보너스는 라임 생산·작업하기·인세에 실제로 곱해진다', () => {
    let s = base({ singles: singles(1), fans: 1000 });
    const plain = advance(s, 10_000).state;
    s = { ...s, feat: { ...s.feat, owned: { 'f-moon': 1 }, slots: ['f-moon'] } }; // SSR 라임
    const boosted = advance(s, 10_000).state;
    expect(boosted.normalRhymes).toBeCloseTo(plain.normalRhymes * (1 + BALANCE.feat.passive.SSR), 5);
    expect(clickGain(s)).toBeCloseTo(clickGain({ ...s, feat: { ...s.feat, slots: [] } }) * (1 + BALANCE.feat.passive.SSR), 5);
    expect(rhymeRate(s)).toBeGreaterThan(rhymeRate({ ...s, feat: { ...s.feat, slots: [] } }));
  });

  it('포토 세트 5(편의점 앞)는 오프라인 정산 시간을 늘린다', () => {
    let s = base();
    const owned: Record<string, number> = {};
    for (let g = 1; g <= 6; g++) owned[photoCardId(5, g)] = 1;
    s = { ...s, photo: { ...s.photo, owned } };
    expect(completedSets(owned)).toEqual([5]);
    expect(offlineCapMs(s)).toBe(BALANCE.offline.capMs + 30 * 60_000);
    const gap = 5 * 3600_000;
    expect(settleOffline(s, T0 + gap).paidMs).toBe(BALANCE.offline.capMs + 30 * 60_000);
  });
});

describe('포토카드 가챠', () => {
  it('같은 씨앗·같은 번호면 결과가 같고 등급 확률이 표와 비슷하다', () => {
    expect(rollPhoto(777, 5, 0)).toEqual(rollPhoto(777, 5, 0));
    const counts = new Array<number>(6).fill(0);
    const N = 20000;
    for (let i = 1; i <= N; i++) counts[rollPhoto(12345, i, 0).grade - 1]++;
    BALANCE.photo.rates.forEach((r, i) => {
      if (r > 0.1) expect(Math.abs(counts[i] / N - r)).toBeLessThan(0.02);
    });
    expect(counts[5] / N).toBeLessThan(0.02);
  });

  it(`${BALANCE.photo.pityAt}회째에는 5등급 이상이 확정이고 카운터가 0으로 돌아간다`, () => {
    let s = base();
    s = { ...s, photo: { ...s.photo, tickets: 5, pity: BALANCE.photo.pityAt - 1 } };
    const r = ok(photoPull(s, 1));
    expect(r.results[0].grade).toBeGreaterThanOrEqual(BALANCE.photo.pityGrade);
    expect(r.state.photo.pity).toBe(0);
    expect(r.state.photo.tickets).toBe(4);
    expect(r.state.photo.pulls).toBe(1);
  });

  it('티켓이 모자라면 뽑을 수 없고, 10연은 티켓 10장을 쓴다', () => {
    const s = base();
    expect(failReason(photoPull(s, 1))).toBe('no_ticket');
    const r = ok(photoPull({ ...s, photo: { ...s.photo, tickets: 12 } }, 10));
    expect(r.results).toHaveLength(10);
    expect(r.state.photo.tickets).toBe(2);
    expect(Object.values(r.state.photo.owned).reduce((a, b) => a + b, 0)).toBe(10);
    expect(r.state.counters.pulls).toBe(10);
  });

  it('90연이 지나면 한 번은 천장 카드가 나온다 (뽑기 결과는 되돌려도 같다)', () => {
    let s = base();
    s = { ...s, photo: { ...s.photo, tickets: 999 } };
    const a = ok(photoPull(s, 90));
    expect(a.results.some((x) => x.grade >= BALANCE.photo.pityGrade)).toBe(true);
    const b = ok(photoPull(s, 90));
    expect(b.results).toEqual(a.results);
  });

  it('조각 제작: 모자라면 실패하고, 만들어 세트가 완성되면 다이아를 받는다', () => {
    let s = base();
    const owned: Record<string, number> = {};
    for (let g = 1; g <= 5; g++) owned[photoCardId(1, g)] = 1;
    s = { ...s, photo: { ...s.photo, owned, shards: BALANCE.photo.craftCost[5] - 1 } };
    expect(failReason(craftPhoto(s, photoCardId(1, 6)))).toBe('insufficient_coins');
    expect(failReason(craftPhoto(s, photoCardId(1, 1)))).toBe('owned');
    const r = ok(craftPhoto({ ...s, photo: { ...s.photo, shards: BALANCE.photo.craftCost[5] } }, photoCardId(1, 6)));
    expect(r.sets).toEqual([1]);
    expect(r.diamonds).toBe(BALANCE.photo.setDiamonds);
    expect(r.state.photo.claimedSets).toEqual([1]);
    expect(settleSets(r.state).diamonds).toBe(0); // 두 번 주지 않는다
  });

  it('분해는 중복 한 장만, 교환용 카드 이동은 중복만 낼 수 있다', () => {
    let s = base();
    s = { ...s, photo: { ...s.photo, owned: { 'p2-3': 2, 'p2-4': 1 } } };
    expect(failReason(dismantlePhoto(s, 'p2-4'))).toBe('need_duplicate');
    const d = ok(dismantlePhoto(s, 'p2-3'));
    expect(d.shards).toBe(BALANCE.photo.shardValue[2]);
    expect(d.state.photo.owned['p2-3']).toBe(1);
    expect(failReason(takeCard(s, 'p2-4'))).toBe('need_duplicate');
    expect(failReason(takeCard(s, 'bad'))).toBe('not_found');
    const t = ok(takeCard(s, 'p2-3'));
    expect(t.state.photo.owned['p2-3']).toBe(1);
    const g = ok(giveCard(t.state, 'p5-1', true));
    expect(g.state.photo.owned['p5-1']).toBe(1);
    expect(g.state.counters.trades).toBe(1);
  });

  it('다이아로 티켓을 사고 상한을 넘기지 못한다', () => {
    const s = base({ diamonds: 100 });
    const r = ok(buyTickets(s, 10));
    expect(r.state.photo.tickets).toBe(10);
    expect(r.state.diamonds).toBe(100 - 10 * BALANCE.photo.ticketDiamonds);
    expect(failReason(buyTickets(base({ diamonds: 2 }), 1))).toBe('insufficient_diamonds');
    expect(PHOTO_CARD_IDS).toHaveLength(36);
  });

  it('싱글·앨범·공연 첫 클리어가 티켓을 준다', () => {
    let s = base({ normalRhymes: 1e9, coins: 1e9, fans: 1e6 });
    s = ok(releaseSingle(s)).state;
    expect(s.photo.tickets).toBe(BALANCE.photo.tickets.single);
    const c = ok(runAutoConcert({ ...s, concerts: { ...s.concerts, room: { ...s.concerts.room, cooldownUntil: 0 } } }, 'room'));
    expect(c.state.photo.tickets).toBe(BALANCE.photo.tickets.single + BALANCE.photo.tickets.firstClear);
    const again = ok(runAutoConcert(at(c.state, T0 + 10 * 60_000), 'room'));
    expect(again.state.photo.tickets).toBe(c.state.photo.tickets); // 두 번째부터는 없다
  });
});

describe('피처링 가챠', () => {
  it('SSR은 천장에서 확정이고 픽업 규칙을 따른다', () => {
    const pickup = pickupOf(T0);
    expect(pickup.rarity).toBe('SSR');
    const roll = rollFeat(1, 1, BALANCE.feat.pityAt - 1, false, pickup, false);
    expect(roll.def.rarity).toBe('SSR');
    const sure = rollFeat(1, 2, BALANCE.feat.pityAt - 1, true, pickup, false);
    expect(sure.def.id).toBe(pickup.id);
    expect(sure.pickup).toBe(true);
    const ten = rollFeat(5, 3, 0, false, pickup, true);
    expect(ten.def.rarity === 'R').toBe(false); // 10연 마지막은 SR 이상
  });

  it('중복은 별이 오르고 가득 차면 다이아로 환급한다', () => {
    let s = base({ diamonds: 100000 });
    s = { ...s, feat: { ...s.feat, pity: BALANCE.feat.pityAt - 1 } };
    const first = ok(featPull(s, 1));
    const id = first.results[0].id;
    expect(first.results[0].rarity).toBe('SSR');
    expect(first.state.feat.owned[id]).toBe(1);
    expect(first.state.feat.pity).toBe(0);
    expect(first.state.diamonds).toBe(100000 - BALANCE.feat.pullCost);
    // 같은 카드로 별을 가득 채운 뒤 또 나오면 환급
    const maxed = { ...first.state, feat: { ...first.state.feat, owned: { ...first.state.feat.owned, [id]: BALANCE.feat.maxStar } } };
    const def = FEAT_NPCS.find((n) => n.id === id)!;
    let t = maxed;
    let refunded = 0;
    for (let i = 0; i < 400 && refunded === 0; i++) {
      const r = ok(featPull(t, 1));
      t = r.state;
      refunded = r.results[0].id === id ? r.refund : 0;
    }
    expect(refunded).toBe(BALANCE.feat.dupRefund[def.rarity]);
  });

  it('10연은 다이아 90, 부족하면 실패하고, 장착은 3명까지', () => {
    expect(failReason(featPull(base({ diamonds: 89 }), 10))).toBe('insufficient_diamonds');
    const r = ok(featPull(base({ diamonds: 90 }), 10));
    expect(r.results).toHaveLength(10);
    expect(r.state.diamonds).toBe(r.refund);
    expect(r.results.some((x) => x.rarity !== 'R')).toBe(true); // 10연에는 SR 이상이 하나는 있다
    let s = base();
    s = { ...s, feat: { ...s.feat, owned: { 'f-han': 1, 'f-conv': 1, 'f-bus': 1, 'f-roof': 1 } } };
    for (const id of ['f-han', 'f-conv', 'f-bus']) s = ok(toggleFeat(s, id)).state;
    expect(failReason(toggleFeat(s, 'f-roof'))).toBe('full_slots');
    expect(failReason(toggleFeat(s, 'f-void'))).toBe('not_owned');
    expect(ok(toggleFeat(s, 'f-han')).equipped).toBe(false);
  });

  it('피처링 별은 패시브를 키운다', () => {
    let s = base();
    s = { ...s, feat: { ...s.feat, owned: { 'f-pc': 1 }, slots: ['f-pc'] } }; // SR 인세
    const one = bonuses(s).coin;
    s = { ...s, feat: { ...s.feat, owned: { 'f-pc': 4 } } };
    expect(bonuses(s).coin).toBeCloseTo(one * (1 + 3 * BALANCE.feat.starBonus));
  });
});

describe('마스코트', () => {
  it('간식은 코인을 쓰고 배부름·xp를 올리고, 놀아주기는 쿨다운이 있다', () => {
    let s = base({ coins: 1000, singles: singles(1) });
    const cost = feedCost(1);
    expect(failReason(feedMascot({ ...s, coins: cost - 1 }, 'normal', 1))).toBe('insufficient_coins');
    s = ok(feedMascot(s, 'normal', 1)).state;
    expect(s.coins).toBe(1000 - cost);
    expect(s.mascot.normal.xp).toBe(BALANCE.mascot.feed.xp);
    expect(mascotMood(s.mascot.normal, T0)).toBe('happy');
    expect(s.counters.pets).toBe(1);
    s = ok(playMascot(s, 'normal')).state;
    expect(failReason(playMascot(s, 'normal'))).toBe('cooldown');
    expect(mascotView(at(s, T0 + BALANCE.mascot.play.cooldownMs), 'normal').playWaitMs).toBe(0);
  });

  it('배고픔 → 삐짐 순으로 기분이 바뀌고 보너스가 줄어든다', () => {
    let s = base();
    s = { ...s, mascot: { ...s.mascot, normal: { ...s.mascot.normal, xp: 300, fullUntil: T0 } } };
    expect(mascotStage(300)).toBe(3);
    const full = bonuses(at(s, T0 - 1)).rhyme.normal;
    const hungry = bonuses(at(s, T0 + 1000)).rhyme.normal;
    const sulk = bonuses(at(s, T0 + BALANCE.mascot.hungryMs + 1000)).rhyme.normal;
    expect(full).toBeCloseTo(BALANCE.mascot.stageBonus[3]);
    expect(hungry).toBeCloseTo(BALANCE.mascot.stageBonus[3] / 2);
    expect(sulk).toBe(0);
  });

  it('선물은 배부를 때만, 시간이 지나야 받는다', () => {
    let s = base({ coins: 1e6, fans: 500, singles: singles(1) });
    expect(failReason(claimPresent(s, 'normal'))).toBe('not_ready'); // 아직 배부르지 않다
    s = ok(feedMascot(s, 'normal', 1)).state;
    const r = ok(claimPresent(s, 'normal'));
    expect(r.coins).toBeGreaterThanOrEqual(BALANCE.mascot.present.minCoins);
    expect(failReason(claimPresent(r.state, 'normal'))).toBe('not_ready');
    const later = at(r.state, T0 + BALANCE.mascot.present.intervalMs);
    expect(mascotView(later, 'normal').mood).toBe('hungry'); // 4시간 간식은 6시간 뒤엔 끝났다
  });

  it('선물하기는 다이아를 쓰고 xp를 크게 올린다', () => {
    const s = base({ diamonds: 5 });
    const r = ok(giftMascot(s, 'dark'));
    expect(r.state.mascot.dark.xp).toBe(BALANCE.mascot.gift.xp);
    expect(failReason(giftMascot(base({ diamonds: 2 }), 'dark'))).toBe('insufficient_diamonds');
  });
});

describe('아케이드 공통', () => {
  it('등급 기준과 처음 닿는 등급의 다이아', () => {
    expect([1000, 900, 899, 750, 749, 500, 499, 0].map(gradeOf)).toEqual(['S', 'S', 'A', 'A', 'B', 'B', 'C', 'C']);
    expect(firstGradeDiamonds(0, 1000)).toBe(BALANCE.arcade.firstDiamonds.A + BALANCE.arcade.firstDiamonds.S);
    expect(firstGradeDiamonds(800, 1000)).toBe(BALANCE.arcade.firstDiamonds.S);
    expect(firstGradeDiamonds(950, 1000)).toBe(0);
  });

  it('첫 싱글이 있어야 하고 시작하면 쿨다운이 확정되며 포기해도 유지된다', () => {
    expect(failReason(beginArcade(base(), 'survival', 'r1'))).toBe('need_single');
    const s = base({ singles: singles(1) });
    const r = ok(beginArcade(s, 'survival', 'r1'));
    expect(r.state.arcade.survival.cooldownUntil).toBe(T0 + BALANCE.arcade.kinds.survival.cooldownMs);
    expect(r.state.counters.arcades).toBe(1);
    expect(r.run.status).toBe('running');
    expect(abandonArcade(r.run).status).toBe('abandoned');
    expect(arcadeBlocked(r.state, 'survival')).toBe('cooldown');
    expect(failReason(beginArcade(r.state, 'survival', 'r2'))).toBe('cooldown');
    expect(arcadeBlocked(at(r.state, T0 + BALANCE.arcade.kinds.survival.cooldownMs), 'survival')).toBeNull();
  });

  it('끝나면 점수로 코인·팬·다이아를 주고, 같은 실행은 두 번 정산되지 않는다', () => {
    const s = base({ singles: singles(1), fans: 2000 });
    const begun = ok(beginArcade(s, 'survival', 'r1'));
    const done = ok(finishArcade(begun.state, begun.run, 950));
    expect(done.outcome.grade).toBe('S');
    expect(done.outcome.coins).toBeGreaterThan(0);
    expect(done.outcome.fans).toBe(Math.ceil(2000 * BALANCE.arcade.kinds.survival.fansPct.S));
    expect(done.outcome.diamonds).toBeGreaterThanOrEqual(BALANCE.arcade.firstDiamonds.A + BALANCE.arcade.firstDiamonds.S);
    expect(done.state.arcade.survival.best).toBe(950);
    expect(done.state.counters.survivals).toBe(1);
    expect(failReason(finishArcade(done.state, done.run, 950))).toBe('session_closed');
    const second = ok(finishArcade({ ...done.state, arcade: { ...done.state.arcade, survival: { ...done.state.arcade.survival, cooldownUntil: 0 } } }, { ...begun.run, id: 'r2' }, 960));
    expect(second.outcome.diamonds).toBeLessThan(done.outcome.diamonds); // 등급 다이아는 처음 한 번뿐
  });

  it('리듬은 곡별 최고 점수를 기록하고 난이도 배율이 보상에 곱해진다', () => {
    const s = base({ singles: singles(2), fans: 500 });
    const e = ok(beginArcade(s, 'rhythm', 'a', { target: 'single-1', level: 'easy' }));
    const h = ok(beginArcade(at(s, T0 + 1e6), 'rhythm', 'b', { target: 'single-2', level: 'hard' }));
    const ce = ok(finishArcade(e.state, e.run, 800)).outcome.coins;
    const ch = ok(finishArcade(h.state, h.run, 800)).outcome.coins;
    expect(ch).toBeGreaterThanOrEqual(ce);
    expect(ok(finishArcade(e.state, e.run, 800)).state.arcade.rhythm.songs).toEqual({ 'single-1': 800 });
    expect(failReason(beginArcade(s, 'rhythm', 'c', { target: 'single-9' }))).toBe('not_found');
    // 같은 곡은 항상 같은 채보 씨앗
    expect(ok(beginArcade(s, 'rhythm', 'x', { target: 'single-1' })).run.seed).toBe(e.run.seed);
  });

  it('가사 덱 완성도는 다음 싱글 팬 보너스가 되고 한 번 쓰면 사라진다', () => {
    let s = base({ singles: singles(1), fans: 0, normalRhymes: 1e9, coins: 1e9 });
    const begun = ok(beginArcade(s, 'lyric', 'l1'));
    const done = ok(finishArcade(begun.state, begun.run, 1000));
    expect(done.state.arcade.lyric.bonus).toBe(BALANCE.lyric.fanBonus.S);
    const withBonus = ok(releaseSingle(done.state));
    const without = ok(releaseSingle({ ...done.state, arcade: { ...done.state.arcade, lyric: { ...done.state.arcade.lyric, bonus: 0 } } }));
    expect(withBonus.fans).toBeGreaterThan(without.fans);
    expect(withBonus.state.arcade.lyric.bonus).toBe(0);
  });

  it('피켓팅 점수는 다음 공연 코인 배율이 되고 한 번 쓰면 사라진다', () => {
    const s = base({ singles: singles(1), fans: 200 });
    const begun = ok(beginArcade(s, 'ticketing', 't1'));
    const done = ok(finishArcade(begun.state, begun.run, 800));
    expect(done.outcome.boost).toBeCloseTo(1.8);
    expect(done.state.arcade.ticketing.boost?.until).toBe(T0 + BALANCE.ticketing.boostMs);
    const sold = ok(finishArcade(ok(beginArcade(s, 'ticketing', 't2')).state, begun.run, 100));
    expect(sold.outcome.boost).toBeNull();
    expect(sold.state.arcade.ticketing.boost).toBeNull();

    const plain = ok(runAutoConcert(s, 'room')).outcome.coins;
    const boosted = ok(runAutoConcert(done.state, 'room'));
    expect(boosted.outcome.coins).toBeGreaterThan(plain);
    expect(boosted.state.arcade.ticketing.boost).toBeNull();
    // 시간이 지나면 효과는 없어지고 배율도 지워진다
    const stale = ok(runAutoConcert(at(done.state, T0 + BALANCE.ticketing.boostMs + 1), 'room'));
    expect(stale.outcome.coins).toBe(plain);
    expect(stale.state.arcade.ticketing.boost).toBeNull();
  });

  it('직접 공연도 피켓팅 배율을 받는다', () => {
    const s = base({ singles: singles(1), fans: 200 });
    const boosted = { ...s, arcade: { ...s.arcade, ticketing: { ...s.arcade.ticketing, boost: { mult: 2, until: T0 + 1e6 } } } };
    const begun = ok(beginManualConcert(boosted, 'room', 'c1'));
    const plainBegun = ok(beginManualConcert(s, 'room', 'c1'));
    const a = ok(finishManualConcert(begun.state, begun.run, 700));
    const b = ok(finishManualConcert(plainBegun.state, plainBegun.run, 700));
    expect(a.outcome.coins - a.outcome.firstClearCoins).toBe(2 * (b.outcome.coins - b.outcome.firstClearCoins));
  });
});

describe('리듬게임', () => {
  it('채보는 씨앗·난이도·자아로만 정해지고 레인과 시간 순서가 올바르다', () => {
    const a = buildChart(99, 'normal', 'normal');
    expect(buildChart(99, 'normal', 'normal')).toEqual(a);
    expect(buildChart(100, 'normal', 'normal').notes).not.toEqual(a.notes);
    expect(a.notes.length).toBeGreaterThan(30);
    for (const n of a.notes) expect(n.lane >= 0 && n.lane < BALANCE.rhythm.lanes).toBe(true);
    for (let i = 1; i < a.notes.length; i++) expect(a.notes[i].t).toBeGreaterThanOrEqual(a.notes[i - 1].t);
    expect(buildChart(99, 'normal', 'hard').notes.length).toBeGreaterThan(buildChart(99, 'normal', 'easy').notes.length);
    expect(buildChart(99, 'dark', 'normal').bpm).toBeGreaterThan(a.bpm - 9 + BALANCE.rhythm.darkBpm - 1);
  });

  it('정확히 치면 만점에 가깝고, 안 치면 0점이고, 같은 노트는 한 번만 판정된다', () => {
    const chart = buildChart(5, 'normal', 'normal');
    let st = createRhythm(chart);
    for (const n of chart.notes) st = pressLane(st, n.lane, n.t).state;
    st = tickTo(st, chart.durationMs + 1);
    expect(rhythmScore(st)).toBe(1000);
    expect(isRhythmFinished(st)).toBe(true);

    expect(rhythmScore(tickTo(createRhythm(chart), chart.durationMs + 1))).toBe(0);

    const n0 = chart.notes[0];
    const first = pressLane(createRhythm(chart), n0.lane, n0.t);
    expect(first.judgement).toBe('perfect');
    const again = pressLane(first.state, n0.lane, n0.t + 5);
    expect(again.judgement).toBeNull();
  });

  it('판정 폭: 좋음 범위 밖은 무시, 전투력 보너스는 폭을 넓힌다', () => {
    const chart = buildChart(5, 'normal', 'easy');
    const n = chart.notes[0];
    const off = n.t + BALANCE.rhythm.goodMs + 10;
    expect(pressLane(createRhythm(chart), n.lane, off).judgement).toBeNull();
    expect(pressLane(createRhythm(chart, 0.5), n.lane, off).judgement).toBe('good');
    expect(pressLane(createRhythm(chart), n.lane, n.t + 80).judgement).toBe('good');
    // 틀린 레인은 노트를 건드리지 않는다
    const wrong = (n.lane + 1) % BALANCE.rhythm.lanes;
    const hasSame = chart.notes.some((x) => x.lane === wrong && Math.abs(x.t - n.t) <= BALANCE.rhythm.goodMs);
    if (!hasSame) expect(pressLane(createRhythm(chart), wrong, n.t).judgement).toBeNull();
  });

  it('콤보가 끊기면 점수가 깎인다', () => {
    const chart = buildChart(8, 'normal', 'normal');
    let all = createRhythm(chart);
    for (const n of chart.notes) all = pressLane(all, n.lane, n.t).state;
    let skip = createRhythm(chart);
    chart.notes.forEach((n, i) => {
      if (i % 5 !== 2) skip = pressLane(skip, n.lane, n.t).state;
    });
    expect(rhythmScore(tickTo(skip, chart.durationMs + 1))).toBeLessThan(rhythmScore(tickTo(all, chart.durationMs + 1)));
  });
});

describe('새벽 생존', () => {
  const still = (persona: 'normal' | 'dark', seed: number, power = 0) => {
    const g = new SurvivalGame(persona, seed, power);
    let guard = 0;
    while (g.status === 'running' && guard++ < 100000) {
      if (g.choices) g.choose(0);
      else g.step({ x: 0, y: 0 });
    }
    return g;
  };

  it('같은 씨앗·같은 입력이면 같은 판이다', () => {
    const a = still('normal', 4242);
    const b = still('normal', 4242);
    expect(a.score()).toBe(b.score());
    expect(a.kills).toBe(b.kills);
    expect(a.timeMs).toBe(b.timeMs);
    expect(still('normal', 4243).kills).not.toBe(-1);
  });

  it('가만히 있으면 3분을 못 버티고, 점수는 0~1000 안이다', () => {
    for (const seed of [1, 2, 3]) {
      const g = still('normal', seed * 31);
      expect(g.status).toBe('dead');
      expect(g.timeMs).toBeLessThan(BALANCE.survival.durationMs);
      expect(g.score()).toBeGreaterThan(0);
      expect(g.score()).toBeLessThanOrEqual(1000);
    }
  });

  it('레벨업하면 게임이 멈추고 스킬을 골라야 이어진다', () => {
    const g = new SurvivalGame('normal', 7);
    let guard = 0;
    while (!g.choices && g.status === 'running' && guard++ < 60000) g.step({ x: 0, y: 0 });
    expect(g.choices).not.toBeNull();
    expect(g.choices).toHaveLength(3);
    const t = g.timeMs;
    g.step({ x: 0, y: 0 });
    expect(g.timeMs).toBe(t); // 멈춰 있다
    expect(g.choose(9)).toBe(false);
    const id = g.choices![0];
    expect(g.choose(0)).toBe(true);
    if (id !== 'heal') expect(g.skills[id]).toBe(1);
    expect(g.level).toBe(2);
  });

  it('어둠은 더 세게 때리고(전투력 보너스도 공격력에 곱해진다), 입력은 이동 범위를 넘지 않는다', () => {
    expect(new SurvivalGame('dark', 1).dmg).toBeGreaterThan(new SurvivalGame('normal', 1).dmg);
    expect(new SurvivalGame('normal', 1, 0.5).dmg).toBeCloseTo(new SurvivalGame('normal', 1).dmg * 1.5);
    const g = new SurvivalGame('normal', 1);
    for (let i = 0; i < 2000; i++) g.step({ x: 5, y: 0 });
    expect(g.px).toBeLessThanOrEqual(BALANCE.survival.half);
    expect(g.px).toBeGreaterThan(BALANCE.survival.half - 1);
    const n = new SurvivalGame('normal', 1);
    n.step({ x: Number.NaN, y: 1 });
    expect(Number.isFinite(n.px)).toBe(true);
  });

  it('advance는 고정 단계로 나눠 진행한다', () => {
    const a = new SurvivalGame('normal', 5);
    const b = new SurvivalGame('normal', 5);
    for (let i = 0; i < 100; i++) a.advance(100, { x: 0.3, y: -0.2 });
    for (let i = 0; i < 1000; i++) b.advance(10, { x: 0.3, y: -0.2 });
    expect(Math.abs(a.timeMs - b.timeMs)).toBeLessThan(60);
  });
});

describe('가사 덱빌딩', () => {
  const run = (patch: Partial<LyricRun>): LyricRun => ({ ...startLyric(BALANCE.lyric.starter, 3), ...patch });

  it('같은 씨앗이면 같은 손패이고 손패는 5장이다', () => {
    const a = startLyric(BALANCE.lyric.starter, 11);
    expect(startLyric(BALANCE.lyric.starter, 11).hand).toEqual(a.hand);
    expect(a.hand).toHaveLength(BALANCE.lyric.hand);
    expect(a.drawPile).toHaveLength(deckSize(BALANCE.lyric.starter) - BALANCE.lyric.hand);
    expect(startLyric(BALANCE.lyric.starter, 12).hand).not.toEqual(a.hand);
  });

  it('같은 모음을 이으면 체인이 쌓이고 다른 모음에서 끊긴다', () => {
    let r = run({ hand: ['l-a1', 'l-a2', 'l-eo1', 'l-a1'], energy: 9 });
    r = playCard(r, 0); // ㅏ 5
    expect(r.total).toBe(5);
    r = playCard(r, 0); // ㅏ 7 × 1.5
    expect(r.total).toBeCloseTo(5 + 7 * 1.5);
    expect(r.chain).toBe(1);
    r = playCard(r, 0); // ㅓ: 끊긴다 → 5
    expect(r.chain).toBe(0);
    expect(r.total).toBeCloseTo(5 + 10.5 + 5);
    r = playCard(r, 0); // ㅏ: 다시 새 체인
    expect(r.chain).toBe(0);
    expect(r.lastVowel).toBe('a');
  });

  it('와일드는 체인을 잇고 에너지가 모자라면 낼 수 없다', () => {
    let r = run({ hand: ['l-a1', 'l-wild', 'l-a2'], energy: 2 });
    r = playCard(r, 0);
    r = playCard(r, 0); // 와일드: chain 1
    expect(r.chain).toBe(1);
    expect(r.lastVowel).toBe('a');
    const before = r;
    r = playCard(r, 0); // 에너지 0
    expect(r).toBe(before);
  });

  it('후크는 다음 카드를 2배로, 브릿지는 체인 끊김을 한 번 막고, 효과 카드는 에너지·드로우를 준다', () => {
    let r = run({ hand: ['l-hook', 'l-a1'], energy: 5 });
    r = playCard(r, 0);
    expect(r.doubleNext).toBe(true);
    const hookGain = r.total;
    r = playCard(r, 0);
    expect(r.total - hookGain).toBe(10); // 5 × 2
    expect(r.doubleNext).toBe(false);

    let b = run({ hand: ['l-a1', 'l-bridge', 'l-eo1'], energy: 5 });
    b = playCard(b, 0);
    b = playCard(b, 0); // 브릿지
    expect(b.keepNext).toBe(true);
    b = playCard(b, 0); // ㅓ: 끊김을 막아 체인 이어짐
    expect(b.chain).toBeGreaterThan(0);
    expect(b.keepNext).toBe(false);

    const e = run({ hand: ['l-sweat'], energy: 1 });
    expect(playCard(e, 0).energy).toBe(2);
    const d = run({ hand: ['l-adlib'], energy: 1, drawPile: ['l-a1', 'l-a1'] });
    expect(playCard(d, 0).hand).toEqual(['l-a1']);
  });

  it('마지막 턴을 끝내면 곡이 완성되고 점수는 완성도에 비례한다 (최대 1000)', () => {
    let r = startLyric(BALANCE.lyric.starter, 21);
    for (let t = 0; t < BALANCE.lyric.turns; t++) {
      expect(r.status).toBe('playing');
      r = endTurn(r);
    }
    expect(r.status).toBe('done');
    expect(lyricScore({ total: BALANCE.lyric.target / 2 })).toBe(500);
    expect(lyricScore({ total: BALANCE.lyric.target * 9 })).toBe(1000);
    expect(endTurn(r)).toBe(r);
  });

  it('전투력 보너스는 위력에 더해지고, 미리보기는 실제 증가량과 같다', () => {
    const r = run({ power: 0.5, hand: ['l-a1'], energy: 3 });
    const def = LYRIC_CARDS.find((c) => c.id === 'l-a1')!;
    expect(previewGain(r, def).gain).toBeCloseTo(7.5);
    expect(playCard(r, 0).total).toBeCloseTo(7.5);
  });

  it('보상 후보는 3장이고 덱 관리는 장수 제한을 지킨다', () => {
    const picks = draftChoices(99);
    expect(picks).toHaveLength(BALANCE.lyric.draft);
    expect(new Set(picks).size).toBe(picks.length);
    expect(draftChoices(99)).toEqual(picks);
    const s = base();
    const more = ok(addLyricCard(s, picks[0]));
    expect(deckSize(more.state.arcade.lyric.cards)).toBe(deckSize(BALANCE.lyric.starter) + 1);
    expect(failReason(addLyricCard(s, 'l-none'))).toBe('not_found');
    let t = s;
    for (let i = 0; i < 30; i++) {
      const r = trimLyricCard(t, Object.keys(t.arcade.lyric.cards)[0]);
      if (!r.ok) break;
      t = r.state;
    }
    expect(deckSize(t.arcade.lyric.cards)).toBe(BALANCE.lyric.minDeck);
    expect(failReason(trimLyricCard(t, Object.keys(t.arcade.lyric.cards)[0]))).toBe('too_few_cards');
  });
});

describe('무한의 계단', () => {
  const settled = (patch: Partial<GameState> = {}) => rollTower(base({ singles: singles(1), ...patch }));

  it('층이 올라갈수록 적이 세지고 5층마다 보스다', () => {
    const s = settled();
    expect(towerEnemy(s, 2).power).toBeGreaterThan(towerEnemy(s, 1).power);
    expect(towerEnemy(s, 5).boss).toBe(true);
    expect(towerEnemy(s, 4).boss).toBe(false);
    expect(towerEnemy(s, 5).power).toBeCloseTo(BALANCE.tower.baseEnemy * BALANCE.tower.growth ** 4 * BALANCE.tower.bossMult);
    expect(towerEnemy(s, 7)).toEqual(towerEnemy(s, 7));
  });

  it('내 전투력은 레벨·장비·수집 보너스가 올린다', () => {
    const s = settled();
    expect(towerPower(s, 'normal')).toBe(BALANCE.tower.basePower);
    const lv = settled({ fans: 20 * 99 * 99 });
    expect(towerPower(lv, 'normal')).toBeGreaterThan(towerPower(s, 'normal') * 10);
    const gear = settled({ equipment: { mic: 10, studio: 10, promotion: 0 } });
    expect(towerPower(gear, 'normal')).toBeCloseTo(BALANCE.tower.basePower * (1 + BALANCE.tower.perGear * 20));
    expect(towerPower(gear, 'dark')).toBe(BALANCE.tower.basePower); // 어둠 장비는 따로
  });

  it('승산 계산: 전투력이 충분하면 100%, 모자라면 0%', () => {
    expect(winChance(100, 50)).toBe(1);
    expect(winChance(10, 100)).toBe(0);
    expect(winChance(100, 100)).toBeCloseTo(0.5);
  });

  it('이기면 다음 층으로, 첫 클리어 보상은 한 번만, 지면 쉬어야 한다', () => {
    let s = settled({ fans: 1e6 }); // 아주 강함
    const r = ok(climbTower(s, 'normal'));
    expect(r.outcome.win).toBe(true);
    expect(r.outcome.first).toBe(true);
    expect(r.outcome.coins).toBeGreaterThan(0);
    expect(r.state.arcade.tower.floor).toBe(2);
    expect(r.state.arcade.tower.best).toBe(1);
    expect(r.state.counters.towerClears).toBe(1);
    expect(failReason(climbTower(r.state, 'normal'))).toBe('cooldown');
    s = at(r.state, T0 + BALANCE.tower.winCooldownMs);
    // 이미 깬 층을 다시 깨도 보상이 없다: 층을 되돌려 확인
    const again = ok(climbTower({ ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, floor: 1 } } }, 'normal'));
    expect(again.outcome.first).toBe(false);
    expect(again.outcome.coins).toBe(0);

    const weak = settled();
    const lost = ok(climbTower({ ...weak, arcade: { ...weak.arcade, tower: { ...weak.arcade.tower, floor: 60 } } }, 'normal'));
    expect(lost.outcome.win).toBe(false);
    expect(lost.state.arcade.tower.floor).toBe(60);
    expect(lost.state.arcade.tower.cooldownUntil).toBe(T0 + BALANCE.tower.failCooldownMs);
    expect(lost.state.arcade.tower.attempts).toBe(1);
  });

  it('보스층과 10층마다 다이아를 준다', () => {
    const s = settled({ fans: 1e9 });
    const boss = ok(climbTower({ ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, floor: 5 } } }, 'normal'));
    expect(boss.outcome.diamonds).toBe(BALANCE.tower.bossDiamonds);
    const ten = ok(climbTower({ ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, floor: 10 } } }, 'normal'));
    expect(ten.outcome.diamonds).toBe(BALANCE.tower.bossDiamonds + BALANCE.tower.milestoneDiamonds);
  });

  it('새 주가 되면 1층부터 다시 시작하고 최고 기록은 남는다', () => {
    let s = settled({ fans: 1e6 });
    s = ok(climbTower(s, 'normal')).state;
    expect(s.arcade.tower.week).toBe(weekKey(T0));
    expect(rollTower(s)).toBe(s); // 같은 주에는 그대로
    const next = rollTower(at(s, T0 + 7 * 24 * 3600_000));
    expect(next.arcade.tower.floor).toBe(1);
    expect(next.arcade.tower.best).toBe(1);
    expect(next.arcade.tower.claimed).toEqual([]);
    expect(towerStatus(next).floor).toBe(1);
  });

  it('첫 싱글 전에는 도전할 수 없다', () => {
    expect(failReason(climbTower(base(), 'normal'))).toBe('need_single');
  });
});

describe('피켓팅', () => {
  it('씨앗이 같으면 같은 보안문자와 오픈 시각', () => {
    const a = createTicketing(9);
    expect(createTicketing(9)).toEqual(a);
    expect(a.code).toHaveLength(BALANCE.ticketing.captchaDigits);
    expect(a.openAtMs).toBeGreaterThanOrEqual(BALANCE.ticketing.waitMs[0]);
    expect(a.openAtMs).toBeLessThanOrEqual(BALANCE.ticketing.waitMs[1]);
  });

  it('오픈 전에 누르면 부정 출발로 반응 점수가 0이다', () => {
    const g = pressTicket(createTicketing(9), 100);
    expect(g.falseStart).toBe(true);
    expect(g.phase).toBe('captcha');
    expect(reactionScore(g)).toBe(0);
  });

  it('빠르게 누르고 보안문자를 맞히면 높은 점수, 틀리면 반응 점수만', () => {
    let g = createTicketing(9);
    g = tickTicketing(g, g.openAtMs + 1);
    expect(g.phase).toBe('open');
    g = pressTicket(g, g.openAtMs + 150);
    expect(g.reactionMs).toBe(150);
    expect(reactionScore(g)).toBe(BALANCE.ticketing.reactionMax);
    const t0 = g.captchaStartMs!;
    const right = submitCode(g, t0 + 1000, g.code);
    expect(right.captchaOk).toBe(true);
    expect(scoreOf(right)).toBeGreaterThan(BALANCE.ticketing.reactionMax + BALANCE.ticketing.captchaBase);
    expect(scoreOf(right)).toBeLessThanOrEqual(1000);
    const wrong = submitCode(g, t0 + 1000, '00000x');
    expect(wrong.captchaOk).toBe(false);
    expect(scoreOf(wrong)).toBe(BALANCE.ticketing.reactionMax);
    expect(captchaScore(wrong)).toBe(0);
  });

  it('반응이 늦을수록 점수가 줄고, 보안문자 제한 시간이 지나면 실패한다', () => {
    let g = createTicketing(9);
    g = tickTicketing(g, g.openAtMs);
    const slow = pressTicket(g, g.openAtMs + BALANCE.ticketing.reactionWorstMs);
    expect(reactionScore(slow)).toBe(0);
    const mid = pressTicket(g, g.openAtMs + 575);
    expect(reactionScore(mid)).toBeLessThan(BALANCE.ticketing.reactionMax);
    expect(reactionScore(mid)).toBeGreaterThan(0);
    const late = tickTicketing(mid, mid.captchaStartMs! + BALANCE.ticketing.captchaMs + 1);
    expect(late.phase).toBe('done');
    expect(late.captchaOk).toBe(false);
    expect(createTicketing(9, 0.3).grace).toBe(0.3);
    expect(createTicketing(9, 5).grace).toBe(0.3);
  });

  it('배율은 시간 안에 한 번만 쓰이고 내림으로 곱해진다', () => {
    const s = base();
    expect(applyTicketBoost(s, 100)).toEqual({ state: s, coins: 100, boosted: false });
    const boosted = { ...s, arcade: { ...s.arcade, ticketing: { ...s.arcade.ticketing, boost: { mult: 1.55, until: T0 + 1000 } } } };
    const r = applyTicketBoost(boosted, 101);
    expect(r.coins).toBe(Math.floor(101 * 1.55));
    expect(r.boosted).toBe(true);
    expect(r.state.arcade.ticketing.boost).toBeNull();
  });
});

describe('Wrapped·통계', () => {
  it('자아별로 쓴 시간을 센다 (오프라인 상한 뒤 시간은 세지 않는다)', () => {
    const s = base();
    const online = advance(s, 60_000).state;
    expect(online.stats.normalMs).toBe(60_000);
    expect(online.stats.darkMs).toBe(0);
    const dark = advance({ ...s, activePersona: 'dark' }, 30_000).state;
    expect(dark.stats.darkMs).toBeGreaterThan(0);
    expect(dark.stats.normalMs + dark.stats.darkMs).toBe(30_000);
    const away = settleOffline(s, T0 + BALANCE.offline.capMs + 3 * 3600_000).state;
    expect(away.stats.normalMs).toBe(BALANCE.offline.capMs);
  });

  it('슬라이드는 기록에서만 만들고 자아 비율에 따라 총평이 달라진다', () => {
    let s = base({ singles: singles(2), fans: 400 });
    s = { ...s, counters: { ...s.counters, works: 1234, dawnWorks: 5, seizures: 3 }, stats: { normalMs: 1000, darkMs: 9000, nicks: { 달: 3, 별: 7 }, notes: [] } };
    const w = buildWrapped(s, T0);
    expect(w.year).toBe(2026);
    expect(w.headline).toBe(wrappedHeadline(0.1));
    expect(w.headline).toContain('어둠');
    expect(w.slides.find((x) => x.id === 'works')?.big).toBe('1,234번');
    expect(w.slides.find((x) => x.id === 'persona')?.big).toBe('어둠 90%');
    expect(w.slides.find((x) => x.id === 'topfan')?.big).toBe('별');
    expect(wrappedHeadline(null)).toContain('막 시작');
    expect(wrappedHeadline(0.5)).toContain('균형');
    expect(wrappedHeadline(0.9)).toContain('햇빛');
    expect(buildWrapped(base(), T0).slides.length).toBe(w.slides.length);
  });
});

describe('서버 보상 반영', () => {
  it('챌린지 보상은 다이아를 더하고 3위 안의 글은 가사 노트에 남긴다', () => {
    const s = base();
    const top = ok(applyChallengeClaim(s, 10, 1, '새벽 세 시의 한 줄'));
    expect(top.state.diamonds).toBe(10);
    expect(top.noted).toBe(true);
    expect(top.state.stats.notes).toEqual(['새벽 세 시의 한 줄']);
    expect(ok(applyChallengeClaim(top.state, 1, 1, '새벽 세 시의 한 줄')).noted).toBe(false); // 같은 글은 한 번만
    expect(ok(applyChallengeClaim(s, 1, 7, '순위권 밖')).noted).toBe(false);
    expect(ok(applyChallengeClaim(s, 99999, 1, 'x')).diamonds).toBe(50); // 비정상 값은 잘라낸다
    expect(ok(applyChallengeClaim(s, Number.NaN, 1, 'y')).diamonds).toBe(0);
  });

  it('차트 보상은 카운터를 올린다', () => {
    const r = ok(applyChartClaim(base(), 5, true));
    expect(r.state.diamonds).toBe(5);
    expect(r.state.counters.chartTop10).toBe(1);
    expect(r.state.counters.chartNo1).toBe(1);
    expect(ok(applyChartClaim(base(), 1, false)).state.counters.chartNo1).toBe(0);
  });
});

describe('업적·알림 연결', () => {
  it('새 업적 지표가 상태에서 읽힌다', () => {
    let s = base({ singles: singles(3) });
    s = { ...s, photo: { ...s.photo, owned: { 'p1-1': 1, 'p1-2': 2, 'p2-1': 1 } } };
    s = { ...s, feat: { ...s.feat, owned: { 'f-han': 1, 'f-moon': 2 } } };
    s = { ...s, mascot: { ...s.mascot, dark: { ...s.mascot.dark, xp: 250 } } };
    s = { ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, best: 11 }, survival: { ...s.arcade.survival, best: 910 } } };
    expect(achievementValue(s, 'photoCards')).toBe(3);
    expect(achievementValue(s, 'photoSets')).toBe(0);
    expect(achievementValue(s, 'featOwned')).toBe(2);
    expect(achievementValue(s, 'mascotStage')).toBe(3);
    expect(achievementValue(s, 'towerBest')).toBe(11);
    expect(achievementValue(s, 'survivalBest')).toBe(910);
    expect(ACHIEVEMENTS.filter((a) => a.metric === 'photoSets')).toHaveLength(2);
  });
});

describe('샘플러(순수 부분)', () => {
  it('앞뒤 무음을 자르고 최대 길이로 줄이고 키운다', () => {
    const rate = 1000;
    const pcm = new Float32Array(5000);
    for (let i = 1000; i < 2000; i++) pcm[i] = 0.3 * Math.sin(i / 5);
    const out = processSample(pcm, rate)!;
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.length).toBeGreaterThan(900);
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(0.9, 2);
    const long = new Float32Array(10_000).fill(0.5);
    expect(processSample(long, rate)!.length).toBe(3000); // 3초
    expect(processSample(new Float32Array(100), rate)).toBeNull();
    expect(processSample(new Float32Array(100).fill(0.001), rate)).toBeNull();
  });

  it('패턴과 박자', () => {
    expect(emptyPattern()).toHaveLength(PAD_RATES.length);
    expect(emptyPattern().every((r) => r.length === 8 && r.every((v) => !v))).toBe(true);
    expect(defaultPattern().flat().some(Boolean)).toBe(true);
    expect(stepSeconds(120)).toBeCloseTo(0.25);
    expect(stepSeconds(60)).toBeCloseTo(0.5);
  });
});
