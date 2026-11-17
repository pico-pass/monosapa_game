import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { moreAlerts } from '../alerts';
import { createInitialState, validateState } from '../persistence';
import { songCardOf } from '../packdata';
import { autoRadio, autoSlots, claimRadio, clearRadio, emptyRadio, hourStart, radioAlerts, radioDay, radioPending, radioPeriod, radioUnlocked, setRadioSlot } from '../radio';
import { fanGainMult } from '../selectors';
import type { GameState, RadioSlot, Single } from '../types';

const R = BALANCE.radio;
const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime(); // 기기 시간대 12:00
const HOUR = 3600_000;
const OFF: RadioSlot = { k: 'off' };
/** 곡 10개: 홀수 번호(1·3·5·7·9)는 일반, 짝수 번호(2·4·6·8·10)는 어둠 */
const SINGLES: Single[] = Array.from({ length: 10 }, (_, i) => ({ id: `single-${i + 1}`, persona: i % 2 === 0 ? 'normal' : 'dark', title: `곡${i + 1}`, releasedAt: T0 }));
const base = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), fans: 100_000, lastSettledAt: T0, singles: SINGLES, ...over });
const sched = (patch: Record<number, RadioSlot> = {}): RadioSlot[] => Array.from({ length: 24 }, (_, h) => patch[h] ?? { ...OFF });
const withSlots = (s: GameState, patch: Record<number, RadioSlot>): GameState => ({ ...s, radio: { ...s.radio, slots: sched(patch) } });
const song = (n: number): RadioSlot => ({ k: 'song', id: `single-${n}` });
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const failReason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);
const quality = (s: GameState, n: number): number => {
  const card = songCardOf(s.cards, SINGLES[n - 1]);
  return R.quality[card.rarity] * (1 + R.remaster * card.remaster);
};
/** 그 시각(시)에 시작하는 정시의 시각(ms). T0 날짜 기준. */
const hourAtDay = (h: number): number => new Date(2026, 10, 4, h, 0, 0).getTime();

describe('라디오국: 열림과 처음 상태', () => {
  it('팬 1만 명부터 열리고 그전에는 모든 명령이 막힌다', () => {
    expect(radioUnlocked(R.unlockFans - 1)).toBe(false);
    expect(radioUnlocked(R.unlockFans)).toBe(true);
    const locked = base({ fans: R.unlockFans - 1 });
    expect(failReason(claimRadio(locked))).toBe('radio_locked');
    expect(failReason(setRadioSlot(locked, 0, song(1)))).toBe('radio_locked');
    expect(failReason(clearRadio(locked))).toBe('radio_locked');
    expect(failReason(autoRadio(locked))).toBe('radio_locked');
    expect(radioAlerts(locked)).toBe(0);
  });

  it('새 라디오는 24칸이 모두 비어 있고 지금 정시부터 센다', () => {
    const r = emptyRadio(T0 + 25 * 60_000, 77);
    expect(r.slots).toHaveLength(24);
    expect(r.slots.every((x) => x.k === 'off')).toBe(true);
    expect(r.claimedAt).toBe(T0);
    expect(r.seed).toBe(77);
    const s = base();
    expect(radioPending(s).hours).toBe(0);
    expect(radioDay(s).coinSecs).toBe(0);
    expect(createInitialState(T0).radio.claimedAt).toBe(hourStart(T0));
  });

  it('시간대 표: 24칸이고 낮·저녁·밤 구간이 맞다', () => {
    expect(R.curve).toHaveLength(24);
    expect(R.periods).toHaveLength(24);
    for (const h of [22, 23, 0, 1, 2, 3, 4, 5]) expect(radioPeriod(h)).toBe('night');
    for (let h = 7; h <= 18; h++) expect(radioPeriod(h)).toBe('day');
    for (const h of [6, 19, 20, 21]) expect(radioPeriod(h)).toBe('evening');
    expect(radioPeriod(24)).toBe('night'); // 24는 0시
    expect(radioPeriod(-1)).toBe('night'); // −1은 23시
    expect(R.taste.day.normal).toBeGreaterThan(R.taste.day.dark);
    expect(R.taste.night.dark).toBeGreaterThan(R.taste.night.normal);
  });
});

