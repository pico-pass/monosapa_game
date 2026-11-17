import { describe, expect, it } from 'vitest';
import * as server from '../../../../backend/src/awards/rules';
import { ownedTitles, setTitle, titlePerkText, titleText, trophyTitleText } from '../achievements';
import { AWARD_CATEGORIES, BALANCE, TROPHY_VIBE, parseTrophyId, titlePerkOf, trophyIdOf } from '../balance';
import { AWARD_TEXT, awardValueText } from '../content';
import { bonuses } from '../packdata';
import { createInitialState, validateState } from '../persistence';
import { applyAwardClaim } from '../serverRewards';
import { readSeen, writeSeen } from '../../platform/awards';
import type { GameState } from '../types';

const T0 = new Date(2026, 11, 20, 12, 0, 0).getTime();
const base = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), ...over });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};

describe('시상식: 서버와 같은 약속', () => {
  it('부문 ID와 순서가 서버 규칙 파일과 같다', () => {
    expect([...AWARD_CATEGORIES]).toEqual([...server.AWARD_CATEGORIES]);
  });

  it('트로피 ID 모양이 서버 `trophyId`와 같다', () => {
    for (const c of AWARD_CATEGORIES) expect(trophyIdOf(2026, c)).toBe(server.trophyId(2026, c));
  });

  it('부문마다 문구·갈래가 있고 트로피 칭호가 챗방 칭호 한도(16자) 안이다', () => {
    for (const c of AWARD_CATEGORIES) {
      expect(AWARD_TEXT[c].name.length, c).toBeGreaterThan(0);
      expect(TROPHY_VIBE[c], c).toBeDefined();
      const t = trophyTitleText(trophyIdOf(2026, c));
      expect(t, c).toMatch(/^2026 /);
      expect(t!.length, c).toBeLessThanOrEqual(16);
    }
  });
});

describe('시상식: 트로피 ID', () => {
  it('해와 부문으로 풀리고 모양이 틀리면 null이다', () => {
    expect(parseTrophyId('trophy-2026-song-normal')).toEqual({ year: 2026, category: 'song-normal' });
    expect(parseTrophyId('trophy-2027-fan-dark')).toEqual({ year: 2027, category: 'fan-dark' });
    for (const bad of ['trophy-2026-nope', 'trophy-26-rookie', 'trophy--rookie', 'x', '', null, undefined, 5, 'trophy-2026-rookie ']) expect(parseTrophyId(bad), String(bad)).toBeNull();
  });
});

describe('시상식: 트로피 칭호', () => {
  const owned = base({ trophies: [trophyIdOf(2026, 'rookie'), trophyIdOf(2026, 'song-dark')] });

  it('받은 트로피만 칭호로 달 수 있고 떼면 null이다', () => {
    const r = ok(setTitle(owned, trophyIdOf(2026, 'rookie')));
    expect(r.state.cosmetics.title).toBe('trophy-2026-rookie');
    expect(titleText(r.state)).toBe('2026 신인상');
    expect(ok(setTitle(r.state, null)).state.cosmetics.title).toBeNull();
    const fail = setTitle(owned, trophyIdOf(2026, 'longrun'));
    expect(fail.ok).toBe(false);
    expect(setTitle(base(), trophyIdOf(2026, 'rookie')).ok).toBe(false);
  });

  it('칭호 목록은 업적 칭호 뒤에 받은 트로피가 이어진다', () => {
    const withAch = { ...owned, achievements: { grind: T0 } };
    const list = ownedTitles(withAch);
    expect(list.map((t) => t.id)).toEqual(['grind', 'trophy-2026-rookie', 'trophy-2026-song-dark']);
    expect(list[1].title).toBe('2026 신인상');
    expect(ownedTitles({ achievements: {} })).toEqual([]); // 트로피 목록이 없는 값도 받는다
  });

  it('올해의 노래 트로피는 5%, 나머지는 4%의 갈래 보너스를 준다', () => {
    expect(titlePerkOf(trophyIdOf(2026, 'song-normal'))).toEqual({ vibe: 'fan', value: BALANCE.awards.trophyPerk.song });
    expect(titlePerkOf(trophyIdOf(2026, 'song-dark'))).toEqual({ vibe: 'power', value: 0.05 });
    expect(titlePerkOf(trophyIdOf(2026, 'rookie'))).toEqual({ vibe: 'rhyme', value: 0.04 });
    expect(titlePerkOf('trophy-2026-bogus')).toBeNull();
    expect(titlePerkText(trophyIdOf(2026, 'longrun'))).toBe('🪙 인세 +4%');
  });

  it('트로피 칭호를 달면 영구 보너스에 더해진다', () => {
    const plain = bonuses(base());
    const worn = bonuses({ ...base({ trophies: [trophyIdOf(2026, 'song-normal')] }), cosmetics: { ...base().cosmetics, title: trophyIdOf(2026, 'song-normal') } });
    expect(worn.fan - plain.fan).toBeCloseTo(0.05, 10);
  });
});

