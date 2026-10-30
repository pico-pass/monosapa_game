import { describe, expect, it } from 'vitest';
import { evaluateAchievements, setTitle, titleText } from '../achievements';
import { moreAlerts } from '../alerts';
import { ACHIEVEMENTS, BALANCE, MISSIONS, STAGES, manualGameOf } from '../balance';
import {
  beginManualConcert,
  buyDiamondUpgrade,
  releaseSingle,
  runAutoConcert,
  work,
} from '../commands';
import { MAIL_TEMPLATES, mailTemplateById } from '../content';
import { mailIntervalMs, replyEffect, replyMail, rollMail } from '../fanmail';
import {
  allBonusStatus,
  attendanceReward,
  attendanceStatus,
  claimAttendance,
  claimMission,
  dayKey,
  missionStatuses,
  rollMissions,
  weekKey,
} from '../missions';
import { buySlot, collectPost, nextSlotCost, postBaseFans, postOutcome, postStatuses, startPost } from '../monogram';
import { createInitialState, validateState } from '../persistence';
import {
  achievementValue,
  campaignMult,
  clickGain,
  hiddenSecretStage,
  offlineCapMs,
  previewDiamondUpgrade,
  snackMult,
  stageStatus,
} from '../selectors';
import { advance, settleOffline } from '../simulation';
import { buyCampaign, buySnack, buyTheme, campaignPrice, setTheme, snackPrice } from '../shop';
import { zeroCounters } from '../tracking';
import type { GameState, Mail, Single } from '../types';

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const base = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), ...over });
const at = (s: GameState, ms: number): GameState => ({ ...s, lastSettledAt: ms });
const single = (n = 1): Single[] => Array.from({ length: n }, (_, i) => ({ id: `single-${i + 1}`, persona: 'normal', title: `곡${i + 1}`, releasedAt: T0 }));
const withCounters = (s: GameState, over: Partial<GameState['counters']>): GameState => ({ ...s, counters: { ...s.counters, ...over } });

function clearedNormalStages(over: Partial<GameState> = {}): GameState {
  const s = base({ fans: 1e7, ...over });
  const concerts = { ...s.concerts };
  for (const d of STAGES) if (!d.darkOnly) concerts[d.id] = { ...concerts[d.id], cleared: true };
  return { ...s, concerts };
}

describe('상점: 간식·홍보 캠페인', () => {
  it('가격은 플레이어 레벨이 오를수록 오른다', () => {
    expect(snackPrice({ fans: 0 }, 'kimbap')).toBe(1500); // 기본가 60 × 25
    expect(snackPrice({ fans: 20 }, 'kimbap')).toBe(1875); // Lv.2 → ×1.25
    expect(campaignPrice({ fans: 0 }, 'flyer')).toBe(12500); // 기본가 500 × 25
    expect(campaignPrice({ fans: 0 }, 'billboard')).toBe(750000);
    // 다이아로 사는 테마는 25배가 적용되지 않는다
    expect(BALANCE.shop.themes).toEqual({ default: 0, pastel: 30, mono: 30, neon: 50 });
  });

  it('간식을 사면 코인을 쓰고 작업하기 라임이 늘고, 끝나면 돌아온다', () => {
    const s0 = base({ coins: 100_000 });
    const r = buySnack(s0, 'coffee');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.coins).toBe(100_000 - 3750);
    expect(r.state.counters.snacks).toBe(1);
    expect(snackMult(r.state)).toBeCloseTo(1.6);
    expect(clickGain(r.state)).toBeCloseTo(clickGain(s0) * 1.6);
    // 끝나는 시각 정각부터는 효과가 없다
    expect(snackMult(at(r.state, T0 + 10 * MIN))).toBe(1);
    expect(clickGain(at(r.state, T0 + 10 * MIN))).toBeCloseTo(clickGain(s0));
  });

  it('작업하기에도 간식이 적용된다', () => {
    const s0 = base({ coins: 100_000 });
    const r = buySnack(s0, 'energy');
    if (!r.ok) throw new Error('buy failed');
    const w = work(r.state);
    expect(w.ok && w.gained).toBeCloseTo(clickGain(s0) * 2.2);
  });

  it('같은 간식은 시간이 더해지고 3배까지만 쌓인다. 다른 간식은 바뀐다', () => {
    let s = base({ coins: 1e6 });
    for (let i = 0; i < 3; i++) {
      const r = buySnack(s, 'kimbap');
      expect(r.ok && r.extended).toBe(i > 0);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.buffs.snack?.until).toBe(T0 + 15 * MIN);
    const full = buySnack(s, 'kimbap');
    expect(!full.ok && full.reason).toBe('already_done');
    const swapped = buySnack(s, 'coffee');
    expect(swapped.ok && swapped.state.buffs.snack).toEqual({ id: 'coffee', until: T0 + 10 * MIN });
  });

  it('코인이 모자라면 못 산다', () => {
    const r = buySnack(base({ coins: 10 }), 'kimbap');
    expect(!r.ok && r.reason).toBe('insufficient_coins');
    const c = buyCampaign(base({ coins: 10 }), 'flyer');
    expect(!c.ok && c.reason).toBe('insufficient_coins');
  });

  it('홍보 캠페인 중에는 싱글로 얻는 팬이 배가 된다', () => {
    const s0 = base({ coins: 1e6, normalRhymes: 1e6 });
    const plain = releaseSingle(s0);
    const camp = buyCampaign(s0, 'insta');
    if (!plain.ok || !camp.ok) throw new Error('setup failed');
    expect(campaignMult(camp.state)).toBe(2);
    const boosted = releaseSingle(camp.state);
    expect(boosted.ok && boosted.fans).toBe(plain.fans * 2);
    expect(boosted.ok && boosted.state.fans).toBe(plain.fans * 2);
    expect(camp.state.counters.campaigns).toBe(1);
    // 끝난 뒤에는 원래대로
    const later = releaseSingle(at(camp.state, T0 + 2 * 3600_000));
    expect(later.ok && later.fans).toBe(plain.fans);
  });
});