describe('라디오국: 한 칸의 계산', () => {
  it('곡 한 칸 = 곡선 × 취향 × 이어짐이고 코인·팬은 곡 등급을 곱한다(앞 칸이 비어 있으면 −20%)', () => {
    const s = withSlots(base(), { 12: song(1) });
    const h = radioDay(s).hours[12];
    const mult = R.curve[12] * R.taste.day.normal * R.off.next;
    expect(h.kind).toBe('song');
    expect(h.persona).toBe('normal');
    expect(h.mult).toBeCloseTo(mult, 10);
    expect(h.coinSecs).toBeCloseTo(R.song.coinSecs * quality(s, 1) * mult, 8);
    expect(h.fansPct).toBeCloseTo(R.song.fansPct * quality(s, 1) * mult, 12);
    expect(h.notes).toEqual(expect.arrayContaining(['afterOff', 'tasteGood']));
    expect(h.listeners).toBe(Math.round(Math.sqrt(s.fans) * R.listenerK * mult));
  });

  it('취향: 낮에는 일반이, 밤에는 어둠이 더 잘 들린다', () => {
    const s = withSlots(base(), { 12: song(1), 13: song(2), 2: song(1), 3: song(2) });
    const d = radioDay(s).hours;
    // 낮 12시 일반(곡1)은 낮 13시 어둠(곡2, 자아가 바뀌어 −15%)보다 취향 배율이 크다
    expect(d[12].notes).toContain('tasteGood');
    expect(d[13].notes).toContain('tasteBad');
    // 밤 2시 일반(곡1)은 맞지 않고 3시 어둠(곡2)은 맞는다
    expect(d[2].notes).toContain('tasteBad');
    expect(d[3].notes).toContain('tasteGood');
  });

  it('같은 곡이 직전 3칸 안에 또 나오면 반으로 줄고, 4칸 떨어지면 그대로다', () => {
    const near = radioDay(withSlots(base(), { 12: song(1), 14: song(1) })).hours[14];
    const far = radioDay(withSlots(base(), { 12: song(1), 16: song(1) })).hours[16];
    expect(near.notes).toContain('fatigue');
    expect(far.notes).not.toContain('fatigue');
    const noRepeat = radioDay(withSlots(base(), { 12: song(3), 14: song(1) })).hours[14];
    expect(near.mult).toBeCloseTo(noRepeat.mult * R.fatigue.mult, 10);
  });

  it('같은 자아의 곡이 이어지면 1.05씩 늘고 네 번째에서 멈춘다', () => {
    const s = withSlots(base(), { 8: song(1), 9: song(3), 10: song(5), 11: song(7), 12: song(9), 13: song(1) });
    const d = radioDay(s).hours;
    const expected = (h: number, len: number): number => R.curve[h] * R.taste.day.normal * (1 + R.streak.step * len);
    expect(d[8].notes).not.toContain('streak');
    expect(d[9].mult).toBeCloseTo(expected(9, 1), 10);
    expect(d[10].mult).toBeCloseTo(expected(10, 2), 10);
    expect(d[11].mult).toBeCloseTo(expected(11, 3), 10);
    expect(d[12].mult).toBeCloseTo(expected(12, 4), 10);
    // 다섯 번째부터는 4칸만 센다(곡 1은 5칸 앞이라 피로에는 안 걸린다)
    expect(d[13].mult).toBeCloseTo(expected(13, R.streak.max), 10);
  });

  it('자아가 바뀌는 곡은 사이에 멘트가 없으면 −15%, 멘트가 있으면 청취자가 늘어난다', () => {
    const noTalk = radioDay(withSlots(base(), { 12: song(1), 13: song(2) })).hours[13];
    expect(noTalk.notes).toContain('switch');
    expect(noTalk.mult).toBeCloseTo(R.curve[13] * R.taste.day.dark * R.switchMult, 10);
    const talk = radioDay(withSlots(base(), { 12: song(1), 13: { k: 'talk' }, 14: song(2) })).hours[14];
    expect(talk.notes).not.toContain('switch');
    expect(talk.notes).toContain('talk');
    expect(talk.mult).toBeCloseTo(R.curve[14] * R.taste.day.dark * R.talk.next, 10);
  });

  it('광고: 코인만 주고(인세 높은 쪽) 다음 시간 청취자가 줄어든다', () => {
    const s = withSlots(base(), { 12: { k: 'ad' }, 13: song(1) });
    const d = radioDay(s).hours;
    expect(d[12].kind).toBe('ad');
    expect(d[12].coinSecs).toBeCloseTo(R.ad.coinSecs * R.curve[12] * R.off.next, 8);
    expect(d[12].fansPct).toBe(0);
    expect(d[12].coins).toBeGreaterThan(0);
    expect(d[13].notes).toContain('afterAd');
    expect(d[13].mult).toBeCloseTo(R.curve[13] * R.taste.day.normal * R.ad.next, 10);
  });

  it('멘트: 코인은 없고 팬이 조금 늘며, 다음 세 칸 청취자를 붙잡는다. 연달아 둘이면 두 번째는 효과가 없다', () => {
    const s = withSlots(base(), { 12: { k: 'talk' }, 13: song(1) });
    const d = radioDay(s).hours;
    expect(d[12].coinSecs).toBe(0);
    expect(d[12].fansPct).toBeCloseTo(R.talk.fansPct * R.curve[12] * R.off.next, 12);
    for (const h of [13, 14, 15]) expect(radioDay(withSlots(base(), { 12: { k: 'talk' }, [h]: song(1) })).hours[h].notes).toContain('talk');
    expect(radioDay(withSlots(base(), { 12: { k: 'talk' }, 16: song(1) })).hours[16].notes).not.toContain('talk');
    // 12·13시가 연달아 멘트면 13시 멘트는 효과가 없어서, 16시(13시의 3칸 뒤)의 곡은 붙잡히지 않는다
    expect(radioDay(withSlots(base(), { 12: { k: 'talk' }, 13: { k: 'talk' }, 16: song(1) })).hours[16].notes).not.toContain('talk');
    expect(radioDay(withSlots(base(), { 12: { k: 'talk' }, 13: { k: 'talk' }, 15: song(1) })).hours[15].notes).toContain('talk');
  });

  it('게스트: 가진 래퍼만 쓰이고, 멘트처럼 붙잡고 이웃 곡을 등급만큼 올린다', () => {
    const s0 = base();
    const owned = { ...s0, feat: { ...s0.feat, owned: { 'f-alfrado': 1 } } };
    const guest: RadioSlot = { k: 'guest', id: 'f-alfrado' };
    const d = radioDay(withSlots(owned, { 11: song(1), 12: guest, 13: song(3), 14: song(5) })).hours;
    expect(d[12].kind).toBe('guest');
    expect(d[11].notes).toContain('guest');
    expect(d[13].notes).toContain('guest');
    expect(d[13].notes).toContain('talk');
    expect(d[14].notes).not.toContain('guest');
    expect(d[14].notes).toContain('talk'); // 게스트도 멘트처럼 다음 세 칸을 붙잡는다
    expect(d[12].fansPct).toBeGreaterThan(0);
    const plain = radioDay(withSlots(owned, { 11: song(1), 12: { k: 'off' }, 13: song(3) })).hours[13];
    expect(d[13].mult).toBeGreaterThan(plain.mult);
    // 가지지 않은 래퍼는 비운 칸으로 본다
    const none = radioDay(withSlots(base(), { 12: guest, 13: song(3) })).hours;
    expect(none[12].kind).toBe('off');
    expect(none[12].notes).toContain('missing');
    expect(none[13].notes).not.toContain('guest');
  });

  it('없는 곡은 비운 칸으로 계산한다', () => {
    const d = radioDay(withSlots(base(), { 12: { k: 'song', id: 'single-99' } })).hours[12];
    expect(d.kind).toBe('off');
    expect(d.coinSecs).toBe(0);
    expect(d.notes).toContain('missing');
  });

  it('칸은 하루가 되풀이된다: 23시 다음은 0시다', () => {
    const d = radioDay(withSlots(base(), { 23: { k: 'talk' }, 0: song(2) })).hours;
    expect(d[0].notes).toContain('talk');
    const e = radioDay(withSlots(base(), { 23: song(1), 0: song(3) })).hours;
    expect(e[0].notes).toContain('streak');
  });
});

