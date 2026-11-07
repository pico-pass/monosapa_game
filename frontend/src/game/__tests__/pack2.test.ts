import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TrackClock, audibleTime, expectedSamples, leadingSamples } from '../../audio/track';
import { PAD_RATES, defaultPattern, emptyPattern, processSample, stepSeconds } from '../../audio/sampler';
import { ACHIEVEMENTS, BALANCE, FEAT_IDS, FEAT_LEGACY_IDS, FEAT_NPCS, LYRIC_CARDS, PHOTO_CARD_IDS, photoCardId } from '../balance';
import { abandonArcade, arcadeBlocked, beginArcade, finishArcade, firstGradeDiamonds, gradeOf } from '../arcade';
import { FEAT_RARITY_NAME, FEAT_TEXT } from '../content';
import { beginManualConcert, finishManualConcert, releaseSingle, runAutoConcert } from '../commands';
import { featPull, rollFeat, toggleFeat } from '../featuring';
import { tallyNick } from '../fanmail';
import { addLyricCard, deckSize, draftChoices, endTurn, lyricScore, playCard, previewGain, startLyric, trimLyricCard, type LyricRun } from '../lyricdeck';
import { claimPresent, feedCost, feedMascot, giftMascot, mascotView, playMascot } from '../mascot';
import { weekKey } from '../missions';
import { bonuses, cardRarityOf, completedSets, featPassive, mascotMood, mascotStage, pickupOf, songCardOf } from '../packdata';
import { buyTickets, craftPhoto, dismantlePhoto, giveCard, photoPull, rollPhoto, settleSets, takeCard } from '../photocards';
import { createInitialState, validateState } from '../persistence';
import { buildChart, createRhythm, isRhythmFinished, pressLane, rhythmScore, tickTo } from '../rhythm';
import { achievementValue, clickGain, offlineCapMs, previewSingle, rhymeRate } from '../selectors';
import { applyChallengeClaim, applyChartClaim, applyMailClaim } from '../serverRewards';
import { advance, settleOffline } from '../simulation';
import { remasterCard, toggleDeck } from '../songcards';
import { TRACKS, slotMs, trackOfRun, trackOfSingle, trackSingles } from '../songcharts';
import { SurvivalGame } from '../survival';
import { applyTicketBoost, captchaScore, createTicketing, pressTicket, reactionScore, scoreOf, submitCode, tickTicketing } from '../ticketing';
import { beginTower, finishTower, rollTower, towerEnemy, towerPower, towerStatus } from '../tower';
import { TowerBattle, bossTuning, difficultyOf } from '../towerbattle';
import type { GameState, Single } from '../types';
import { buildWrapped, wrappedHeadline } from '../wrapped';

const T0 = new Date(2026, 9, 28, 12, 0, 0).getTime(); // 수요일 낮
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const singles = (n: number, persona: Single['persona'] = 'normal'): Single[] => Array.from({ length: n }, (_, i) => ({ id: `single-${i + 1}`, persona, title: `곡${i + 1}`, releasedAt: T0 }));
/** 리듬 모드로 플레이할 수 있는 음원 곡 싱글 */
const loveSingle = (id: string): Single => ({ id, persona: 'dark', title: '정신병자러브', releasedAt: T0 });
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
    s = { ...s, feat: { ...s.feat, owned: { 'f-alfrado': 3, 'f-scails': 1 }, slots: ['f-alfrado'], pity: 8, guaranteed: true } };
    s = { ...s, cards: { ...s.cards, deck: ['single-2'], remaster: { 'single-2': 2 } } };
    s = { ...s, mascot: { ...s.mascot, dark: { xp: 90, fullUntil: T0 + 5000, playReadyAt: 0, giftReadyAt: T0, fed: 7 } } };
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
    raw.feat.owned = { 'f-alfrado': 1, 'f-nope': 2 };
    raw.cards.deck = ['single-1', 'single-99'];
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.state.photo.owned).toEqual({ 'p1-1': 1 });
      expect(v.state.feat.owned).toEqual({ 'f-alfrado': 1 });
      expect(v.state.cards.deck).toEqual(['single-1']);
    }
    type Mutate = (r: Record<string, any>) => unknown;
    const mutations: Mutate[] = [(r) => (r.photo.tickets = -1), (r) => (r.feat.owned['f-alfrado'] = 99), (r) => (r.arcade.survival.best = 1001), (r) => (r.mascot.normal.xp = 1.5)];
    for (const mutate of mutations) {
      const bad = JSON.parse(JSON.stringify(base({ singles: singles(1) })));
      bad.feat.owned = { 'f-alfrado': 1 };
      mutate(bad);
      expect(validateState(bad).ok).toBe(false);
    }
  });
});