describe('상점: 테마', () => {
  it('다이아로 사면 바로 적용되고, 가진 테마만 바꿀 수 있다', () => {
    const poor = buyTheme(base({ diamonds: 29 }), 'pastel');
    expect(!poor.ok && poor.reason).toBe('insufficient_diamonds');
    const r = buyTheme(base({ diamonds: 30 }), 'pastel');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.diamonds).toBe(0);
    expect(r.state.cosmetics).toMatchObject({ theme: 'pastel', themes: ['default', 'pastel'] });
    const again = buyTheme({ ...r.state, diamonds: 100 }, 'pastel');
    expect(!again.ok && again.reason).toBe('owned');
    const not = setTheme(r.state, 'neon');
    expect(!not.ok && not.reason).toBe('not_owned');
    const back = setTheme(r.state, 'default');
    expect(back.ok && back.state.cosmetics.theme).toBe('default');
  });
});

describe('다이아: 오프라인 정산 확장', () => {
  it('레벨당 30분씩 상한이 늘어난다 (기본 2시간)', () => {
    expect(offlineCapMs(base())).toBe(2 * 3600_000);
    const s = base({ diamondUpgrades: { production: 0, royalty: 0, offline: 2 } });
    expect(offlineCapMs(s)).toBe(3 * 3600_000);
    const r = settleOffline(s, T0 + 5 * 3600_000);
    expect(r.paidMs).toBe(3 * 3600_000);
    expect(r.capped).toBe(true);
    expect(settleOffline(base(), T0 + 5 * 3600_000).paidMs).toBe(2 * 3600_000);
  });

  it('비용은 8, 11, 14… 최대 8레벨', () => {
    const s0 = base({ diamonds: 1e6 });
    const pv = previewDiamondUpgrade(s0, 'offline');
    expect(pv.cost).toBe(8);
    expect(pv.maxLevel).toBe(8);
    expect(pv.before).toBe(2 * 3600_000);
    expect(pv.after).toBe(2.5 * 3600_000);
    let s = s0;
    for (let i = 0; i < 8; i++) {
      const r = buyDiamondUpgrade(s, 'offline');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.diamondUpgrades.offline).toBe(8);
    expect(offlineCapMs(s)).toBe(6 * 3600_000);
    const over = buyDiamondUpgrade(s, 'offline');
    expect(!over.ok && over.reason).toBe('max_level');
    // 생산·인세 증폭은 여전히 20레벨까지
    expect(buyDiamondUpgrade({ ...s, diamondUpgrades: { ...s.diamondUpgrades, production: 19 } }, 'production').ok).toBe(true);
  });
});

describe('비밀 공연장', () => {
  it('월클을 클리어하기 전에는 목록에 보이지 않는다', () => {
    const s = base({ fans: 1e7 });
    expect(stageStatus(s, 'rooftop').visible).toBe(false);
    expect(hiddenSecretStage(s)).toBe('rooftop');
    const cleared = clearedNormalStages();
    expect(stageStatus(cleared, 'rooftop').visible).toBe(true);
    expect(stageStatus(cleared, 'ruins').visible).toBe(false); // 앞 공연장을 클리어해야 다음이 보인다
    expect(hiddenSecretStage(cleared)).toBeNull();
  });

  it('어둠속성으로만 입장한다', () => {
    const normal = clearedNormalStages();
    expect(stageStatus(normal, 'rooftop')).toMatchObject({ unlocked: true, personaOk: false, canRun: false, darkOnly: true });
    const a = runAutoConcert(normal, 'rooftop');
    expect(!a.ok && a.reason).toBe('dark_only');
    const m = beginManualConcert(normal, 'rooftop', 'run-1');
    expect(!m.ok && m.reason).toBe('dark_only');

    const dark = clearedNormalStages({ activePersona: 'dark' });
    expect(stageStatus(dark, 'rooftop').canRun).toBe(true);
    const r = runAutoConcert(dark, 'rooftop');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toMatchObject({ firstClear: true, diamonds: 100, firstClearCoins: 300000 });
    expect(r.state.counters.concerts).toBe(1);
    expect(stageStatus(r.state, 'ruins').visible).toBe(true);
  });

  it('수치와 직접 공연 종류', () => {
    const secret = STAGES.filter((d) => d.darkOnly);
    expect(secret.map((d) => d.id)).toEqual(['rooftop', 'ruins', 'garage']);
    expect(secret.map((d) => d.firstClearDiamonds)).toEqual([100, 150, 200]);
    expect(manualGameOf('ruins')).toBe('run');
    expect(manualGameOf('rooftop')).toBe('timing');
  });
});