describe('라디오국: 정산', () => {
  const allSongs = (): Record<number, RadioSlot> => Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, song((h % 10) + 1)]));

  it('완전히 지난 정시만 센다(12시에 시작해 17시 30분이면 12~16시 다섯 시간)', () => {
    const s = withSlots(base(), allSongs());
    expect(radioPending(at(s, T0 + 59 * 60_000)).hours).toBe(0);
    expect(radioPending(at(s, T0 + HOUR)).hours).toBe(1);
    expect(radioPending(at(s, T0 + 5 * HOUR + 30 * 60_000)).hours).toBe(5);
  });

  it('받으면 코인·팬이 오르고 정산 시각이 정시로 움직여서 같은 시간을 두 번 받지 못한다', () => {
    const s = at(withSlots(base(), allSongs()), T0 + 5 * HOUR + 30 * 60_000);
    const p = radioPending(s);
    expect(p.coins).toBeGreaterThan(0);
    expect(p.fans).toBeGreaterThan(0);
    const r = ok(claimRadio(s));
    expect(r.paid).toMatchObject({ hours: 5, coins: p.coins, fans: p.fans });
    expect(r.state.coins).toBe(s.coins + p.coins);
    expect(r.state.fans).toBe(s.fans + p.fans);
    expect(r.state.radio.claimedAt).toBe(T0 + 5 * HOUR);
    expect(radioPending(r.state).hours).toBe(0);
    expect(failReason(claimRadio(r.state))).toBe('not_ready');
    // 30분이 더 지나 한 시간이 차면 그 한 시간만 받는다
    expect(radioPending(at(r.state, T0 + 6 * HOUR)).hours).toBe(1);
  });

  it('쌓이는 시간은 최근 24시간까지이고 그보다 오래된 시간은 사라진다', () => {
    const s = at(withSlots(base(), allSongs()), T0 + 100 * HOUR);
    expect(radioPending(s).hours).toBe(R.capHours);
    const r = ok(claimRadio(s));
    expect(r.paid.hours).toBe(R.capHours);
    expect(r.state.radio.claimedAt).toBe(T0 + 100 * HOUR);
  });

  it('정산 대기 수입은 그 시간대 칸들의 예상(변수 제외)과 ±10% 안에서 맞는다', () => {
    const s = at(withSlots(base(), allSongs()), T0 + 6 * HOUR);
    const p = radioPending(s);
    const day = radioDay(s);
    let expected = 0;
    for (let i = 0; i < 6; i++) expected += day.hours[new Date(T0 + i * HOUR).getHours()].coinSecs;
    expect(p.coinSecs / expected).toBeGreaterThan(1 - R.noise);
    expect(p.coinSecs / expected).toBeLessThan(1 + R.noise);
  });

  it('같은 상태는 같은 결과이고, 씨앗이 다르면 변수가 달라진다', () => {
    const s = at(withSlots(base(), allSongs()), T0 + 6 * HOUR);
    expect(radioPending(s)).toEqual(radioPending(s));
    const other = { ...s, radio: { ...s.radio, seed: s.radio.seed + 12345 } };
    expect(radioPending(other).coinSecs).not.toBe(radioPending(s).coinSecs);
  });

  it('팬 증가는 팬 획득 배율을 곱하고, 플레이어 레벨이 오르면 다이아가 따라온다', () => {
    const s0 = at(withSlots(base({ fans: 199_999 }), allSongs()), T0 + 3 * HOUR);
    const p = radioPending(s0);
    expect(p.fans).toBe(Math.floor(s0.fans * p.fansPct * fanGainMult(s0)));
    const r = ok(claimRadio(s0));
    expect(r.paid.diamonds).toBe(BALANCE.diamond.levelUp * (Math.floor(Math.sqrt((199_999 + p.fans) / BALANCE.level.fansPerStep)) - Math.floor(Math.sqrt(199_999 / BALANCE.level.fansPerStep))));
    expect(r.state.diamonds).toBe(s0.diamonds + r.paid.diamonds);
    expect(r.paid.diamonds).toBeGreaterThan(0);
  });

  it('편성이 모두 비어 있으면 받을 코인이 없고 알림도 없다', () => {
    const s = at(base(), T0 + 10 * HOUR);
    expect(radioPending(s)).toMatchObject({ hours: 10, coins: 0, fans: 0 });
    expect(radioAlerts(s)).toBe(0);
  });

  it('알림 점: 정산 대기가 6시간 이상이고 받을 코인이 있을 때 켜진다', () => {
    const s = withSlots(base(), allSongs());
    expect(radioAlerts(at(s, T0 + 5 * HOUR))).toBe(0);
    expect(radioAlerts(at(s, T0 + 6 * HOUR))).toBe(1);
    expect(moreAlerts(at(s, T0 + 6 * HOUR)).radio).toBe(1);
    expect(moreAlerts(at(s, T0 + 6 * HOUR)).total).toBeGreaterThanOrEqual(1);
  });
});

