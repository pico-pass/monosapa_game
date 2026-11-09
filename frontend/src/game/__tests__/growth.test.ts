import { describe, expect, it } from 'vitest';
import { BALANCE, ENDLESS, ENDLESS_MAX_TIER, STREAM_CERT_VIBE, STREAM_PLATFORMS, endlessGoal, titlePerkOf } from '../balance';
import { CERT_TIER_COUNT, certReached, certStatus, certsClaimable, claimCert } from '../certs';
import { buyEquipStar, releaseAlbum, remasterAlbum } from '../commands';
import { ACHIEVEMENT_TEXT, albumSeries } from '../content';
import { endlessReached, endlessStatuses, evaluateEndless } from '../endless';
import { bonuses } from '../packdata';
import { createInitialState, validateState } from '../persistence';
import {
  albumCost,
  albumRemasterCost,
  albumRoyaltyBonus,
  effectiveEquipLevel,
  equipStarCost,
  equipmentCost,
  offlineCapMs,
  playerLevel,
  previewEquipStar,
  previewRemaster,
  productionMultiplier,
  royaltyBreakdown,
} from '../selectors';
import { SKILL_LEVEL_LIMIT, buySkill, emptySkills, levelsToNextPoint, respecSkills, skillPointsEarned, skillPointsFree, skillPointsSpent } from '../skills';
import type { Album, GameState } from '../types';

const T0 = 1_700_000_000_000;
const base = (patch: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), ...patch });
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok but got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
};
const failReason = (r: { ok: boolean }): string => (r.ok ? 'ok' : (r as unknown as { reason: string }).reason);
const roundTrip = (s: GameState): GameState => {
  const v = validateState(JSON.parse(JSON.stringify(s)));
  if (!v.ok) throw new Error(v.error);
  return v.state;
};
const MAXED = { mic: 20, studio: 20, promotion: 20 };
/** 레벨 스킬 포인트가 충분히 쌓인 팬 수 (레벨 224 → 포인트 111개) */
const RICH_FANS = 1_000_000;