describe('누적 횟수', () => {
  it('작업하기는 works를 올리고 새벽 3시대에는 dawnWorks도 올린다', () => {
    const dawn = new Date(2024, 0, 15, 3, 30).getTime();
    const a = work(at(base(), dawn));
    expect(a.ok && a.state.counters).toMatchObject({ works: 1, dawnWorks: 1 });
    const noon = work(at(base(), new Date(2024, 0, 15, 12).getTime()));
    expect(noon.ok && noon.state.counters).toMatchObject({ works: 1, dawnWorks: 0 });
  });

  it('마이크 압수가 일어나면 seizures가 오른다', () => {
    const r = advance(base({ activePersona: 'dark', heat: 99 }), 10_000, { efficiency: 1 });
    expect(r.events.some((e) => e.type === 'micSeized')).toBe(true);
    expect(r.state.counters.seizures).toBe(1);
    // 한 번 크게 전진해도 여러 번 나눠 전진해도 같다
    let s = base({ activePersona: 'dark', heat: 99 });
    for (let i = 0; i < 10; i++) s = advance(s, 1000, { efficiency: 1 }).state;
    expect(s.counters.seizures).toBe(1);
  });
});

describe('업적', () => {
  it('조건을 채우면 열리고 다이아를 한 번만 받는다', () => {
    const s = withCounters(base({ lastSettledAt: T0 + 5 }), { works: 1 });
    const r = evaluateAchievements(s);
    expect(r.unlocked.map((d) => d.id)).toEqual(['first-verse']);
    expect(r.state.diamonds).toBe(1);
    expect(r.state.achievements['first-verse']).toBe(T0 + 5);
    const again = evaluateAchievements(r.state);
    expect(again.unlocked).toEqual([]);
    expect(again.state).toBe(r.state);
  });

  it('팬 수·레벨 같은 파생 지표도 한꺼번에 열린다', () => {
    const r = evaluateAchievements(base({ fans: 1620 }));
    const ids = r.unlocked.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['fans-100', 'fans-1k', 'level-10']));
    expect(ids).not.toContain('fans-10k');
    expect(r.state.diamonds).toBe(r.unlocked.reduce((a, d) => a + d.diamonds, 0));
  });

  it('지표 값 계산', () => {
    const s = clearedNormalStages({ singles: single(3) });
    expect(achievementValue(s, 'singles')).toBe(3);
    expect(achievementValue(s, 'stages')).toBe(STAGES.filter((d) => !d.darkOnly).length);
    expect(achievementValue(s, 'tour')).toBe(1);
    expect(achievementValue(s, 'world')).toBe(1);
    expect(achievementValue(s, 'secrets')).toBe(0);
    expect(achievementValue({ ...s, equipment: { mic: 20, studio: 20, promotion: 0 } }, 'maxedEquip')).toBe(2);
    expect(achievementValue({ ...s, cosmetics: { ...s.cosmetics, themes: ['default', 'neon'] } }, 'themes')).toBe(1);
  });

  it('칭호는 달성한 칭호 업적만 달 수 있다', () => {
    const none = setTitle(base(), 'grind');
    expect(!none.ok && none.reason).toBe('not_owned');
    const s = base({ achievements: { grind: T0, 'first-verse': T0 } });
    const ok = setTitle(s, 'grind');
    expect(ok.ok && titleText(ok.state)).toBe('라임 기계');
    const noTitle = setTitle(s, 'first-verse'); // 칭호가 없는 업적
    expect(!noTitle.ok && noTitle.reason).toBe('not_owned');
    if (!ok.ok) return;
    const cleared = setTitle(ok.state, null);
    expect(cleared.ok && cleared.state.cosmetics.title).toBeNull();
  });

  it('모든 업적에 문구가 있고 ID가 겹치지 않는다', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.every((a) => a.goal > 0 && a.diamonds > 0)).toBe(true);
  });
});