describe('수집 보너스', () => {
  it('아무것도 없으면 보너스가 0이라 기존 수치가 그대로다', () => {
    const s = base({ singles: singles(2) });
    const b = bonuses(s);
    expect(b).toEqual({ rhyme: { normal: 0, dark: 0 }, coin: 0, coinBy: { normal: 0, dark: 0 }, fan: 0, power: 0, offlineMs: 0 });
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
    s = { ...s, feat: { ...s.feat, owned: { 'f-scails': 1 }, slots: ['f-scails'] } }; // 전설 라임
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
    expect(ten.def.rarity === 'N').toBe(false); // 10연 마지막은 레어 이상
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
    expect(r.results.some((x) => x.rarity !== 'N')).toBe(true); // 10연에는 레어 이상이 하나는 있다
    let s = base();
    s = { ...s, feat: { ...s.feat, owned: { 'f-alfrado': 1, 'f-haname': 1, 'f-seungcheon': 1, 'f-0ik2': 1 } } };
    for (const id of ['f-alfrado', 'f-haname', 'f-seungcheon']) s = ok(toggleFeat(s, id)).state;
    expect(failReason(toggleFeat(s, 'f-0ik2'))).toBe('full_slots');
    expect(failReason(toggleFeat(s, 'f-ghostclub'))).toBe('not_owned');
    expect(ok(toggleFeat(s, 'f-alfrado')).equipped).toBe(false);
  });

  it('래퍼 명단은 일반 5 · 레어 5 · 에픽 6 · 전설 5명이고 이름·소개·등급 값이 모두 있다', () => {
    const count = (r: string) => FEAT_NPCS.filter((n) => n.rarity === r).length;
    expect([count('N'), count('R'), count('SR'), count('SSR')]).toEqual([5, 5, 6, 5]);
    expect(FEAT_NPCS).toHaveLength(21);
    expect(new Set(FEAT_IDS).size).toBe(21);
    const names = FEAT_NPCS.map((n) => FEAT_TEXT[n.id]?.name);
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(21);
    expect(FEAT_NPCS.every((n) => FEAT_TEXT[n.id].blurb && FEAT_TEXT[n.id].icon)).toBe(true);
    expect(['Alfrado', '한아메', '†昇天†', '0ik2', '새림']).toEqual(FEAT_NPCS.filter((n) => n.rarity === 'N').map((n) => FEAT_TEXT[n.id].name));
    expect(['강유시', 'Upia', 'feiz', 'p4rki', '눈알고기']).toEqual(FEAT_NPCS.filter((n) => n.rarity === 'R').map((n) => FEAT_TEXT[n.id].name));
    expect(['소희', 'Truman', 'pshine', 'ch1tkey', 'k4ton', '룰더']).toEqual(FEAT_NPCS.filter((n) => n.rarity === 'SR').map((n) => FEAT_TEXT[n.id].name));
    expect(['Scails', 'hamo', '고스트클럽', '최성', 'ruru']).toEqual(FEAT_NPCS.filter((n) => n.rarity === 'SSR').map((n) => FEAT_TEXT[n.id].name));
    expect(Object.values(FEAT_RARITY_NAME)).toEqual(['일반', '레어', '에픽', '전설']);
    for (const r of ['N', 'R', 'SR', 'SSR'] as const) {
      expect(BALANCE.feat.passive[r]).toBeGreaterThan(0);
      expect(BALANCE.feat.dupRefund[r]).toBeGreaterThan(0);
    }
    const rates = BALANCE.feat.rates;
    expect(rates.N + rates.R + rates.SR + rates.SSR).toBeCloseTo(1, 10);
    expect(BALANCE.feat.passive.N).toBeLessThan(BALANCE.feat.passive.R);
    expect(BALANCE.feat.passive.R).toBeLessThan(BALANCE.feat.passive.SR);
    expect(BALANCE.feat.passive.SR).toBeLessThan(BALANCE.feat.passive.SSR);
  });

  it('뽑기 비율은 등급 확률을 따르고 21명 모두 나올 수 있으며 10연 마지막은 일반이 아니다', () => {
    const pickup = pickupOf(T0);
    const tally = { N: 0, R: 0, SR: 0, SSR: 0 };
    const seen = new Set<string>();
    const total = 30000;
    for (let seq = 1; seq <= total; seq++) {
      const roll = rollFeat(7, seq, 0, false, pickup, false);
      tally[roll.def.rarity] += 1;
      seen.add(roll.def.id);
    }
    const rates = BALANCE.feat.rates;
    for (const r of ['N', 'R', 'SR', 'SSR'] as const) expect(Math.abs(tally[r] / total - rates[r])).toBeLessThan(0.01);
    expect(seen.size).toBe(FEAT_NPCS.length);
    for (let seq = 1; seq <= 2000; seq++) expect(rollFeat(11, seq, 0, false, pickup, true).def.rarity).not.toBe('N');
  });

  it('12명 시절 저장은 같은 등급 자리의 새 래퍼로 옮겨 별과 장착을 지킨다', () => {
    const raw = JSON.parse(JSON.stringify(base({ singles: singles(1) })));
    raw.feat.owned = { 'f-han': 2, 'f-pc': 1, 'f-void': 6, 'f-nope': 3 };
    raw.feat.slots = ['f-han', 'f-void', 'f-nope'];
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.state.feat.owned).toEqual({ 'f-alfrado': 2, 'f-gangyusi': 1, 'f-ghostclub': 6 });
    expect(v.state.feat.slots).toEqual(['f-alfrado', 'f-ghostclub']);
    for (const target of Object.values(FEAT_LEGACY_IDS)) expect(FEAT_IDS).toContain(target);
    expect(new Set(Object.values(FEAT_LEGACY_IDS)).size).toBe(Object.keys(FEAT_LEGACY_IDS).length);
    expect(Object.keys(FEAT_LEGACY_IDS).some((id) => FEAT_IDS.includes(id))).toBe(false);
  });

  it('피처링 별은 패시브를 키운다', () => {
    let s = base();
    s = { ...s, feat: { ...s.feat, owned: { 'f-gangyusi': 1 }, slots: ['f-gangyusi'] } }; // 레어 인세
    const one = bonuses(s).coin;
    s = { ...s, feat: { ...s.feat, owned: { 'f-gangyusi': 4 } } };
    expect(bonuses(s).coin).toBeCloseTo(one * (1 + 3 * BALANCE.feat.starBonus));
  });

  it('별은 10개까지 오르고 별마다 패시브가 같은 폭으로 커진다', () => {
    expect(BALANCE.feat.maxStar).toBe(10);
    const def = FEAT_NPCS.find((n) => n.rarity === 'SSR')!;
    let prev = featPassive(def, 1);
    expect(prev).toBeCloseTo(BALANCE.feat.passive.SSR);
    for (let stars = 2; stars <= BALANCE.feat.maxStar; stars++) {
      const now = featPassive(def, stars);
      expect(now - prev).toBeCloseTo(BALANCE.feat.passive.SSR * BALANCE.feat.starBonus);
      prev = now;
    }
    expect(featPassive(def, BALANCE.feat.maxStar)).toBeCloseTo(BALANCE.feat.passive.SSR * 1.9);
  });

  it('별 6개로 저장된 래퍼도 계속 별이 오르고, 환급은 10개가 찬 뒤부터다', () => {
    const id = 'f-alfrado';
    const withStars = (n: number): GameState => {
      const s = base({ diamonds: 100000 });
      return { ...s, feat: { ...s.feat, owned: { [id]: n } } };
    };
    // 저장 검증: 상한(10)까지는 그대로 읽고 넘으면 거부한다
    for (const n of [6, BALANCE.feat.maxStar]) {
      const v = validateState(JSON.parse(JSON.stringify(withStars(n))));
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.state.feat.owned[id]).toBe(n);
    }
    expect(validateState(JSON.parse(JSON.stringify(withStars(BALANCE.feat.maxStar + 1)))).ok).toBe(false);
    // 같은 래퍼가 또 나오면 6 → 7, 환급 없음
    let t = withStars(6);
    let hit: ReturnType<typeof featPull> | null = null;
    for (let i = 0; i < 400 && !hit; i++) {
      const r = ok(featPull(t, 1));
      t = r.state;
      if (r.results[0].id === id) hit = r;
    }
    const got = ok(hit!);
    expect(got.results[0].starUp).toBe(true);
    expect(got.results[0].refund).toBe(0);
    expect(got.state.feat.owned[id]).toBe(7);
  });
});

