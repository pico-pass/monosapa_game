import { BALANCE, MISSIONS, MISSION_METRICS, type MissionDef } from './balance';
import { clampResource, missionMetricValue } from './selectors';
import { track, trackMax } from './tracking';
import type { CommandResult, Fail, FailReason, GameState, MissionState } from './types';

/*
 * 일일·주간 미션과 출석. 날짜는 기기 시간대 기준이고, 진행도는 "지금 지표 − 날짜(주)가 시작될 때의 지표"다.
 * 미션 상태는 날짜가 바뀌면 rollMissions()가 새 기준을 잡는다. (store가 틱·명령 직전에 호출한다)
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 그 날이 속한 주의 월요일 날짜 */
export function weekKey(ms: number): string {
  const d = new Date(ms);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d.getTime());
}

export function prevDayKey(ms: number): string {
  const d = new Date(ms);
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

export function emptyMissions(): MissionState {
  return { day: '', week: '', dayBase: {}, weekBase: {}, claimed: [], streak: 0, lastAttend: '' };
}

function snapshot(s: GameState): Record<string, number> {
  const base: Record<string, number> = {};
  for (const m of MISSION_METRICS) base[m] = missionMetricValue(s, m);
  return base;
}

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

/** 날짜·주가 바뀌었으면 새 기준을 잡고 그 범위의 받은 보상 기록을 지운다. 바뀐 게 없으면 같은 상태를 돌려준다. */
export function rollMissions(s: GameState): GameState {
  const now = s.lastSettledAt;
  const day = dayKey(now);
  const week = weekKey(now);
  const m = s.missions;
  if (m.day === day && m.week === week) return s;
  let { dayBase, weekBase, claimed } = m;
  if (m.day !== day) {
    dayBase = snapshot(s);
    claimed = claimed.filter((id) => !id.startsWith('d-'));
  }
  if (m.week !== week) {
    weekBase = snapshot(s);
    claimed = claimed.filter((id) => !id.startsWith('w-'));
  }
  return { ...s, missions: { ...m, day, week, dayBase, weekBase, claimed } };
}

export interface MissionStatus {
  def: MissionDef;
  value: number;
  goal: number;
  done: boolean;
  claimed: boolean;
}

export function missionStatuses(s: GameState, scope: MissionDef['scope']): MissionStatus[] {
  const m = s.missions;
  const base = scope === 'daily' ? m.dayBase : m.weekBase;
  return MISSIONS.filter((d) => d.scope === scope).map((def) => {
    const now = missionMetricValue(s, def.metric);
    const value = Math.max(0, now - (base[def.metric] ?? now));
    return { def, value: Math.min(value, def.goal), goal: def.goal, done: value >= def.goal, claimed: m.claimed.includes(def.id) };
  });
}

export const allBonusId = (scope: MissionDef['scope']): string => (scope === 'daily' ? 'd-all' : 'w-all');

export interface AllBonusStatus {
  id: string;
  diamonds: number;
  /** 이 범위 미션을 모두 받았다 */
  ready: boolean;
  claimed: boolean;
}

export function allBonusStatus(s: GameState, scope: MissionDef['scope']): AllBonusStatus {
  const id = allBonusId(scope);
  return {
    id,
    diamonds: BALANCE.missions.allBonus[scope],
    ready: missionStatuses(s, scope).every((x) => x.claimed),
    claimed: s.missions.claimed.includes(id),
  };
}

/** 받을 수 있는 보상이 있는 미션 수 (탭 알림용) */
export function claimableMissions(s: GameState): number {
  let n = 0;
  for (const scope of ['daily', 'weekly'] as const) {
    n += missionStatuses(s, scope).filter((x) => x.done && !x.claimed).length;
    const b = allBonusStatus(s, scope);
    if (b.ready && !b.claimed) n++;
  }
  return n;
}

/** 미션 하나(또는 전체 완료 보너스)의 보상을 받는다. */
export function claimMission(state: GameState, id: string): CommandResult<{ diamonds: number }> {
  if (state.missions.claimed.includes(id)) return fail(state, 'already_done');
  let diamonds: number;
  let countAsMission = true;
  const bonus = (['daily', 'weekly'] as const).find((scope) => allBonusId(scope) === id);
  if (bonus) {
    const b = allBonusStatus(state, bonus);
    if (!b.ready) return fail(state, 'not_ready');
    diamonds = b.diamonds;
    countAsMission = false;
  } else {
    const def = MISSIONS.find((d) => d.id === id);
    if (!def) return fail(state, 'not_found');
    const st = missionStatuses(state, def.scope).find((x) => x.def.id === id)!;
    if (!st.done) return fail(state, 'not_ready');
    diamonds = def.diamonds;
  }
  const claimed: GameState = {
    ...state,
    diamonds: clampResource(state.diamonds + diamonds),
    missions: { ...state.missions, claimed: [...state.missions.claimed, id] },
  };
  return { ok: true, state: countAsMission ? track(claimed, 'missions') : claimed, diamonds };
}

export interface AttendanceStatus {
  claimedToday: boolean;
  /** 지금 이어지는 연속 출석일 수. 어제까지 이어졌거나 오늘 출석했으면 그 값, 끊겼으면 0 */
  streak: number;
  /** 오늘 출석하면 되는 연속일 수 */
  nextStreak: number;
  /** 오늘 출석하면 받는 다이아 */
  reward: number;
}

export const attendanceReward = (streak: number): number => {
  const table = BALANCE.missions.attendance;
  return table[(Math.max(1, streak) - 1) % table.length];
};

export function attendanceStatus(s: GameState): AttendanceStatus {
  const m = s.missions;
  const today = dayKey(s.lastSettledAt);
  const claimedToday = m.lastAttend === today;
  const continuing = claimedToday || m.lastAttend === prevDayKey(s.lastSettledAt);
  const streak = continuing ? m.streak : 0;
  const nextStreak = claimedToday ? m.streak : streak + 1;
  return { claimedToday, streak, nextStreak, reward: attendanceReward(nextStreak) };
}

/** 오늘 출석 보상을 받는다. 어제도 출석했으면 연속일이 늘고, 건너뛰었으면 1일부터 다시 센다. */
export function claimAttendance(state: GameState): CommandResult<{ diamonds: number; streak: number }> {
  const st = attendanceStatus(state);
  if (st.claimedToday) return fail(state, 'already_done');
  const streak = st.nextStreak;
  const diamonds = attendanceReward(streak);
  let next: GameState = {
    ...state,
    diamonds: clampResource(state.diamonds + diamonds),
    missions: { ...state.missions, streak, lastAttend: dayKey(state.lastSettledAt) },
  };
  next = trackMax(track(next, 'attendances'), 'bestStreak', streak);
  return { ok: true, state: next, diamonds, streak };
}