describe('라디오국: 편성 바꾸기', () => {
  it('곡·멘트·광고·비움을 칸에 넣고 모양이 이상한 요청은 막는다', () => {
    const s = base();
    const a = ok(setRadioSlot(s, 12, song(3)));
    expect(a.state.radio.slots[12]).toEqual({ k: 'song', id: 'single-3' });
    expect(a.paid).toBeNull();
    expect(ok(setRadioSlot(a.state, 12, { k: 'talk', id: 'x' })).state.radio.slots[12]).toEqual({ k: 'talk' });
    expect(ok(setRadioSlot(a.state, 12, { k: 'ad' })).state.radio.slots[12]).toEqual({ k: 'ad' });
    expect(ok(setRadioSlot(a.state, 12, { k: 'off' })).state.radio.slots[12]).toEqual({ k: 'off' });
    for (const bad of [-1, 24, 1.5, Number.NaN]) expect(failReason(setRadioSlot(s, bad, song(1)))).toBe('not_found');
    expect(failReason(setRadioSlot(s, 0, { k: 'song' }))).toBe('not_found');
    expect(failReason(setRadioSlot(s, 0, { k: 'song', id: 'single-99' }))).toBe('not_found');
    expect(failReason(setRadioSlot(s, 0, { k: 'bogus' as RadioSlot['k'] }))).toBe('not_found');
  });

  it('게스트: 가진 래퍼만, 한 편성표에 한 번씩(같은 칸에 다시 넣는 건 된다)', () => {
    const s0 = base();
    const s = { ...s0, feat: { ...s0.feat, owned: { 'f-alfrado': 2, 'f-gangyusi': 1 } } };
    expect(failReason(setRadioSlot(s0, 3, { k: 'guest', id: 'f-alfrado' }))).toBe('not_owned');
    expect(failReason(setRadioSlot(s, 3, { k: 'guest', id: 'f-없는래퍼' }))).toBe('not_owned');
    expect(failReason(setRadioSlot(s, 3, { k: 'guest' }))).toBe('not_owned');
    const a = ok(setRadioSlot(s, 3, { k: 'guest', id: 'f-alfrado' }));
    expect(failReason(setRadioSlot(a.state, 8, { k: 'guest', id: 'f-alfrado' }))).toBe('already_done');
    expect(ok(setRadioSlot(a.state, 3, { k: 'guest', id: 'f-alfrado' })).state.radio.slots[3].id).toBe('f-alfrado');
    expect(ok(setRadioSlot(a.state, 8, { k: 'guest', id: 'f-gangyusi' })).state.radio.slots[8].id).toBe('f-gangyusi');
  });

  it('바꾸기 전에 쌓인 시간을 옛 편성표로 먼저 정산해서, 새 편성표로 지난 시간을 거슬러 받지 못한다', () => {
    const all = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, song((h % 10) + 1)]));
    const s = at(withSlots(base(), all), T0 + 4 * HOUR);
    const before = radioPending(s);
    const r = ok(setRadioSlot(s, 20, { k: 'ad' }));
    expect(r.paid).toMatchObject({ hours: 4, coins: before.coins, fans: before.fans });
    expect(r.state.coins).toBe(s.coins + before.coins);
    expect(r.state.radio.claimedAt).toBe(T0 + 4 * HOUR);
    expect(radioPending(r.state).hours).toBe(0);
    // 아무것도 편성하지 않은 채 오래 두었다가 처음 편성해도 그 시간은 0이다
    const idle = at(base(), T0 + 30 * HOUR);
    const first = ok(setRadioSlot(idle, 12, song(1)));
    expect(first.paid?.coins ?? 0).toBe(0);
    expect(first.state.coins).toBe(idle.coins);
    expect(radioPending(first.state).hours).toBe(0);
  });

  it('모두 비우기도 쌓인 시간을 먼저 정산한다', () => {
    const all = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, song((h % 10) + 1)]));
    const s = at(withSlots(base(), all), T0 + 3 * HOUR);
    const r = ok(clearRadio(s));
    expect(r.paid?.hours).toBe(3);
    expect(r.state.radio.slots.every((x) => x.k === 'off')).toBe(true);
    expect(r.state.coins).toBeGreaterThan(s.coins);
  });
});