describe('마스코트', () => {
  it('간식은 코인을 쓰고 배부름·xp를 올리고, 놀아주기는 쿨다운이 있다', () => {
    let s = base({ coins: 1000, singles: singles(1) });
    const cost = feedCost(0);
    expect(failReason(feedMascot({ ...s, coins: cost - 1 }, 'normal'))).toBe('insufficient_coins');
    s = ok(feedMascot(s, 'normal')).state;
    expect(s.coins).toBe(1000 - cost);
    expect(s.mascot.normal.fed).toBe(1);
    expect(s.mascot.normal.xp).toBe(BALANCE.mascot.feed.xp);
    expect(mascotMood(s.mascot.normal, T0)).toBe('happy');
    expect(s.counters.pets).toBe(1);
    s = ok(playMascot(s, 'normal')).state;
    expect(failReason(playMascot(s, 'normal'))).toBe('cooldown');
    expect(mascotView(at(s, T0 + BALANCE.mascot.play.cooldownMs), 'normal').playWaitMs).toBe(0);
  });

  it('간식 값은 줄 때마다 1.0175배씩 오르고 500번 뒤로는 오르지 않으며 마스코트마다 따로 센다', () => {
    expect(BALANCE.mascot.feed.growth).toBe(1.0175);
    expect(BALANCE.mascot.feed.maxRaises).toBe(500);
    expect([feedCost(0), feedCost(1), feedCost(2), feedCost(10), feedCost(100)]).toEqual([90, 92, 94, 108, 511]);
    expect(feedCost(200) / feedCost(199)).toBeCloseTo(BALANCE.mascot.feed.growth, 2);
    expect(feedCost(499)).toBe(517508);
    expect(feedCost(500)).toBe(526565);
    for (const n of [501, 502, 1000, 100000]) expect(feedCost(n)).toBe(feedCost(500));
    let s = base({ coins: 1e6, singles: singles(1) });
    let paid = 0;
    for (let i = 0; i < 5; i++) {
      const r = ok(feedMascot(s, 'normal'));
      expect(r.cost).toBe(feedCost(i));
      expect(s.coins - r.state.coins).toBe(r.cost);
      paid += r.cost;
      s = r.state;
    }
    expect(s.mascot.normal.fed).toBe(5);
    expect(s.mascot.dark.fed).toBe(0);
    expect(paid).toBe([0, 1, 2, 3, 4].reduce((sum, i) => sum + feedCost(i), 0));
    expect(ok(feedMascot(s, 'dark')).cost).toBe(feedCost(0)); // 어둠 마스코트는 처음 값부터
    // 플레이어 레벨(팬)이 아무리 높아도 값은 먹인 횟수로만 정해진다
    const rich = { ...s, fans: 1e9 };
    expect(ok(feedMascot(rich, 'normal')).cost).toBe(feedCost(5));
    // 값이 모자라면 실패하고 횟수는 그대로
    const poor = { ...s, coins: feedCost(5) - 1 };
    expect(failReason(feedMascot(poor, 'normal'))).toBe('insufficient_coins');
    expect(poor.mascot.normal.fed).toBe(5);
  });

  it('간식 횟수 필드가 없는 예전 저장은 0부터 세고 이상한 값은 거부한다', () => {
    const raw = JSON.parse(JSON.stringify(base({ singles: singles(1) })));
    delete raw.mascot.normal.fed;
    delete raw.mascot.dark.fed;
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (v.ok) expect([v.state.mascot.normal.fed, v.state.mascot.dark.fed]).toEqual([0, 0]);
    for (const fed of [-1, 1.5, 2e9]) {
      const bad = JSON.parse(JSON.stringify(base({ singles: singles(1) })));
      bad.mascot.normal.fed = fed;
      expect(validateState(bad).ok).toBe(false);
    }
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
    s = ok(feedMascot(s, 'normal')).state;
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
    const s = base({ singles: [loveSingle('single-1')], fans: 500 });
    const e = ok(beginArcade(s, 'rhythm', 'a', { target: 'single-1', level: 'easy' }));
    const h = ok(beginArcade(at(s, T0 + 1e6), 'rhythm', 'b', { target: 'single-1', level: 'hard' }));
    const ce = ok(finishArcade(e.state, e.run, 800)).outcome.coins;
    const ch = ok(finishArcade(h.state, h.run, 800)).outcome.coins;
    expect(ch).toBeGreaterThanOrEqual(ce);
    expect(ok(finishArcade(e.state, e.run, 800)).state.arcade.rhythm.songs).toEqual({ 'single-1': 800 });
    expect(failReason(beginArcade(s, 'rhythm', 'c', { target: 'single-9' }))).toBe('not_found');
    // 같은 곡은 항상 같은 채보 씨앗
    expect(ok(beginArcade(s, 'rhythm', 'x', { target: 'single-1' })).run.seed).toBe(e.run.seed);
  });

  it('리듬 모드는 음원 곡(어둠속성 「정신병자러브」)으로만 시작할 수 있다', () => {
    // 싱글이 없거나 음원 곡이 하나도 없으면 잠겨 있고, 다른 아케이드는 그대로 열려 있다
    const plain = base({ singles: singles(2) });
    expect(arcadeBlocked(base(), 'rhythm')).toBe('need_track');
    expect(arcadeBlocked(plain, 'rhythm')).toBe('need_track');
    expect(arcadeBlocked(plain, 'survival')).toBeNull();
    const refused = beginArcade(plain, 'rhythm', 'a', { target: 'single-1' });
    expect(failReason(refused)).toBe('need_track');
    expect(refused.state).toBe(plain); // 거절하면 쿨다운도 걸리지 않는다
    // 제목이 같아도 일반속성 싱글은 음원 곡이 아니다
    const normalLove = base({ singles: [{ ...loveSingle('single-1'), persona: 'normal' }] });
    expect(arcadeBlocked(normalLove, 'rhythm')).toBe('need_track');
    // 음원 곡이 있으면 열리지만, 음원 곡이 아닌 싱글을 고르면 거절된다
    const mixed = base({ singles: [...singles(1), loveSingle('single-2')] });
    expect(arcadeBlocked(mixed, 'rhythm')).toBeNull();
    expect(failReason(beginArcade(mixed, 'rhythm', 'a', { target: 'single-1' }))).toBe('need_track');
    expect(failReason(beginArcade(mixed, 'rhythm', 'a', { target: 'single-9' }))).toBe('not_found');
    expect(failReason(beginArcade(mixed, 'rhythm', 'a'))).toBe('not_found');
    const started = ok(beginArcade(mixed, 'rhythm', 'a', { target: 'single-2' }));
    expect(started.run.target).toBe('single-2');
    expect(started.state.arcade.rhythm.cooldownUntil).toBe(T0 + BALANCE.arcade.kinds.rhythm.cooldownMs);
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
  const T = BALANCE.tower;

  it('층이 올라갈수록 적이 세지고 5층마다 보스다', () => {
    const s = settled();
    expect(towerEnemy(s, 2).power).toBeGreaterThan(towerEnemy(s, 1).power);
    expect(towerEnemy(s, 5).boss).toBe(true);
    expect(towerEnemy(s, 4).boss).toBe(false);
    expect(towerEnemy(s, 5).power).toBeCloseTo(T.baseEnemy * T.growth ** 4 * T.bossMult);
    expect(towerEnemy(s, 7)).toEqual(towerEnemy(s, 7));
  });

  it('내 전투력은 레벨·장비·수집 보너스가 올린다', () => {
    const s = settled();
    expect(towerPower(s, 'normal')).toBe(T.basePower);
    const lv = settled({ fans: 20 * 99 * 99 });
    expect(towerPower(lv, 'normal')).toBeGreaterThan(towerPower(s, 'normal') * 10);
    const gear = settled({ equipment: { mic: 10, studio: 10, promotion: 0 } });
    expect(towerPower(gear, 'normal')).toBeCloseTo(T.basePower * (1 + T.perGear * 20));
    expect(towerPower(gear, 'dark')).toBe(T.basePower); // 어둠 장비는 따로
  });

  it('전투력 비율로 난이도를 나눈다', () => {
    expect([2, 1.6, 1.3, 1.1, 0.9, 0.75, 0.5].map(difficultyOf)).toEqual(['easy', 'easy', 'normal', 'normal', 'hard', 'hard', 'brutal']);
    const st = towerStatus(settled({ fans: 1e6 }));
    expect(st.difficulty.normal).toBe('easy');
    expect(towerStatus(settled()).ratio.normal).toBeCloseTo(towerStatus(settled()).power.normal / towerEnemy(settled(), 1).power);
  });

  it('시작하면 쿨다운이 확정되고 시도 횟수가 오르며, 쿨다운 중에는 시작할 수 없다', () => {
    const s = settled();
    const r = ok(beginTower(s, 'normal', 'tw1'));
    expect(r.run).toMatchObject({ id: 'tw1', persona: 'normal', floor: 1, status: 'running' });
    expect(r.state.arcade.tower.cooldownUntil).toBe(T0 + T.failCooldownMs);
    expect(r.state.arcade.tower.attempts).toBe(1);
    expect(r.state.arcade.tower.floor).toBe(1); // 이기기 전에는 층이 오르지 않는다
    expect(failReason(beginTower(r.state, 'normal', 'tw2'))).toBe('cooldown');
    expect(ok(beginTower(at(r.state, T0 + T.failCooldownMs), 'dark', 'tw3')).run.persona).toBe('dark');
    expect(failReason(beginTower(base(), 'normal', 'x'))).toBe('need_single');
    // 약점 자아로 도전하면 전투력이 weakMult배
    const enemy = towerEnemy(s, 1);
    const weak = ok(beginTower(s, enemy.weak, 'a')).run;
    const other = ok(beginTower(s, enemy.weak === 'normal' ? 'dark' : 'normal', 'b')).run;
    expect(weak.power).toBeCloseTo(other.power * T.weakMult);
    expect(weak.ratio).toBeCloseTo(weak.power / enemy.power);
  });

  it('지면 보상이 없고 쿨다운은 그대로, 이기면 다음 층·첫 보상·쿨다운 해제', () => {
    const s = settled({ fans: 1e6 });
    const begun = ok(beginTower(s, 'normal', 'tw1'));
    const lost = ok(finishTower(begun.state, begun.run, false));
    expect(lost.outcome.win).toBe(false);
    expect(lost.state).toBe(begun.state);
    expect(lost.state.arcade.tower.floor).toBe(1);
    expect(lost.state.arcade.tower.cooldownUntil).toBe(T0 + T.failCooldownMs);

    const won = ok(finishTower(begun.state, begun.run, true));
    expect(won.outcome).toMatchObject({ win: true, first: true, newBest: true, floor: 1 });
    expect(won.outcome.coins).toBeGreaterThan(0);
    expect(won.state.arcade.tower).toMatchObject({ floor: 2, best: 1, claimed: [1], cooldownUntil: T0 + T.winCooldownMs });
    expect(won.state.counters.towerClears).toBe(1);
    expect(won.state.coins).toBe(s.coins + won.outcome.coins);
    // 이긴 직후에는 바로 다음 층에 도전할 수 있다
    expect(beginTower(won.state, 'normal', 'tw2').ok).toBe(true);
    // 같은 도전은 한 번만 정산된다
    expect(failReason(finishTower(won.state, won.run, true))).toBe('session_closed');
  });

  it('이미 깬 층은 보상이 없고, 주가 바뀌어 층이 달라졌으면 받아들이지 않는다', () => {
    const s = settled({ fans: 1e6 });
    const first = ok(finishTower(ok(beginTower(s, 'normal', 'a')).state, ok(beginTower(s, 'normal', 'a')).run, true)).state;
    const replay = { ...first, arcade: { ...first.arcade, tower: { ...first.arcade.tower, floor: 1, cooldownUntil: 0 } } };
    const b = ok(beginTower(replay, 'normal', 'b'));
    const again = ok(finishTower(b.state, b.run, true));
    expect(again.outcome).toMatchObject({ first: false, coins: 0, diamonds: 0, newBest: false });

    const at3 = { ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, floor: 3 } } };
    const c = ok(beginTower(at3, 'normal', 'c'));
    const rolled = rollTower(at(c.state, T0 + 7 * 24 * 3600_000));
    expect(rolled.arcade.tower.floor).toBe(1);
    expect(failReason(finishTower(rolled, c.run, true))).toBe('not_ready'); // 새 주: 층이 1로 돌아왔는데 run은 3층 기록
    expect(ok(finishTower(rolled, c.run, false)).outcome.win).toBe(false); // 패배 정산은 항상 가능
  });

  it('보스층과 10층마다 다이아를 준다', () => {
    const s = settled({ fans: 1e9 });
    const at5 = { ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, floor: 5 } } };
    const boss = ok(beginTower(at5, 'normal', 'b5'));
    expect(ok(finishTower(boss.state, boss.run, true)).outcome.diamonds).toBe(T.bossDiamonds);
    const at10 = { ...s, arcade: { ...s.arcade, tower: { ...s.arcade.tower, floor: 10 } } };
    const ten = ok(beginTower(at10, 'normal', 'b10'));
    expect(ok(finishTower(ten.state, ten.run, true)).outcome.diamonds).toBe(T.bossDiamonds + T.milestoneDiamonds);
  });

  it('새 주가 되면 1층부터 다시 시작하고 최고 기록은 남는다', () => {
    let s = settled({ fans: 1e6 });
    const b = ok(beginTower(s, 'normal', 'a'));
    s = ok(finishTower(b.state, b.run, true)).state;
    expect(s.arcade.tower.week).toBe(weekKey(T0));
    expect(rollTower(s)).toBe(s); // 같은 주에는 그대로
    const next = rollTower(at(s, T0 + 7 * 24 * 3600_000));
    expect(next.arcade.tower.floor).toBe(1);
    expect(next.arcade.tower.best).toBe(1);
    expect(next.arcade.tower.claimed).toEqual([]);
    expect(towerStatus(next).floor).toBe(1);
  });
});