describe('레벨 스킬', () => {
  it('플레이어 레벨 2마다 포인트 1개: 레벨 1~2는 0개, 3은 1개, 5는 2개', () => {
    expect(skillPointsEarned(0)).toBe(0);
    expect(playerLevel(20)).toBe(2);
    expect(skillPointsEarned(20)).toBe(0);
    expect(playerLevel(80)).toBe(3);
    expect(skillPointsEarned(80)).toBe(1);
    expect(playerLevel(320)).toBe(5);
    expect(skillPointsEarned(320)).toBe(2);
  });

  it('다음 포인트까지 남은 레벨을 알려 준다', () => {
    expect(levelsToNextPoint(0)).toBe(2); // 레벨 1 → 3
    expect(levelsToNextPoint(20)).toBe(1); // 레벨 2 → 3
    expect(levelsToNextPoint(80)).toBe(2); // 레벨 3 → 5
  });

  it('포인트가 없으면 못 찍고, 있으면 한 갈래에 1단계 올린다', () => {
    expect(failReason(buySkill(base({ fans: 20 }), 'rhyme'))).toBe('no_points');
    const s = base({ fans: 80 });
    expect(skillPointsFree(s)).toBe(1);
    const r = ok(buySkill(s, 'fan'));
    expect(r.level).toBe(1);
    expect(r.state.skills.fan).toBe(1);
    expect(skillPointsFree(r.state)).toBe(0);
    expect(failReason(buySkill(r.state, 'coin'))).toBe('no_points');
  });

  it('갈래마다 최대 단계가 없어 포인트가 있는 만큼 한 갈래에 몰아 찍을 수 있다', () => {
    const earned = skillPointsEarned(RICH_FANS);
    expect(earned).toBeGreaterThan(100);
    let s = base({ fans: RICH_FANS });
    for (let i = 0; i < earned; i++) s = ok(buySkill(s, 'power')).state;
    expect(s.skills.power).toBe(earned);
    expect(skillPointsSpent(s.skills)).toBe(earned);
    expect(skillPointsFree(s)).toBe(0);
    expect(failReason(buySkill(s, 'power'))).toBe('no_points');
    expect(bonuses(s).power).toBeCloseTo(earned * BALANCE.skills.perLevel);
  });

  it('다시 찍기: 다이아를 내고 모두 돌려받는다', () => {
    const s = base({ fans: 320, diamonds: 100, skills: { ...emptySkills(), rhyme: 2 } });
    expect(skillPointsFree(s)).toBe(0);
    const r = ok(respecSkills(s));
    expect(r.state.skills).toEqual(emptySkills());
    expect(r.state.diamonds).toBe(100 - BALANCE.skills.respecCost);
    expect(r.points).toBe(2);
    expect(skillPointsFree(r.state)).toBe(2);
    expect(failReason(respecSkills(base({ fans: 320, diamonds: 100 })))).toBe('nothing_to_skip');
    expect(failReason(respecSkills({ ...s, diamonds: BALANCE.skills.respecCost - 1 }))).toBe('insufficient_diamonds');
  });

  it('영구 보너스: 갈래별로 합산되고, 오프라인은 시간 상한이 늘어난다', () => {
    const s = base({ skills: { rhyme: 10, coin: 4, fan: 2, power: 20, offline: 6 } });
    const b = bonuses(s);
    expect(b.rhyme.normal).toBeCloseTo(10 * BALANCE.skills.perLevel);
    expect(b.rhyme.dark).toBeCloseTo(10 * BALANCE.skills.perLevel);
    expect(b.coin).toBeCloseTo(4 * BALANCE.skills.perLevel);
    expect(b.fan).toBeCloseTo(2 * BALANCE.skills.perLevel);
    expect(b.power).toBeCloseTo(20 * BALANCE.skills.perLevel);
    expect(b.offlineMs).toBe(6 * BALANCE.skills.offlinePerLevelMs);
    expect(offlineCapMs(s)).toBe(BALANCE.offline.capMs + 6 * BALANCE.skills.offlinePerLevelMs);
  });

  it('범위를 벗어난 단계는 저장 검증에서 거부하고, 없던 저장은 0으로 읽는다', () => {
    expect(roundTrip(base({ skills: { ...emptySkills(), coin: 7 } })).skills.coin).toBe(7);
    const raw = JSON.parse(JSON.stringify(base()));
    raw.skills = { rhyme: SKILL_LEVEL_LIMIT + 1 };
    expect(validateState(raw).ok).toBe(false);
    raw.skills = { rhyme: -1 };
    expect(validateState(raw).ok).toBe(false);
    raw.skills = { rhyme: 250 }; // 예전의 최대 단계(20)를 넘어도 받아들인다
    const big = validateState(raw);
    expect(big.ok && big.state.skills.rhyme).toBe(250);
    delete raw.skills;
    const v = validateState(raw);
    expect(v.ok && v.state.skills).toEqual(emptySkills());
  });
});