describe('미션·출석', () => {
  const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

  it('날짜 키와 주(월요일) 키', () => {
    expect(dayKey(day(2024, 3, 6))).toBe('2024-03-06');
    expect(weekKey(day(2024, 3, 6))).toBe('2024-03-04'); // 수요일 → 그 주 월요일
    expect(weekKey(day(2024, 3, 10))).toBe('2024-03-04'); // 일요일은 앞 월요일 주
    expect(weekKey(day(2024, 3, 11))).toBe('2024-03-11');
  });

  it('처음 굴리면 기준을 잡고 진행도는 0, 바뀐 게 없으면 같은 상태', () => {
    const s = rollMissions(at(base(), day(2024, 3, 6)));
    expect(s.missions.day).toBe('2024-03-06');
    expect(missionStatuses(s, 'daily').every((m) => m.value === 0)).toBe(true);
    expect(rollMissions(s)).toBe(s);
  });

  it('진행도는 지표의 증가량이고, 완료해야 받을 수 있고, 한 번만 받는다', () => {
    let s = rollMissions(at(withCounters(base(), { works: 40 }), day(2024, 3, 6)));
    s = withCounters(s, { works: 40 + 100 });
    expect(missionStatuses(s, 'daily').find((m) => m.def.id === 'd-work')).toMatchObject({ value: 100, done: true, claimed: false });
    const early = claimMission(s, 'd-buy');
    expect(!early.ok && early.reason).toBe('not_ready');
    const r = claimMission(s, 'd-work');
    expect(r.ok && r.diamonds).toBe(1);
    if (!r.ok) return;
    expect(r.state.diamonds).toBe(1);
    expect(r.state.counters.missions).toBe(1);
    const dup = claimMission(r.state, 'd-work');
    expect(!dup.ok && dup.reason).toBe('already_done');
    const unknown = claimMission(r.state, 'nope');
    expect(!unknown.ok && unknown.reason).toBe('not_found');
  });

  it('하루 미션을 모두 받으면 보너스를 받는다', () => {
    let s = rollMissions(at(base(), day(2024, 3, 6)));
    s = withCounters(s, { works: 100, buys: 1, concerts: 2, posts: 2, mails: 2, arcades: 3, pets: 2 });
    expect(allBonusStatus(s, 'daily').ready).toBe(false);
    const early = claimMission(s, 'd-all');
    expect(!early.ok && early.reason).toBe('not_ready');
    for (const m of MISSIONS.filter((x) => x.scope === 'daily')) {
      const r = claimMission(s, m.id);
      if (!r.ok) throw new Error(`${m.id}: ${r.reason}`);
      s = r.state;
    }
    expect(allBonusStatus(s, 'daily')).toMatchObject({ ready: true, claimed: false, diamonds: 3 });
    const bonus = claimMission(s, 'd-all');
    expect(bonus.ok && bonus.diamonds).toBe(3);
    if (!bonus.ok) return;
    expect(bonus.state.counters.missions).toBe(MISSIONS.filter((x) => x.scope === 'daily').length); // 보너스는 미션 횟수에 세지 않는다
    expect(claimMission(bonus.state, 'd-all').ok).toBe(false);
  });

  it('날짜가 바뀌면 일일 미션만 새로 시작하고, 주가 바뀌면 주간 미션도 새로 시작한다', () => {
    let s = rollMissions(at(base(), day(2024, 3, 6)));
    s = withCounters(s, { works: 3000 });
    for (const id of ['d-work', 'w-work']) {
      const r = claimMission(s, id);
      if (!r.ok) throw new Error(`${id}: ${r.reason}`);
      s = r.state;
    }
    expect(s.missions.claimed).toEqual(['d-work', 'w-work']);
    const nextDay = rollMissions(at(s, day(2024, 3, 7)));
    expect(nextDay.missions.claimed).toEqual(['w-work']);
    expect(missionStatuses(nextDay, 'daily').find((m) => m.def.id === 'd-work')?.value).toBe(0);
    expect(missionStatuses(nextDay, 'weekly').find((m) => m.def.id === 'w-work')?.claimed).toBe(true);
    const nextWeek = rollMissions(at(s, day(2024, 3, 11)));
    expect(nextWeek.missions.claimed).toEqual([]);
    expect(missionStatuses(nextWeek, 'weekly').every((m) => m.value === 0)).toBe(true);
  });

  it('출석: 하루에 한 번, 이어서 하면 연속일이 늘고 건너뛰면 1일부터', () => {
    let s = at(base(), day(2024, 3, 6));
    expect(attendanceStatus(s)).toMatchObject({ claimedToday: false, streak: 0, nextStreak: 1, reward: 1 });
    const a = claimAttendance(s);
    expect(a.ok && [a.streak, a.diamonds]).toEqual([1, 1]);
    if (!a.ok) return;
    s = a.state;
    const dup = claimAttendance(s);
    expect(!dup.ok && dup.reason).toBe('already_done');
    expect(attendanceStatus(s)).toMatchObject({ claimedToday: true, streak: 1 });
    // 다음 날 이어서
    const d2 = claimAttendance(at(s, day(2024, 3, 7)));
    expect(d2.ok && d2.streak).toBe(2);
    // 하루를 건너뛰면 끊긴다
    const skipped = at(s, day(2024, 3, 8));
    expect(attendanceStatus(skipped)).toMatchObject({ streak: 0, nextStreak: 1 });
    const d3 = claimAttendance(skipped);
    expect(d3.ok && d3.streak).toBe(1);
    expect(d3.ok && d3.state.counters.bestStreak).toBe(1);
  });

  it('7일째 출석은 큰 보상이고 최고 연속일이 기록된다', () => {
    expect(attendanceReward(7)).toBe(10);
    expect(attendanceReward(8)).toBe(1); // 7일 주기
    let s = at(base(), day(2024, 3, 6));
    s = { ...s, missions: { ...s.missions, streak: 6, lastAttend: dayKey(day(2024, 3, 5)) } };
    const r = claimAttendance(s);
    expect(r.ok && [r.streak, r.diamonds]).toEqual([7, 10]);
    expect(r.ok && r.state.counters.bestStreak).toBe(7);
  });
});

