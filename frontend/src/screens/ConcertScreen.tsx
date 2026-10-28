import { fmt, fmtCountdown } from '../components/format';
import { PersonaBadge } from '../components/parts';
import { BALANCE, STAGES, manualGameOf } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import { isTourComplete, stageStatus } from '../game/selectors';
import { doAutoConcert, setTourCardOpen, startManualConcert, useUi } from '../store/gameStore';

/** 모노사파런 안내: 자아에 따라 목표 거리가 다르다 */
function runNote(persona: 'normal' | 'dark'): string {
  const r = BALANCE.run.persona;
  return persona === 'dark'
    ? `달리면서 점점 빨라져요. ${r.dark.goalM.toLocaleString()}m를 완주하면 성공, 젤리를 많이 먹을수록 보상이 커져요. 어둠은 보상 ×${r.dark.rewardMult}.`
    : `달리면서 점점 빨라져요. ${r.normal.goalM.toLocaleString()}m를 완주하면 성공, 젤리를 많이 먹을수록 보상이 커져요.`;
}

export function ConcertScreen() {
  const ui = useUi();
  const g = ui.game;
  const now = g.lastSettledAt;
  const persona = g.activePersona;

  return (
    <section className="screen" aria-label="공연">
      <h2 className="section-title">공연</h2>
      <p className="muted">
        자동 공연은 기본 코인을 바로 받고 클리어로 인정돼요. 직접 공연(방구석은 마이크 타이밍, 지하 클럽은 모노사파런)은 더 많이 벌 수 있지만 필수는 아니에요. 공연 보상은 코인뿐이에요.
      </p>

      {isTourComplete(g) && (
        <button type="button" className="tour-banner" onClick={() => setTourCardOpen(true)}>
          🏆 첫 투어 완료! 카드 다시 보기
        </button>
      )}

      {STAGES.map((def) => {
        const st = stageStatus(g, def.id, now);
        const text = STAGE_TEXT[def.id];
        const idx = STAGES.findIndex((s) => s.id === def.id);
        const prevName = idx > 0 ? STAGE_TEXT[STAGES[idx - 1].id].name : null;
        const busy = !!ui.concertRun;
        return (
          <div key={def.id} className={`card stage-card ${st.unlocked ? '' : 'stage-locked'}`}>
            <div className="card-row">
              <h3>
                {st.unlocked ? '🎪' : '🔒'} {text.name}
              </h3>
              <span className="muted">{st.cleared ? `클리어 · 최고 ${st.bestScore || '자동'}${st.bestScore ? '점' : ''}` : '미클리어'}</span>
            </div>
            <p className="muted">{text.blurb}</p>
            <ul className="req-list">
              <li className={st.fansOk ? 'ok' : ''}>
                {st.fansOk ? '✔' : '○'} 팬 {fmt(st.fansRequired)}명 (현재 {fmt(Math.floor(g.fans))})
              </li>
              {prevName && (
                <li className={st.previousCleared ? 'ok' : ''}>
                  {st.previousCleared ? '✔' : '○'} {prevName} 클리어
                </li>
              )}
            </ul>
            <p className="muted">
              기본 🪙 {st.baseCoins}
              {!st.cleared && <> · 첫 클리어 보너스 🪙 {fmt(st.firstClearCoins)}</>}
            </p>
            {st.unlocked && st.cooldownLeftMs > 0 && (
              <p className="cooldown" role="status">
                ⏳ 쿨다운 {fmtCountdown(st.cooldownLeftMs)} (공연장마다 {BALANCE.concert.cooldownMs / 1000}초)
              </p>
            )}
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={!st.canRun || busy} onClick={() => doAutoConcert(def.id)}>
                자동 공연
              </button>
              <button type="button" className="btn btn-accent" disabled={!st.canRun || busy} onClick={() => startManualConcert(def.id)}>
                직접 공연{manualGameOf(def.id) === 'run' ? ' · 모노사파런' : ''} <PersonaBadge persona={persona} />
              </button>
            </div>
            {st.canRun && (
              <small className="muted">
                직접 공연 자아는 시작할 때 현재 자아({PERSONA_TEXT[persona].short})로 고정돼요. {manualGameOf(def.id) === 'run' ? runNote(persona) : persona === 'dark' ? `어둠은 판정이 더 좁은 대신 보상 ×${BALANCE.concert.personaRewardMult.dark}.` : ''}
              </small>
            )}
          </div>
        );
      })}
    </section>
  );
}