describe('스트리밍 인증', () => {
  const totals = (p: (typeof STREAM_PLATFORMS)[number], n: number) => ({ ...createInitialState(T0).streaming.totals, [p]: n });

  it('단계 기준을 넘은 만큼 닿는다', () => {
    const need = BALANCE.certs.tiers.map((t) => t.need);
    expect(certReached(need[0] - 1)).toBe(0);
    expect(certReached(need[0])).toBe(1);
    expect(certReached(need[2] + 1)).toBe(3);
    expect(certReached(1e30)).toBe(CERT_TIER_COUNT);
  });

  it('인증을 받으면 닿은 단계의 다이아를 한꺼번에 받고, 같은 단계는 다시 못 받는다', () => {
    const [t1, t2, t3] = BALANCE.certs.tiers;
    const s0 = base();
    const s = { ...s0, streaming: { ...s0.streaming, totals: totals('spotify', t3.need) } };
    expect(certsClaimable(s)).toBe(1);
    const r = ok(claimCert(s, 'spotify'));
    expect(r.tiers).toBe(3);
    expect(r.diamonds).toBe(t1.diamonds + t2.diamonds + t3.diamonds);
    expect(r.state.diamonds).toBe(r.diamonds);
    expect(r.state.streaming.certs.spotify).toBe(3);
    expect(certsClaimable(r.state)).toBe(0);
    expect(failReason(claimCert(r.state, 'spotify'))).toBe('nothing_to_claim');
    expect(failReason(claimCert(s, 'melon'))).toBe('nothing_to_claim');
  });

  it('받은 단계마다 플랫폼의 갈래가 영구히 올라간다 (받지 않은 단계는 효과가 없다)', () => {
    const s0 = base();
    const reached = { ...s0, streaming: { ...s0.streaming, totals: totals('ytmusic', BALANCE.certs.tiers[1].need) } };
    expect(bonuses(reached).fan).toBe(0);
    const claimed = ok(claimCert(reached, 'ytmusic')).state;
    expect(bonuses(claimed).fan).toBeCloseTo(2 * BALANCE.certs.bonusPerTier);
    for (const p of STREAM_PLATFORMS) {
      const s = { ...s0, streaming: { ...s0.streaming, certs: { ...s0.streaming.certs, [p]: 3 } } };
      const b = bonuses(s);
      const v = STREAM_CERT_VIBE[p];
      const got = v === 'rhyme' ? b.rhyme.normal : b[v];
      expect(got).toBeCloseTo(3 * BALANCE.certs.bonusPerTier);
    }
  });

  it('다음 단계 기준과 끝까지 받은 상태를 알려 준다', () => {
    const s0 = base();
    expect(certStatus(s0, 'melon')).toMatchObject({ reached: 0, claimed: 0, diamonds: 0, next: BALANCE.certs.tiers[0].need });
    const done = { ...s0, streaming: { ...s0.streaming, totals: totals('melon', 1e13), certs: { ...s0.streaming.certs, melon: CERT_TIER_COUNT } } };
    expect(certStatus(done, 'melon')).toMatchObject({ reached: CERT_TIER_COUNT, claimed: CERT_TIER_COUNT, next: null });
  });

  it('저장 왕복과 보정: 없던 저장은 0, 단계 수를 넘는 값은 거부한다', () => {
    const s0 = base();
    const withCerts = { ...s0, streaming: { ...s0.streaming, certs: { ...s0.streaming.certs, applemusic: 4 } } };
    expect(roundTrip(withCerts).streaming.certs.applemusic).toBe(4);
    const raw = JSON.parse(JSON.stringify(s0));
    delete raw.streaming.certs;
    const v = validateState(raw);
    expect(v.ok && v.state.streaming.certs).toEqual({ spotify: 0, ytmusic: 0, melon: 0, applemusic: 0 });
    raw.streaming.certs = { spotify: CERT_TIER_COUNT + 1 };
    expect(validateState(raw).ok).toBe(false);
  });
});