describe('팬 DM', () => {
  const mailAt = (n: number): Mail => ({ id: `mail-${n}`, tpl: 'sup-1', nick: '테스트', at: T0 });
  const withInbox = (inbox: Mail[], over: Partial<GameState> = {}): GameState => {
    const s = base(over);
    return { ...s, fanMail: { ...s.fanMail, seq: inbox.length, inbox } };
  };

  it('도착 시각이 되기 전에는 아무것도 오지 않는다', () => {
    const s = base({ fans: 100 });
    expect(rollMail(s)).toBe(s);
    const justBefore = at(s, T0 + 2 * MIN - 1);
    expect(rollMail(justBefore)).toBe(justBefore);
  });

  it('도착 시각이 되면 한 통이 오고, 다음 시각은 7~17분 사이로 정해진다', () => {
    const s = at(base({ fans: 100 }), T0 + 2 * MIN);
    const r = rollMail(s);
    expect(r.fanMail.inbox).toHaveLength(1);
    expect(r.fanMail.seq).toBe(1);
    const gap = r.fanMail.nextAt - (T0 + 2 * MIN);
    expect(gap).toBe(mailIntervalMs(s.fanMail.seed, 1));
    expect(gap).toBeGreaterThanOrEqual(BALANCE.fanMail.intervalMinMs);
    expect(gap).toBeLessThanOrEqual(BALANCE.fanMail.intervalMaxMs);
    expect(mailTemplateById(r.fanMail.inbox[0].tpl)).toBeDefined();
    expect(rollMail(r)).toBe(r);
  });

  it('간격은 7~17분 무작위이고(평균 12분 근처) 같은 씨앗과 번호면 항상 같다', () => {
    let sum = 0;
    let lo = Infinity;
    let hi = 0;
    const N = 3000;
    for (let seq = 1; seq <= N; seq++) {
      const g = mailIntervalMs(42, seq);
      expect(g).toBe(mailIntervalMs(42, seq));
      expect(g % 1000).toBe(0);
      expect(g).toBeGreaterThanOrEqual(7 * MIN);
      expect(g).toBeLessThanOrEqual(17 * MIN);
      sum += g;
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(sum / N / MIN).toBeGreaterThan(11.7);
    expect(sum / N / MIN).toBeLessThan(12.3);
    expect(lo).toBeLessThan(7.3 * MIN); // 양 끝까지 실제로 나온다
    expect(hi).toBeGreaterThan(16.7 * MIN);
    // 씨앗이 다르면 간격 순서도 다르다
    expect([1, 2, 3, 4, 5].map((n) => mailIntervalMs(1, n))).not.toEqual([1, 2, 3, 4, 5].map((n) => mailIntervalMs(2, n)));
    const distinct = new Set(Array.from({ length: 50 }, (_, i) => mailIntervalMs(7, i + 1)));
    expect(distinct.size).toBeGreaterThan(30);
  });

  it('한 번에 굴리든 1초씩 나눠 굴리든 같은 시각에 같은 DM이 온다', () => {
    const start = base({ fans: 100 });
    const end = T0 + 3 * 3600_000;
    // 1초씩: 도착 시각을 기록한다
    let fine = start;
    const arrivals: number[] = [];
    for (let t = T0; t <= end; t += 1000) {
      const before = fine.fanMail.seq;
      fine = rollMail(at(fine, t));
      if (fine.fanMail.seq > before) arrivals.push(t);
    }
    // 첫 도착은 2분, 이후 간격은 모두 7~17분
    expect(arrivals[0]).toBe(T0 + 2 * MIN);
    for (let i = 1; i < arrivals.length; i++) {
      const gap = arrivals[i] - arrivals[i - 1];
      expect(gap).toBeGreaterThanOrEqual(7 * MIN);
      expect(gap).toBeLessThanOrEqual(17 * MIN);
    }
    expect(arrivals.length).toBeGreaterThanOrEqual(10); // 3시간 ≥ 10통(평균 12분 간격이면 약 15통)
    // 한 번에
    const coarse = rollMail(at(start, end));
    expect(coarse.fanMail.seq).toBe(fine.fanMail.seq);
    expect(coarse.fanMail.nextAt).toBe(fine.fanMail.nextAt);
    expect(coarse.fanMail.inbox.map((m) => [m.id, m.tpl, m.nick, m.at])).toEqual(fine.fanMail.inbox.map((m) => [m.id, m.tpl, m.nick, m.at]));
  });

  it('오래 비웠으면 받은편지함 크기(6통)까지만 쌓이고, 도착 시각은 지금 뒤로 간다', () => {
    const s = at(base({ fans: 100 }), T0 + 100 * 3600_000);
    const r = rollMail(s);
    expect(r.fanMail.inbox).toHaveLength(BALANCE.fanMail.cap);
    expect(r.fanMail.seq).toBeGreaterThan(100); // 100시간이면 300통쯤 온 셈
    expect(r.fanMail.inbox[BALANCE.fanMail.cap - 1].id).toBe(`mail-${r.fanMail.seq}`);
    expect(r.fanMail.nextAt).toBeGreaterThan(s.lastSettledAt);
    expect(r.fanMail.nextAt - s.lastSettledAt).toBeLessThanOrEqual(BALANCE.fanMail.intervalMaxMs);
  });

  it('시계가 아주 앞서가도 한 번 굴리는 데 멈추지 않는다', () => {
    const s = at(base({ fans: 100 }), T0 + 365 * 24 * 3600_000 * 50);
    const t0 = Date.now();
    const r = rollMail(s);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.fanMail.inbox).toHaveLength(BALANCE.fanMail.cap);
    expect(r.fanMail.nextAt).toBeGreaterThan(s.lastSettledAt);
  });

  it('팬이 없으면 오지 않고 도착을 미룬다', () => {
    const s = at(base({ fans: 0 }), T0 + 60 * MIN);
    const r = rollMail(s);
    expect(r.fanMail.inbox).toHaveLength(0);
    expect(r.fanMail.nextAt).toBe(T0 + 60 * MIN + BALANCE.fanMail.firstDelayMs);
  });

  it('같은 씨앗과 번호면 같은 DM이 오고, 종류 비율이 대략 가중치를 따른다', () => {
    const run = (seed: number) => rollMail(at({ ...base({ fans: 100 }), fanMail: { ...base().fanMail, seed, nextAt: T0 } }, T0));
    expect(run(7).fanMail.inbox).toEqual(run(7).fanMail.inbox);
    let anti = 0;
    const N = 600;
    for (let seed = 0; seed < N; seed++) {
      const m = run(seed).fanMail.inbox[0];
      const tpl = mailTemplateById(m.tpl);
      expect(tpl).toBeDefined();
      if (tpl?.kind === 'anti') anti++;
    }
    expect(anti / N).toBeGreaterThan(0.14);
    expect(anti / N).toBeLessThan(0.26);
  });

  it('응원 DM은 13개이고 첫 세 개는 지정한 문구다', () => {
    const support = MAIL_TEMPLATES.filter((t) => t.kind === 'support');
    expect(support).toHaveLength(13);
    expect(support.map((t) => t.id)).toEqual(Array.from({ length: 13 }, (_, i) => `sup-${i + 1}`));
    expect(support.slice(0, 3).map((t) => t.text)).toEqual(['오빠가 있기에 내가 살아.. 사랑해💕🫂', '사파형 개귀여워!!!', '오빠노래듣고 힘내고있어 항상 응원할게!']);
    // 첫 답장은 정성 어린 답장(heart)이고, 문구에는 팬 말투(오빠·사파형)가 들어 있다
    for (const t of support) {
      expect(t.replies[0].tier).toBe('heart');
      expect(/오빠|사파형/.test(t.text)).toBe(true);
    }
  });

  it('모든 템플릿은 답장이 있고 안티에는 받아치기·무시가 있다', () => {
    for (const t of MAIL_TEMPLATES) {
      expect(t.replies.length).toBeGreaterThanOrEqual(2);
      if (t.kind === 'anti') expect(t.replies.some((r) => r.tier === 'clap')).toBe(true);
    }
    expect(new Set(MAIL_TEMPLATES.map((t) => t.id)).size).toBe(MAIL_TEMPLATES.length);
  });

  it('답장하면 보상을 받고 DM이 사라지고 횟수가 오른다', () => {
    const s = withInbox([mailAt(1)], { fans: 100 });
    const r = replyMail(s, 'mail-1', 0); // heart
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const eff = replyEffect(s, 'heart');
    expect(r.fans).toBe(eff.fans);
    expect(r.fans).toBeGreaterThanOrEqual(1);
    expect(r.coins).toBe(eff.coins);
    expect(r.coins).toBeGreaterThan(0);
    expect(r.state.fans).toBe(100 + eff.fans);
    expect(r.state.coins).toBe(eff.coins);
    expect(r.state.fanMail.inbox).toHaveLength(0);
    expect(r.state.counters).toMatchObject({ mails: 1, antiMails: 0 });
  });

  it('팬이 늘어 레벨이 오르면 다이아도 받는다', () => {
    const s = withInbox([mailAt(1)], { fans: 19 }); // Lv.1 → 20명이 되면 Lv.2
    const r = replyMail(s, 'mail-1', 0);
    expect(r.ok && r.state.fans).toBe(20);
    expect(r.ok && r.diamonds).toBe(BALANCE.diamond.levelUp);
  });

  it('없는 DM·없는 답장은 실패하고, 무시는 팬이 안 변한다', () => {
    const s = withInbox([mailAt(1)], { fans: 100 });
    const a = replyMail(s, 'mail-9', 0);
    expect(!a.ok && a.reason).toBe('not_found');
    const b = replyMail(s, 'mail-1', 9);
    expect(!b.ok && b.reason).toBe('not_found');
    const anti = withInbox([{ ...mailAt(2), tpl: 'anti-1' }], { fans: 100 });
    const ignored = replyMail(anti, 'mail-2', 2);
    expect(ignored.ok && ignored.fans).toBe(0);
    expect(ignored.ok && ignored.state.counters.antiMails).toBe(1);
  });

  it('받아치기는 같은 DM이면 항상 같은 결과이고, 이기면 팬이 늘고 지면 줄어든다', () => {
    const outcomeOf = (n: number) => {
      const s = withInbox([{ id: `mail-${n}`, tpl: 'anti-1', nick: 'x', at: T0 }], { fans: 1000 });
      const r = replyMail(s, `mail-${n}`, 1);
      if (!r.ok) throw new Error('reply failed');
      return r;
    };
    let wins = 0;
    for (let n = 1; n <= 300; n++) {
      const r = outcomeOf(n);
      expect(outcomeOf(n).outcome).toBe(r.outcome);
      if (r.outcome === 'win') {
        wins++;
        expect(r.fans).toBe(20);
        expect(r.state.fans).toBe(1020);
      } else {
        expect(r.outcome).toBe('lose');
        expect(r.fans).toBe(-10);
        expect(r.state.fans).toBe(990);
      }
    }
    expect(wins / 300).toBeGreaterThan(0.4);
    expect(wins / 300).toBeLessThan(0.6);
  });
});