describe('시상식: 보상 반영', () => {
  it('다이아와 트로피를 더하고 새로 얻은 트로피만 돌려준다', () => {
    const s = base({ diamonds: 10, trophies: [trophyIdOf(2026, 'rookie')] });
    const r = ok(applyAwardClaim(s, 150, [trophyIdOf(2026, 'rookie'), trophyIdOf(2026, 'song-normal'), trophyIdOf(2026, 'song-normal'), 'trophy-2026-nope']));
    expect(r.diamonds).toBe(150);
    expect(r.state.diamonds).toBe(160);
    expect(r.trophies).toEqual(['trophy-2026-song-normal']);
    expect(r.state.trophies).toEqual(['trophy-2026-rookie', 'trophy-2026-song-normal']);
  });

  it('다이아는 한 번에 상한까지만, 음수·이상한 값은 0이다', () => {
    const cap = BALANCE.awards.maxDiamonds;
    expect(ok(applyAwardClaim(base(), 1e9, [])).diamonds).toBe(cap);
    expect(ok(applyAwardClaim(base(), -5, [])).diamonds).toBe(0);
    expect(ok(applyAwardClaim(base(), Number.NaN, [])).diamonds).toBe(0);
    expect(ok(applyAwardClaim(base(), 12.9, [])).diamonds).toBe(12);
  });

  it('같은 트로피를 다시 넣어도 그대로이고 다이아 0으로 부르면 빠진 트로피만 채운다(동기화)', () => {
    const once = ok(applyAwardClaim(base({ diamonds: 5 }), 0, [trophyIdOf(2026, 'revival')]));
    expect(once.state.diamonds).toBe(5);
    const twice = ok(applyAwardClaim(once.state, 0, [trophyIdOf(2026, 'revival')]));
    expect(twice.state.trophies).toEqual(once.state.trophies);
    expect(twice.trophies).toEqual([]);
  });

  it('트로피는 한도(200개)를 넘지 못한다', () => {
    const many = Array.from({ length: 400 }, (_, i) => `trophy-${1000 + i}-rookie`);
    const r = ok(applyAwardClaim(base(), 0, many));
    expect(r.state.trophies.length).toBe(BALANCE.awards.maxTrophies);
  });
});

describe('시상식: 저장', () => {
  it('트로피는 저장·불러오기에서 그대로 돌아온다', () => {
    const s = base({ trophies: [trophyIdOf(2026, 'song-normal'), trophyIdOf(2026, 'fan-dark')] });
    expect(ok(validateState(JSON.parse(JSON.stringify(s)))).state.trophies).toEqual(s.trophies);
  });

  it('없는 예전 저장은 빈 목록이고 알 수 없는 ID·중복은 버린다', () => {
    const raw = JSON.parse(JSON.stringify(base()));
    delete raw.trophies;
    expect(ok(validateState(raw)).state.trophies).toEqual([]);
    raw.trophies = ['trophy-2026-rookie', 'trophy-2026-rookie', 'trophy-2026-bogus', 5, 'x'];
    expect(ok(validateState(raw)).state.trophies).toEqual(['trophy-2026-rookie']);
  });

  it('목록이 아닌 값은 거절한다', () => {
    const raw = JSON.parse(JSON.stringify(base()));
    for (const t of ['x', 3, {}]) expect(validateState({ ...raw, trophies: t }).ok, JSON.stringify(t)).toBe(false);
  });
});

describe('시상식: 문구와 발표 기억', () => {
  it('값은 부문에 맞게 점수(24로 나눔)·시간·표로 보인다', () => {
    expect(awardValueText('song-normal', 720)).toBe('30점');
    expect(awardValueText('rookie', 36)).toBe('1.5점');
    expect(awardValueText('longrun', 1234)).toBe('1,234시간');
    expect(awardValueText('revival', 48)).toBe('48시간');
    expect(awardValueText('fan-dark', 12)).toBe('12표');
  });

  it('발표 기억은 저장·읽기가 되고 저장소가 없거나 깨진 값이면 빈 값이다', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readSeen(store, 'u1', '2026')).toEqual({});
    writeSeen(store, 'u1', '2026', { 'song-normal': 2, rookie: 1 });
    expect(readSeen(store, 'u1', '2026')).toEqual({ 'song-normal': 2, rookie: 1 });
    expect(readSeen(store, 'u2', '2026')).toEqual({}); // 계정마다 따로
    mem.set('monosapa.awards.seen:u1:2026', '{"a":-1,"b":"x","c":99,"d":3}');
    expect(readSeen(store, 'u1', '2026')).toEqual({ d: 3 });
    mem.set('monosapa.awards.seen:u1:2026', 'not json');
    expect(readSeen(store, 'u1', '2026')).toEqual({});
    expect(readSeen(null, 'u1', '2026')).toEqual({});
    expect(() => writeSeen(null, 'u1', '2026', {})).not.toThrow();
  });
});