describe('장비 한계 돌파 (★)', () => {
  it('최대 레벨이 아니면 올릴 수 없고, 최대 레벨이면 코인으로 한 단계씩 올린다', () => {
    const notMax = base({ coins: 1e15, equipment: { mic: 19, studio: 20, promotion: 20 } });
    expect(failReason(buyEquipStar(notMax, 'mic'))).toBe('need_max_level');
    expect(previewEquipStar(notMax, 'mic').open).toBe(false);
    const s = base({ coins: 1e15, equipment: MAXED });
    const cost = equipmentCost('mic', 20, 'normal') * BALANCE.equipStars.costMult.normal[0];
    expect(equipStarCost('mic', 'normal', 0)).toBe(Math.ceil(cost));
    const r = ok(buyEquipStar(s, 'mic'));
    expect(r.stars).toBe(1);
    expect(r.state.equipStars.normal.mic).toBe(1);
    expect(r.state.coins).toBe(s.coins - Math.ceil(cost));
    expect(r.state.counters.buys).toBe(1);
  });

  it('코인이 모자라면 실패하고, ★가 가득이면 더 못 올린다', () => {
    expect(failReason(buyEquipStar(base({ coins: 1, equipment: MAXED }), 'studio'))).toBe('insufficient_coins');
    const full = base({ coins: 1e15, equipment: MAXED, equipStars: { normal: { mic: BALANCE.equipStars.max, studio: 0, promotion: 0 }, dark: { mic: 0, studio: 0, promotion: 0 } } });
    expect(failReason(buyEquipStar(full, 'mic'))).toBe('max_level');
    expect(previewEquipStar(full, 'mic').maxed).toBe(true);
  });

  it('★는 레벨을 더 올린 것처럼 생산배율과 인세를 키운다 (그 자아 장비에만)', () => {
    const E = BALANCE.equipStars.extraLevels;
    const s = base({ equipment: MAXED, equipStars: { normal: { mic: 2, studio: 0, promotion: 3 }, dark: { mic: 0, studio: 0, promotion: 0 } } });
    expect(effectiveEquipLevel(s, 'normal', 'mic')).toBe(20 + E[1]);
    expect(effectiveEquipLevel(s, 'normal', 'studio')).toBe(20);
    expect(productionMultiplier(s, 'normal')).toBeCloseTo(1 + BALANCE.production.micPerLevel * (20 + E[1]) + BALANCE.production.studioPerLevel * 20);
    expect(royaltyBreakdown(s, 'normal').promotionMult).toBeCloseTo(1 + BALANCE.royalty.promotionPerLevel * (20 + E[2]));
    // 어둠 장비는 레벨이 최대가 아니라 ★가 있어도 효과가 없고, 일반 ★와도 섞이지 않는다
    const dark = base({ darkEquipment: { mic: 5, studio: 0, promotion: 0 }, equipStars: { normal: { mic: 0, studio: 0, promotion: 0 }, dark: { mic: 3, studio: 0, promotion: 0 } } });
    expect(effectiveEquipLevel(dark, 'dark', 'mic')).toBe(5);
    expect(productionMultiplier(s, 'dark')).toBe(1);
  });

  it('★ 비용은 단계마다 커지고 어둠은 배수가 작다', () => {
    const costs = Array.from({ length: BALANCE.equipStars.max }, (_, i) => equipStarCost('promotion', 'normal', i));
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    expect(BALANCE.equipStars.costMult.dark[0]).toBeLessThan(BALANCE.equipStars.costMult.normal[0]);
    expect(BALANCE.equipStars.extraLevels).toHaveLength(BALANCE.equipStars.max);
  });

  it('저장 왕복, 없던 저장은 0단계, 범위를 벗어난 값은 거부', () => {
    const s = base({ equipStars: { normal: { mic: 1, studio: 2, promotion: 3 }, dark: { mic: 4, studio: 5, promotion: 0 } } });
    expect(roundTrip(s).equipStars).toEqual(s.equipStars);
    const raw = JSON.parse(JSON.stringify(base()));
    delete raw.equipStars;
    const v = validateState(raw);
    expect(v.ok && v.state.equipStars.dark.studio).toBe(0);
    raw.equipStars = { normal: { mic: BALANCE.equipStars.max + 1 } };
    expect(validateState(raw).ok).toBe(false);
  });
});