describe('모노그램', () => {
  const ready = (over: Partial<GameState> = {}) => base({ singles: single(1), fans: 100, ...over });

  it('첫 싱글을 내기 전에는 올릴 수 없다', () => {
    const r = startPost(base(), 'lyric');
    expect(!r.ok && r.reason).toBe('need_single');
  });

  it('종류별 팬 공식', () => {
    expect(postBaseFans(100, 'lyric')).toBe(3);
    expect(postBaseFans(100, 'selfie')).toBe(5);
    expect(postBaseFans(100, 'reels')).toBe(18);
    expect(postBaseFans(0, 'lyric')).toBe(1);
  });

  it('올리면 슬롯을 쓰고, 가득 차면 슬롯을 사야 한다 (10·25·60)', () => {
    let s = ready({ diamonds: 1000 });
    const a = startPost(s, 'selfie');
    expect(a.ok && a.post).toMatchObject({ id: 'post-1', kind: 'selfie', endsAt: T0 + 20 * MIN });
    if (!a.ok) return;
    s = a.state;
    expect(s.counters.posts).toBe(1);
    const full = startPost(s, 'lyric');
    expect(!full.ok && full.reason).toBe('slots_full');
    expect(nextSlotCost(s)).toBe(10);
    for (const [cost, slots] of [
      [10, 2],
      [25, 3],
      [60, 4],
    ] as const) {
      const r = buySlot(s);
      expect(r.ok && [r.cost, r.slots]).toEqual([cost, slots]);
      if (!r.ok) return;
      s = r.state;
    }
    expect(nextSlotCost(s)).toBeNull();
    const max = buySlot(s);
    expect(!max.ok && max.reason).toBe('max_level');
    expect(buySlot(ready({ diamonds: 9 })).ok).toBe(false);
  });

  it('끝나기 전에는 수확할 수 없고, 끝나면 팬을 받고 게시물이 사라진다', () => {
    const a = startPost(ready(), 'reels');
    if (!a.ok) throw new Error('start failed');
    const early = collectPost(at(a.state, a.post.endsAt - 1), a.post.id);
    expect(!early.ok && early.reason).toBe('not_ready');
    const done = at(a.state, a.post.endsAt);
    const st = postStatuses(done)[0];
    expect(st.ready).toBe(true);
    const r = collectPost(done, a.post.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fans).toBe(st.fans);
    expect(r.state.fans).toBe(100 + st.fans);
    expect(r.state.monogram.posts).toHaveLength(0);
    expect(r.comment.length).toBeGreaterThan(0);
    const dup = collectPost(r.state, a.post.id);
    expect(!dup.ok && dup.reason).toBe('not_found');
  });

  it('결과는 씨앗과 번호로 정해지고 비율이 설정을 따른다', () => {
    expect(postOutcome(123, 'post-5')).toEqual(postOutcome(123, 'post-5'));
    let viral = 0;
    let hate = 0;
    const N = 4000;
    for (let n = 1; n <= N; n++) {
      const o = postOutcome(99, `post-${n}`);
      if (o.outcome === 'viral') {
        viral++;
        expect(o.diamonds).toBeGreaterThanOrEqual(1);
        expect(o.diamonds).toBeLessThanOrEqual(3);
      } else {
        expect(o.diamonds).toBe(0);
      }
      if (o.outcome === 'hate') hate++;
    }
    expect(viral / N).toBeGreaterThan(0.08);
    expect(viral / N).toBeLessThan(0.12);
    expect(hate / N).toBeGreaterThan(0.12);
    expect(hate / N).toBeLessThan(0.18);
  });

  it('바이럴이면 팬 ×5와 다이아와 virals 기록, 악플이면 ×0.4', () => {
    const find = (kind: 'viral' | 'hate') => {
      const seed = ready().monogram.seed;
      for (let n = 1; n < 500; n++) if (postOutcome(seed, `post-${n}`).outcome === kind) return n;
      throw new Error('not found');
    };
    for (const [kind, mult] of [
      ['viral', 5],
      ['hate', 0.4],
    ] as const) {
      const n = find(kind);
      const s = ready();
      const a = startPost({ ...s, monogram: { ...s.monogram, seq: n - 1 } }, 'selfie');
      if (!a.ok) throw new Error('start failed');
      const r = collectPost(at(a.state, a.post.endsAt), a.post.id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.outcome).toBe(kind);
      expect(r.fans).toBe(Math.max(1, Math.round(5 * mult)));
      expect(r.state.counters.virals).toBe(kind === 'viral' ? 1 : 0);
      if (kind === 'viral') expect(r.diamonds).toBeGreaterThanOrEqual(1);
    }
  });

  it('홍보 캠페인 중이면 모이는 팬도 배가 된다', () => {
    const s = ready({ coins: 1e6 });
    const plain = postStatuses({ ...s, monogram: { ...s.monogram, posts: [{ id: 'post-1', kind: 'reels', persona: 'normal', at: T0, endsAt: T0 }] } })[0];
    const c = buyCampaign(s, 'insta');
    if (!c.ok) throw new Error('campaign failed');
    const boosted = postStatuses({ ...c.state, monogram: { ...s.monogram, posts: [{ id: 'post-1', kind: 'reels', persona: 'normal', at: T0, endsAt: T0 }] } })[0];
    expect(boosted.fans).toBe(Math.round(plain.fans * 2));
  });
});

