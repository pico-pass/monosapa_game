import { Progress } from '../components/parts';
import { BALANCE } from '../game/balance';
import { MISSION_TEXT } from '../game/content';
import { allBonusStatus, attendanceReward, attendanceStatus, missionStatuses } from '../game/missions';
import type { GameState } from '../game/types';
import { doClaimAttendance, doClaimMission, useUi } from '../store/gameStore';

export function MissionScreen() {
  const { game: g } = useUi();
  const at = attendanceStatus(g);
  const cycle = BALANCE.missions.attendance.length;
  const dayInCycle = at.claimedToday ? ((at.streak - 1) % cycle) + 1 : at.streak % cycle;

  return (
    <section className="screen" aria-label="미션과 출석">
      <h2 className="section-title">미션·출석</h2>
      <p className="muted">날짜는 이 기기의 시간대 기준으로 바뀌어요. 보상은 다이아예요.</p>

      <div className="card">
        <div className="card-row">
          <h3>📆 출석</h3>
          <small className="muted">연속 {at.streak}일</small>
        </div>
        <ol className="attend-strip" aria-label={`${cycle}일 출석 보상`}>
          {BALANCE.missions.attendance.map((_, i) => {
            const done = i < dayInCycle;
            const today = !at.claimedToday && i === dayInCycle;
            return (
              <li key={i} className={`${done ? 'attend-done' : ''}${today ? ' attend-today' : ''}`}>
                <small>{i + 1}일</small>
                <b>💎{attendanceReward(i + 1)}</b>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn-primary btn-wide" disabled={at.claimedToday} onClick={doClaimAttendance}>
          {at.claimedToday ? '오늘은 출석했어요' : `출석하기 💎 ${at.reward} (${at.nextStreak}일째)`}
        </button>
        <p className="fineprint">하루를 건너뛰면 연속 일수가 1일부터 다시 시작해요.</p>
      </div>

      <MissionList g={g} scope="daily" title="☀️ 일일 미션" />
      <MissionList g={g} scope="weekly" title="🗓️ 주간 미션 (월요일에 새로 시작)" />
    </section>
  );
}

function MissionList({ g, scope, title }: { g: GameState; scope: 'daily' | 'weekly'; title: string }) {
  const list = missionStatuses(g, scope);
  const bonus = allBonusStatus(g, scope);
  return (
    <div className="card">
      <h3>{title}</h3>
      <ul className="mission-list">
        {list.map((m) => {
          const t = MISSION_TEXT[m.def.id];
          return (
            <li key={m.def.id} className="mission-row">
              <div className="mission-head">
                <span>{t.name}</span>
                <small className="muted">
                  {m.value.toLocaleString()} / {m.goal.toLocaleString()}
                  {t.unit}
                </small>
              </div>
              <Progress value={m.value} max={m.goal} label={t.name} />
              <button type="button" className="btn btn-ghost" disabled={!m.done || m.claimed} onClick={() => doClaimMission(m.def.id)}>
                {m.claimed ? '받음 ✔' : m.done ? `받기 💎 ${m.def.diamonds}` : `💎 ${m.def.diamonds}`}
              </button>
            </li>
          );
        })}
        <li className="mission-row mission-bonus">
          <div className="mission-head">
            <span>모두 받으면 보너스</span>
            <small className="muted">{list.filter((m) => m.claimed).length} / {list.length}</small>
          </div>
          <button type="button" className="btn btn-accent" disabled={!bonus.ready || bonus.claimed} onClick={() => doClaimMission(bonus.id)}>
            {bonus.claimed ? '받음 ✔' : `보너스 받기 💎 ${bonus.diamonds}`}
          </button>
        </li>
      </ul>
    </div>
  );
}