describe('앨범 리마스터', () => {
  const first = albumSeries('normal')[0];
  const owned = (remaster = 0): Album => ({ id: first.id, title: first.title, type: 'normal', releasedAt: T0, remaster });

  it('새로 낸 앨범은 리마스터 0단계다', () => {
    const r = ok(releaseAlbum(base({ coins: 1e9 }), 'normal'));
    expect(r.album.remaster).toBe(0);
    expect(r.state.albums[0].remaster).toBe(0);
  });

  it('낸 앨범만 리마스터할 수 있고, 비용은 발매 비용 × 배수라 단계마다 커진다', () => {
    expect(failReason(remasterAlbum(base({ coins: 1e12 }), first.id))).toBe('not_owned');
    let s = base({ coins: 1e12, albums: [owned()] });
    const paid: number[] = [];
    for (let i = 0; i < BALANCE.remaster.max; i++) {
      const r = ok(remasterAlbum(s, first.id));
      paid.push(r.cost);
      expect(r.remaster).toBe(i + 1);
      s = r.state;
    }
    expect(paid).toEqual(BALANCE.remaster.costMult.map((m) => Math.ceil(albumCost('normal', 0) * m)));
    expect(albumRemasterCost('normal', 0, 1)).toBe(paid[1]);
    expect(s.albums[0].remaster).toBe(BALANCE.remaster.max);
    expect(failReason(remasterAlbum(s, first.id))).toBe('max_level');
    expect(previewRemaster(s, first.id)?.maxed).toBe(true);
  });

  it('코인이 모자라면 실패한다', () => {
    expect(failReason(remasterAlbum(base({ coins: 1, albums: [owned()] }), first.id))).toBe('insufficient_coins');
  });

  it('리마스터 단계만큼 그 앨범이 주는 인세 배율이 커진다', () => {
    const perAlbum = BALANCE.royalty.perAlbum.normal[0];
    expect(albumRoyaltyBonus([owned(0)])).toBeCloseTo(perAlbum);
    expect(albumRoyaltyBonus([owned(1)])).toBeCloseTo(perAlbum * (1 + BALANCE.remaster.boost[0]));
    expect(albumRoyaltyBonus([owned(BALANCE.remaster.max)])).toBeCloseTo(perAlbum * (1 + BALANCE.remaster.boost[BALANCE.remaster.max - 1]));
    // 두 번째 앨범은 두 번째 값을 쓴다 (순번은 속성마다 센다)
    const second = albumSeries('normal')[1];
    const two: Album[] = [owned(0), { id: second.id, title: second.title, type: 'normal', releasedAt: T0, remaster: 3 }];
    expect(albumRoyaltyBonus(two)).toBeCloseTo(perAlbum + BALANCE.royalty.perAlbum.normal[1] * (1 + BALANCE.remaster.boost[2]));
    const s = base({ fans: 1000, albums: [owned(3)] });
    expect(royaltyBreakdown(s, 'normal').albumMult).toBeCloseTo(1 + perAlbum * 2);
  });

  it('저장 왕복, 없던 저장은 0단계, 범위를 벗어난 값은 거부', () => {
    expect(roundTrip(base({ albums: [owned(2)] })).albums[0].remaster).toBe(2);
    const raw = JSON.parse(JSON.stringify(base({ albums: [owned(1)] })));
    delete raw.albums[0].remaster;
    const v = validateState(raw);
    expect(v.ok && v.state.albums[0].remaster).toBe(0);
    raw.albums[0].remaster = BALANCE.remaster.max + 1;
    expect(validateState(raw).ok).toBe(false);
  });
});

describe('칭호 효과', () => {
  const titled = Object.keys(ACHIEVEMENT_TEXT).filter((id) => ACHIEVEMENT_TEXT[id].title);

  it('칭호가 있는 업적은 모두 효과가 있고 값은 표의 네 단계 중 하나다', () => {
    const T = BALANCE.titlePerk;
    expect(titled.length).toBeGreaterThan(30);
    for (const id of titled) {
      const perk = titlePerkOf(id);
      expect(perk, id).not.toBeNull();
      expect([T.low, T.mid, T.high, T.top], id).toContain(perk!.value);
    }
  });

  it('칭호가 없거나 모르는 ID면 효과가 없다', () => {
    expect(titlePerkOf(null)).toBeNull();
    expect(titlePerkOf('없는-업적')).toBeNull();
  });

  it('달고 있는 칭호 하나만 보너스에 더해진다', () => {
    const none = bonuses(base());
    const worn = base({ cosmetics: { ...createInitialState(T0).cosmetics, title: 'grind' } });
    const perk = titlePerkOf('grind')!;
    expect(perk.vibe).toBe('rhyme');
    expect(bonuses(worn).rhyme.normal).toBeCloseTo(none.rhyme.normal + perk.value);
    expect(bonuses(worn).rhyme.dark).toBeCloseTo(none.rhyme.dark + perk.value);
    expect(bonuses(worn).coin).toBe(none.coin);
  });
});