describe('저장 검증(나중에 추가된 필드)', () => {
  it('새 게임의 상태는 그대로 통과하고 다시 읽어도 같다', () => {
    const s = base();
    const v = validateState(JSON.parse(JSON.stringify(s)));
    expect(v.ok).toBe(true);
    expect(v.ok && v.state).toEqual(s);
  });

  it('예전 저장(새 필드 없음)은 기본값으로 읽힌다', () => {
    const { buffs: _b, cosmetics: _c, counters: _n, achievements: _a, missions: _m, fanMail: _f, monogram: _g, ...legacy } = base({ fans: 150 });
    const v = validateState({ ...legacy, diamondUpgrades: { production: 2, royalty: 1 } });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.state.diamondUpgrades).toEqual({ production: 2, royalty: 1, offline: 0 });
    expect(v.state.buffs).toEqual({ snack: null, campaign: null });
    expect(v.state.cosmetics).toEqual({ themes: ['default'], theme: 'default', title: null });
    expect(v.state.counters).toEqual(zeroCounters());
    expect(v.state.achievements).toEqual({});
    expect(v.state.monogram).toMatchObject({ slots: 1, posts: [], seq: 0 });
    expect(v.state.fanMail).toMatchObject({ seq: 0, inbox: [] });
    // 이미 한 일은 처음 한 번 평가에서 한꺼번에 열린다
    expect(evaluateAchievements(v.state).unlocked.map((d) => d.id)).toEqual(expect.arrayContaining(['fans-100']));
  });

  it('잘못된 값은 거부하고, 알 수 없는 ID는 조용히 버린다', () => {
    const s = JSON.parse(JSON.stringify(base()));
    const bad = (patch: Record<string, unknown>) => validateState({ ...s, ...patch }).ok;
    expect(bad({ counters: { ...s.counters, works: -1 } })).toBe(false);
    expect(bad({ counters: 'x' })).toBe(false);
    expect(bad({ monogram: { ...s.monogram, slots: 9 } })).toBe(false);
    expect(bad({ buffs: { snack: { id: 'kimbap', until: 'x' }, campaign: null } })).toBe(false);
    expect(bad({ diamondUpgrades: { production: 0, royalty: 0, offline: 9 } })).toBe(false);

    const lenient = validateState({
      ...s,
      buffs: { snack: { id: '없는간식', until: 5 }, campaign: { id: 'flyer', until: 7 } },
      cosmetics: { themes: ['pastel', '없는테마'], theme: '없는테마', title: 'grind' },
      achievements: { grind: 5, '없는업적': 9 },
      fanMail: { ...s.fanMail, inbox: [{ id: 'mail-1', tpl: '사라진템플릿', nick: 'x', at: 1 }, { id: 'mail-2', tpl: 'sup-1', nick: 'y', at: 2 }] },
    });
    expect(lenient.ok).toBe(true);
    if (!lenient.ok) return;
    expect(lenient.state.buffs).toEqual({ snack: null, campaign: { id: 'flyer', until: 7 } });
    expect(lenient.state.cosmetics).toEqual({ themes: ['default', 'pastel'], theme: 'default', title: 'grind' });
    expect(lenient.state.achievements).toEqual({ grind: 5 });
    expect(lenient.state.fanMail.inbox.map((m) => m.id)).toEqual(['mail-2']);
  });
});

describe('더보기 알림', () => {
  it('출석·받을 미션·DM·수확할 게시물을 센다', () => {
    const s = rollMissions(at(base({ singles: single(1), fans: 100 }), T0));
    expect(moreAlerts(s)).toEqual({ missions: 1, mail: 0, monogram: 0, collect: 0, total: 1 }); // 출석만
    const a = claimAttendance(s);
    if (!a.ok) throw new Error('attend failed');
    expect(moreAlerts(a.state).total).toBe(0);
    const busy = withCounters(a.state, { works: 100 });
    const withMail = { ...busy, fanMail: { ...busy.fanMail, inbox: [{ id: 'mail-1', tpl: 'sup-1', nick: 'x', at: T0 }] } };
    const posted = startPost(withMail, 'lyric');
    if (!posted.ok) throw new Error('post failed');
    const done = at(posted.state, posted.post.endsAt);
    expect(moreAlerts(done)).toEqual({ missions: 1, mail: 1, monogram: 1, collect: 0, total: 3 });
  });
});