describe('라디오국: 자동 편성', () => {
  it('곡이 없으면 못 하고, 곡이 있으면 24칸을 채운다', () => {
    expect(failReason(autoRadio(base({ singles: [] })))).toBe('need_single');
    expect(autoSlots(base({ singles: [] })).every((x) => x.k === 'off')).toBe(true);
    const r = ok(autoRadio(base()));
    expect(r.state.radio.slots).toHaveLength(24);
    expect(r.state.radio.slots.filter((x) => x.k === 'song').length).toBeGreaterThan(10);
  });

  it('결정적이고 모든 칸이 유효하다(있는 곡, 가진 게스트, 게스트는 한 번씩)', () => {
    const s0 = base();
    const s = { ...s0, feat: { ...s0.feat, owned: { 'f-alfrado': 1, 'f-gangyusi': 1, 'f-haname': 1 } } };
    const a = autoSlots(s);
    expect(autoSlots(s)).toEqual(a);
    const ids = new Set(SINGLES.map((x) => x.id));
    const guests: string[] = [];
    for (const x of a) {
      if (x.k === 'song') expect(ids.has(x.id!)).toBe(true);
      if (x.k === 'guest') guests.push(x.id!);
      expect(x.k).not.toBe('off');
    }
    expect(new Set(guests).size).toBe(guests.length);
    for (const g of guests) expect((s.feat.owned as Record<string, number>)[g]).toBeGreaterThan(0);
  });

  it('자동 편성은 곡 하나 되풀이나 곡 순환보다 훨씬 많이 번다', () => {
    const s = base();
    const score = (slots: RadioSlot[]): number => {
      const d = radioDay({ ...s, radio: { ...s.radio, slots } });
      return d.coinSecs + d.fansPct * 250_000;
    };
    const repeat = sched(Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, song(1)])));
    const rotate = sched(Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, song((h % 4) + 1)])));
    const auto = autoSlots(s);
    expect(score(auto)).toBeGreaterThan(score(repeat) * 1.5);
    expect(score(auto)).toBeGreaterThan(score(rotate) * 1.3);
  });

  it('낮에는 일반, 밤에는 어둠 곡을 틀도록 짠다', () => {
    const s = base();
    const a = autoSlots(s);
    const persona = (x: RadioSlot): string | null => (x.k === 'song' ? (SINGLES.find((y) => y.id === x.id)?.persona ?? null) : null);
    const day = a.slice(8, 18).map(persona).filter((p) => p !== null);
    const night = [...a.slice(0, 5), ...a.slice(22)].map(persona).filter((p) => p !== null);
    expect(day.filter((p) => p === 'normal').length).toBeGreaterThan(day.length * 0.8);
    expect(night.filter((p) => p === 'dark').length).toBeGreaterThan(night.length * 0.8);
  });

  it('자동 편성도 쌓인 시간을 먼저 정산한다', () => {
    const s = at(withSlots(base(), { 12: song(1), 13: song(3) }), T0 + 2 * HOUR);
    const before = radioPending(s);
    const r = ok(autoRadio(s));
    expect(r.paid?.hours).toBe(2);
    expect(r.paid?.coins).toBe(before.coins);
    expect(radioPending(r.state).hours).toBe(0);
  });
});