describe('끝없는 업적', () => {
  const works = ENDLESS.find((d) => d.id === 'e-works')!;

  it('n단계 목표는 base × growth^(n−1)이고 단계는 오를수록 커진다', () => {
    for (const def of ENDLESS) {
      expect(endlessGoal(def, 1)).toBe(Math.ceil(def.base));
      expect(endlessGoal(def, 5)).toBeGreaterThan(endlessGoal(def, 4));
    }
    expect(endlessGoal(works, 2)).toBe(Math.ceil(works.base * works.growth));
  });

  it('값으로 닿은 단계를 센다', () => {
    expect(endlessReached(works, endlessGoal(works, 1) - 1)).toBe(0);
    expect(endlessReached(works, endlessGoal(works, 1))).toBe(1);
    expect(endlessReached(works, endlessGoal(works, 3))).toBe(3);
    expect(endlessReached(works, 1e300)).toBe(ENDLESS_MAX_TIER);
  });

  it('닿은 단계를 한꺼번에 받고 다이아를 주며, 같은 단계는 다시 주지 않는다', () => {
    const s = base({ counters: { ...createInitialState(T0).counters, works: endlessGoal(works, 3) } });
    const r = evaluateEndless(s);
    expect(r.state.endless['e-works']).toBe(3);
    expect(r.state.diamonds).toBe(3 * works.diamonds);
    expect(r.gains).toEqual([{ def: works, tiers: 3, diamonds: 3 * works.diamonds }]);
    const again = evaluateEndless(r.state);
    expect(again.state).toBe(r.state);
    expect(again.gains).toEqual([]);
    // 지표가 더 자라면 새 단계만 준다
    const more = evaluateEndless({ ...r.state, counters: { ...r.state.counters, works: endlessGoal(works, 4) } });
    expect(more.state.endless['e-works']).toBe(4);
    expect(more.state.diamonds).toBe(r.state.diamonds + works.diamonds);
  });

  it('여러 지표가 동시에 닿아도 각각 계산하고, 아무것도 없으면 상태를 그대로 돌려준다', () => {
    const s0 = base();
    expect(evaluateEndless(s0).state).toBe(s0);
    const fans = ENDLESS.find((d) => d.id === 'e-fans')!;
    const s = base({ fans: endlessGoal(fans, 2), counters: { ...s0.counters, works: endlessGoal(works, 1) } });
    const r = evaluateEndless(s);
    expect(r.state.endless).toMatchObject({ 'e-fans': 2, 'e-works': 1 });
    // 팬이 늘면 레벨 지표('e-level')도 같이 닿으니 받은 다이아는 gains의 합과 같다
    expect(r.gains.map((g) => g.def.id)).toEqual(expect.arrayContaining(['e-fans', 'e-works', 'e-level']));
    expect(r.state.diamonds).toBe(r.gains.reduce((a, g) => a + g.diamonds, 0));
    expect(r.gains.find((g) => g.def.id === 'e-fans')).toMatchObject({ tiers: 2, diamonds: 2 * fans.diamonds });
  });

  it('화면용 상태: 받은 단계와 다음 목표', () => {
    const s = evaluateEndless(base({ counters: { ...createInitialState(T0).counters, works: endlessGoal(works, 2) } })).state;
    const st = endlessStatuses(s).find((e) => e.def.id === 'e-works')!;
    expect(st).toMatchObject({ tier: 2, goal: endlessGoal(works, 3) });
  });

  it('저장 왕복, 없던 저장은 비어 있고, 범위를 벗어난 값은 거부, 사라진 지표는 버린다', () => {
    expect(roundTrip(base({ endless: { 'e-works': 4 } })).endless).toEqual({ 'e-works': 4 });
    const raw = JSON.parse(JSON.stringify(base()));
    delete raw.endless;
    const v = validateState(raw);
    expect(v.ok && v.state.endless).toEqual({});
    raw.endless = { 'e-works': 2, 'e-없는지표': 9 };
    const trimmed = validateState(raw);
    expect(trimmed.ok && trimmed.state.endless).toEqual({ 'e-works': 2 });
    raw.endless = { 'e-works': ENDLESS_MAX_TIER + 1 };
    expect(validateState(raw).ok).toBe(false);
  });
});

describe('성장 요소 확장: 예전 저장 호환', () => {
  it('새 필드가 하나도 없는 예전 저장도 그대로 읽힌다', () => {
    const raw = JSON.parse(JSON.stringify(base({ albums: [{ id: albumSeries('normal')[0].id, title: 'x', type: 'normal', releasedAt: T0, remaster: 0 }] })));
    delete raw.equipStars;
    delete raw.skills;
    delete raw.endless;
    delete raw.streaming.certs;
    delete raw.albums[0].remaster;
    const v = validateState(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.state.skills).toEqual(emptySkills());
    expect(v.state.endless).toEqual({});
    expect(v.state.equipStars.normal).toEqual({ mic: 0, studio: 0, promotion: 0 });
    expect(v.state.streaming.certs.spotify).toBe(0);
    expect(v.state.albums[0].remaster).toBe(0);
    expect(bonuses(v.state).rhyme.normal).toBe(0);
  });
});