describe('무한의 계단 보스전', () => {
  const Bt = BALANCE.tower.battle;
  const still = (floor: number, ratio: number, seed = 5, boss = false) => {
    const g = new TowerBattle(seed, floor, ratio, boss);
    let guard = 0;
    while (g.status === 'running' && guard++ < 100000) g.step({ x: 0, y: 0 });
    return g;
  };
  /** 가까이 오는 탄이 없는 방향으로 움직이는 간단한 봇 */
  const dodge = (floor: number, ratio: number, seed = 5, boss = false) => {
    const g = new TowerBattle(seed, floor, ratio, boss);
    const dirs: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    const danger = (dx: number, dy: number) => {
      const nx = Math.max(-Bt.half, Math.min(Bt.half, g.px + dx * Bt.playerSpeed * 0.3));
      const ny = Math.max(-Bt.half, Math.min(Bt.half, g.py + dy * Bt.playerSpeed * 0.3));
      let d = 0;
      for (const s of g.enemyShots) {
        let best = 99;
        for (let t = 0.1; t <= 0.9; t += 0.1) {
          const f = Math.min(t, 0.3) / 0.3;
          best = Math.min(best, Math.hypot(s.x + s.vx * t - (g.px + (nx - g.px) * f), s.y + s.vy * t - (g.py + (ny - g.py) * f)));
        }
        if (best < 2.4) d += (2.4 - best) ** 2;
      }
      return d + 0.02 * Math.abs(nx) + 0.02 * Math.abs(ny - Bt.half * 0.5);
    };
    let guard = 0;
    while (g.status === 'running' && guard++ < 100000) {
      let best = Infinity;
      let pick = dirs[0];
      for (const d of dirs) {
        const v = danger(d[0], d[1]);
        if (v < best - 1e-9) {
          best = v;
          pick = d;
        }
      }
      g.step({ x: pick[0], y: pick[1] });
    }
    return g;
  };

  it('같은 씨앗·같은 입력이면 같은 판이다', () => {
    const a = still(30, 1.2, 77);
    const b = still(30, 1.2, 77);
    expect([a.status, a.timeMs, a.hp, a.bossHp, a.volleys]).toEqual([b.status, b.timeMs, b.hp, b.bossHp, b.volleys]);
    expect(still(30, 1.2, 78).bossHp).toBeDefined();
  });

  it('가만히 있으면 보스의 탄에 쓰러진다 (보스를 이기지 못한다)', () => {
    for (const floor of [1, 20, 60]) {
      const g = still(floor, 1.5);
      expect(g.status).toBe('lost');
      expect(g.hp).toBe(0);
      expect(g.bossHp).toBeGreaterThan(0);
    }
  });

  it('피하면서 전투력이 충분하면 이기고, 모자라면 시간 안에 못 쓰러뜨린다', () => {
    const win = dodge(10, 1.6);
    expect(win.status).toBe('won');
    expect(win.bossHp).toBe(0);
    expect(win.timeMs).toBeLessThan(Bt.timeLimitMs);
    const weak = dodge(10, 0.5);
    expect(weak.status).toBe('lost');
    expect(weak.timeMs).toBeGreaterThanOrEqual(Bt.timeLimitMs);
    expect(weak.hp).toBeGreaterThan(0); // 맞아서가 아니라 시간이 모자라 진 것
    expect(dodge(10, 2.6).timeMs).toBeLessThan(win.timeMs); // 전투력이 높을수록 빨리 끝난다
  });

  it('내 탄의 위력은 전투력 비율에 비례하고 범위로 잘린다', () => {
    expect(new TowerBattle(1, 1, 1, false).shotDmg).toBe(Bt.shotDmg);
    expect(new TowerBattle(1, 1, 2, false).shotDmg).toBe(Bt.shotDmg * 2);
    expect(new TowerBattle(1, 1, 1e9, false).shotDmg).toBe(Bt.shotDmg * Bt.ratioMax);
    expect(new TowerBattle(1, 1, -5, false).shotDmg).toBe(Bt.shotDmg * Bt.ratioMin);
    expect(new TowerBattle(1, 1, Number.NaN, false).shotDmg).toBe(Bt.shotDmg * Bt.ratioMin);
  });

  it('층이 오를수록 보스 탄이 빠르고 잦고 아프며 한 번에 더 많이 나온다', () => {
    const a = bossTuning(1);
    const b = bossTuning(60);
    expect(b.fireMs).toBeLessThan(a.fireMs);
    expect(b.dmg).toBeGreaterThan(a.dmg);
    expect(b.speed).toBeGreaterThan(a.speed);
    expect(bossTuning(100000)).toEqual({ fireMs: Bt.fireMin, dmg: Bt.dmgMax, speed: Bt.speedMax });
    const early = still(1, 3);
    const late = still(60, 3);
    expect(late.volleys / late.timeMs).toBeGreaterThan(early.volleys / early.timeMs);
  });

  it('이동 범위와 이상한 입력을 지킨다, advance는 고정 단계로 나눠 진행한다', () => {
    const g = new TowerBattle(1, 1, 1, false);
    for (let i = 0; i < 3000; i++) g.step({ x: 9, y: 0 });
    expect(g.px).toBeLessThanOrEqual(Bt.half);
    const n = new TowerBattle(1, 1, 1, false);
    n.step({ x: Number.NaN, y: 1 });
    expect(Number.isFinite(n.px)).toBe(true);
    const a = new TowerBattle(3, 5, 1, true);
    const c = new TowerBattle(3, 5, 1, true);
    for (let i = 0; i < 100; i++) a.advance(100, { x: 0.3, y: -0.2 });
    for (let i = 0; i < 1000; i++) c.advance(10, { x: 0.3, y: -0.2 });
    expect(Math.abs(a.timeMs - c.timeMs)).toBeLessThan(60);
    expect(a.status === 'running' || a.status === 'lost' || a.status === 'won').toBe(true);
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

  it('우편 보상은 다이아를 더하고, 비정상 값은 잘라내거나 0으로 본다', () => {
    const s = { ...base(), diamonds: 7 };
    expect(ok(applyMailClaim(s, 2)).state.diamonds).toBe(9);
    expect(ok(applyMailClaim(s, 2.9)).diamonds).toBe(2); // 정수만
    expect(ok(applyMailClaim(s, -5)).diamonds).toBe(0);
    expect(ok(applyMailClaim(s, Number.NaN)).diamonds).toBe(0);
    expect(ok(applyMailClaim(s, 1e12)).diamonds).toBe(100_000);
    expect(ok(applyMailClaim(s, 0)).state).toEqual(s);
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
    s = { ...s, feat: { ...s.feat, owned: { 'f-alfrado': 1, 'f-scails': 2 } } };
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

describe('음원 곡(정신병자러브) 채보', () => {
  const track = TRACKS[0];
  const R = BALANCE.rhythm;
  const step = slotMs(track);
  const levels = ['easy', 'normal', 'hard'] as const;

  it('어둠속성 「정신병자러브」 싱글만 음원 곡이다', () => {
    expect(track).toMatchObject({ id: 'dark-love', title: '정신병자러브', persona: 'dark', bpm: 140, playMs: 90_000 });
    expect(trackOfSingle({ title: '정신병자러브', persona: 'dark' })).toBe(track);
    expect(trackOfSingle({ title: '정신병자러브', persona: 'normal' })).toBeNull();
    expect(trackOfSingle({ title: '이상형이 정신병자면 어떡해요', persona: 'dark' })).toBeNull();
    expect(trackOfSingle(undefined)).toBeNull();
    // 어둠속성의 첫 싱글이 곧 음원 곡이라서 처음부터 리듬 모드를 열 수 있다
    expect(previewSingle(base(), 'dark').title).toBe(track.title);
    const list = [
      { id: 'single-1', title: '정신병자러브', persona: 'dark' as const },
      { id: 'single-2', title: '곡2', persona: 'normal' as const },
    ];
    expect(trackOfRun(list, { kind: 'rhythm', target: 'single-1' })).toBe(track);
    expect(trackOfRun(list, { kind: 'rhythm', target: 'single-2' })).toBeNull();
    expect(trackOfRun(list, { kind: 'survival', target: 'single-1' })).toBeNull();
    expect(trackOfRun(list, { kind: 'rhythm', target: null })).toBeNull();
    expect(trackOfRun(list, null)).toBeNull();
    expect(trackSingles(list).map((x) => x.id)).toEqual(['single-1']);
  });

  it('난이도마다 노트가 음원의 16분음표 격자 위에 있고 음원 시작·끝과 맞는다', () => {
    const counts: number[] = [];
    for (const level of levels) {
      const chart = buildChart(1, 'dark', level, track);
      expect(chart.audio).toEqual({ trackId: 'dark-love', startMs: R.leadInMs, playMs: 90_000, fadeMs: track.fadeMs });
      expect(chart.bpm).toBe(140);
      expect(chart.durationMs).toBe(R.leadInMs + 90_000 + R.trackTailMs);
      const lastAt = new Array<number>(R.lanes).fill(-1e9);
      let prev = -1;
      for (const n of chart.notes) {
        const k = (n.t - R.leadInMs - track.firstBeatMs) / step;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(0.006); // 반올림 오차 안에서 정확히 격자 위
        expect(k).toBeGreaterThanOrEqual(0);
        expect(n.lane >= 0 && n.lane < R.lanes).toBe(true);
        expect(n.t).toBeGreaterThanOrEqual(prev);
        expect(n.t - lastAt[n.lane]).toBeGreaterThanOrEqual(2 * step - 1); // 같은 레인은 8분음표보다 빠르게 연타하지 않는다
        prev = n.t;
        lastAt[n.lane] = n.t;
      }
      expect(prev - R.leadInMs).toBeLessThan(90_000 - 2000); // 마지막 노트는 서서히 줄기 전에 끝난다
      expect(chart.notes[0].t - R.leadInMs).toBe(Math.round(track.firstBeatMs)); // 첫 박에서 시작
      counts.push(chart.notes.length);
    }
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    const perSec = counts.map((c) => c / 87.5);
    expect(perSec[0]).toBeGreaterThan(1.2);
    expect(perSec[0]).toBeLessThan(2);
    expect(perSec[2]).toBeGreaterThan(3);
    expect(perSec[2]).toBeLessThan(4.6);
  });

  it('박자대로 치면 만점이고, 판정 폭 안의 오차는 Perfect·Good으로 읽힌다', () => {
    const chart = buildChart(1, 'dark', 'hard', track);
    const play = (offset: number) => {
      let st = createRhythm(chart);
      for (const n of chart.notes) st = pressLane(st, n.lane, n.t + offset).state;
      return rhythmScore(tickTo(st, chart.durationMs));
    };
    expect(play(0)).toBe(1000);
    expect(play(-40)).toBe(1000);
    expect(play(40)).toBe(1000);
    expect(play(90)).toBe(660); // 전부 Good: 정확도 0.6 × 0.85 + 콤보 0.15
    expect(rhythmScore(tickTo(createRhythm(chart), chart.durationMs + 1))).toBe(0);
  });

  it('음원 파일이 있고 LAME 정보 프레임의 길이가 기준 길이와 같다', () => {
    const mp3 = readFileSync(new URL('../../../public/assets/track-dark-love.mp3', import.meta.url));
    const at = mp3.indexOf('Info');
    expect(at).toBeGreaterThan(0);
    expect(mp3.indexOf('LAME', at)).toBeGreaterThan(at);
    const frames = mp3.readUInt32BE(at + 8);
    expect(frames * 1152 - 2210).toBe(expectedSamples('dark-love'));
    expect(frames * 1152 / 44100).toBeGreaterThan(track.playMs / 1000); // 음원이 90초보다 길다
  });

  it('디코더가 MP3 앞 지연을 안 잘랐을 때만 앞부분을 건너뛴다', () => {
    const ref = expectedSamples('dark-love')!;
    expect(leadingSamples('dark-love', ref, 44100)).toBe(0); // 앞뒤 모두 자름
    expect(leadingSamples('dark-love', ref + 1105, 44100)).toBe(0); // 앞만 자름
    expect(leadingSamples('dark-love', ref - 47 + 1105, 44100)).toBe(0); // mpg123 계열
    expect(leadingSamples('dark-love', ref + 2210, 44100)).toBe(1105); // 아무것도 안 자름
    expect(leadingSamples('dark-love', ref + 2210 + 1152, 44100)).toBe(2257); // 정보 프레임까지 소리로 읽음
    expect(leadingSamples('dark-love', Math.round((ref * 48000) / 44100), 48000)).toBe(0); // 48kHz로 다시 뽑아도 같은 판단
    expect(leadingSamples('dark-love', Math.round(((ref + 2210) * 48000) / 44100), 48000)).toBeGreaterThan(1000);
    expect(leadingSamples('nope', ref + 2210, 44100)).toBe(0);
  });

  it('음원 시계: 시작을 예약하고 출력 지연을 반영하며 거꾸로 가지 않고 일시정지에서 멈춘다', () => {
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const source = { buffer: null as unknown, connect: vi.fn(() => gain), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    const ctx = {
      currentTime: 10,
      state: 'running',
      baseLatency: 0.01,
      outputLatency: 0.05,
      destination: {},
      createBufferSource: () => source,
      createGain: () => gain,
      getOutputTimestamp: () => ({ contextTime: 10.2, performanceTime: 5000 }),
      suspend: vi.fn(async () => {
        ctx.state = 'suspended';
      }),
      resume: vi.fn(async () => {
        ctx.state = 'running';
      }),
    };
    const audio = buildChart(1, 'dark', 'normal', track).audio!;
    const clock = new TrackClock(ctx as unknown as AudioContext, { buffer: { duration: 143 } as AudioBuffer, leadSec: 0.025 }, audio);
    clock.start(0);
    const startCtx = 10 + 0.15;
    expect(source.start).toHaveBeenCalledWith(startCtx + R.leadInMs / 1000, 0.025, 90.05);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, startCtx + R.leadInMs / 1000 + 90);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(expect.any(Number), startCtx + R.leadInMs / 1000 + 90 - track.fadeMs / 1000);
    // 스피커에서 나오는 시각(출력 시각 10.2초 + 100ms 경과)에서 시작 시각을 뺀다
    expect(clock.read(5100)).toBeCloseTo((10.2 + 0.1 - startCtx) * 1000, 6);
    expect(clock.read(5000)).toBeGreaterThanOrEqual(150 - 1e-6); // 더 이른 시각을 물어도 거꾸로 가지 않는다
    clock.pause(5200);
    expect(clock.isPaused).toBe(true);
    expect(ctx.suspend).toHaveBeenCalled();
    expect(clock.read(9000)).toBeCloseTo((10.2 + 0.2 - startCtx) * 1000, 6); // 멈춘 동안 그대로
    clock.resume(9100);
    expect(ctx.resume).toHaveBeenCalled();
    clock.stop();
    expect(source.stop).toHaveBeenCalled();
    // getOutputTimestamp가 없으면 현재 시각에서 알려진 지연을 뺀다
    const bare = { ...ctx, state: 'running', getOutputTimestamp: undefined, currentTime: 12 };
    expect(audibleTime(bare as unknown as AudioContext, 0)).toBeCloseTo(12 - 0.01 - 0.05, 9);
  });
});