describe('라디오국: 저장', () => {
  it('저장·불러오기를 거쳐도 편성표와 정산 시각이 그대로다', () => {
    const s0 = base();
    const s = { ...withSlots(s0, { 3: song(2), 5: { k: 'talk' }, 7: { k: 'ad' }, 9: { k: 'guest', id: 'f-alfrado' } }), radio: { ...s0.radio, claimedAt: T0 - 3 * HOUR, slots: sched({ 3: song(2), 5: { k: 'talk' }, 7: { k: 'ad' }, 9: { k: 'guest', id: 'f-alfrado' } }) } };
    const v = ok(validateState(JSON.parse(JSON.stringify(s))));
    expect(v.state.radio).toEqual(s.radio);
  });

  it('예전 저장은 새 라디오로 읽는다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    delete raw.radio;
    const v = ok(validateState(raw));
    expect(v.state.radio.slots).toHaveLength(24);
    expect(v.state.radio.slots.every((x) => x.k === 'off')).toBe(true);
    expect(v.state.radio.claimedAt).toBe(hourStart(T0));
  });

  it('이상한 칸은 비우고, 칸이 너무 많거나 모양이 틀리면 거절하고, 정산 시각은 미래로 앞서지 못한다', () => {
    const raw = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    raw.radio = { slots: [{ k: 'song' }, { k: 'guest', id: '' }, { k: 'bogus' }, 'x', null, { k: 'talk', id: 'z' }, { k: 'song', id: 'a'.repeat(100) }], claimedAt: T0 + 50 * HOUR, seed: 5 };
    const v = ok(validateState(raw));
    const slots = v.state.radio.slots;
    expect(slots).toHaveLength(24);
    expect(slots.slice(0, 7)).toEqual([{ k: 'off' }, { k: 'off' }, { k: 'off' }, { k: 'off' }, { k: 'off' }, { k: 'talk' }, { k: 'off' }]);
    expect(v.state.radio.claimedAt).toBe(hourStart(T0));
    expect(v.state.radio.seed).toBe(5);
    expect(validateState({ ...raw, radio: { slots: Array.from({ length: 25 }, () => ({ k: 'off' })) } }).ok).toBe(false);
    expect(validateState({ ...raw, radio: 'x' }).ok).toBe(false);
    expect(validateState({ ...raw, radio: { slots: 'x' } }).ok).toBe(false);
    expect(validateState({ ...raw, radio: { claimedAt: -5 } }).ok).toBe(false);
  });
});

describe('라디오국: 정시 계산', () => {
  it('hourStart는 같은 정시 안의 시각을 정시로 맞춘다', () => {
    expect(hourStart(hourAtDay(15) + 59 * 60_000 + 59_999)).toBe(hourAtDay(15));
    expect(hourStart(hourAtDay(15))).toBe(hourAtDay(15));
  });
});
