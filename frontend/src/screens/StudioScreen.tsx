import { useEffect, useState } from 'react';
import { StudioScene, type Mood } from '../components/StudioScene';
import { HeatGauge, PersonaBadge, WorkPad } from '../components/parts';
import { fmtHave, fmtRate } from '../components/format';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT } from '../game/content';
import {
  currentHint,
  isPenaltyActive,
  previewSingle,
  rhymeRate,
  roomTier,
  royaltyRate,
  switchStatus,
} from '../game/selectors';
import { doSwitch, setTab, useUi } from '../store/gameStore';

export function StudioScreen() {
  const ui = useUi();
  const g = ui.game;
  const persona = g.activePersona;
  const now = g.lastSettledAt;
  const hot = g.heat >= BALANCE.persona.hotThreshold;
  const penalized = isPenaltyActive(g);

  // 작업 입력 직후 잠깐만 '작업 중' 표정
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (ui.workPulse === 0) return;
    setWorking(true);
    const id = window.setTimeout(() => setWorking(false), 350);
    return () => window.clearTimeout(id);
  }, [ui.workPulse]);

  const mood: Mood = penalized && persona === 'normal' ? 'seized' : hot ? 'hot' : working ? 'work' : 'idle';
  const hint = currentHint(g);
  const preview = previewSingle(g);

  return (
    <section className="screen studio" aria-label="작업실">
      <div className={`scene-frame ${hot ? 'scene-hot' : ''} ${penalized ? 'scene-seized' : ''}`}>
        <StudioScene persona={persona} mood={mood} tier={roomTier(g)} pulse={ui.workPulse} />
        {ui.bubble && (
          <div key={ui.bubble.id} className={`bubble bubble-${ui.bubble.persona}`} role="status">
            {ui.bubble.text}
          </div>
        )}
        <div className="scene-tag">
          <PersonaBadge persona={persona} /> {PERSONA_TEXT[persona].name}
        </div>
      </div>

      <div className="switch-row" role="group" aria-label="자아 선택">
        {(['normal', 'dark'] as const).map((p) => {
          const st = switchStatus(g, p, now);
          const active = persona === p;
          return (
            <button
              key={p}
              type="button"
              className={`switch-btn switch-${p} ${active ? 'is-active' : ''} ${!active && !st.allowed ? 'is-locked' : ''}`}
              aria-pressed={active}
              aria-disabled={!active && !st.allowed}
              onClick={() => !active && doSwitch(p)}
            >
              <strong>{PERSONA_TEXT[p].name}</strong>
              <small>{p === 'normal' ? `라임 ${fmtRate(rhymeRate(g, 'normal', now))}/초 · 인세 ×1.25` : `라임 ${fmtRate(rhymeRate(g, 'dark', now))}/초 · 과열 +0.6/초`}</small>
            </button>
          );
        })}
      </div>
      <p className="lock-reason" role="status">
        {persona === 'normal'
          ? (switchStatus(g, 'dark', now).message ?? '어둠속성으로 바꿀 수 있어요 (과열 80 이하).')
          : (switchStatus(g, 'normal', now).message ?? '언제든 일반속성으로 돌아갈 수 있어요. 과열을 식혀요.')}
      </p>

      <HeatGauge heat={g.heat} persona={persona} />

      {penalized && persona === 'normal' && (
        <p className="seized-note" role="status">
          🎤 마이크 압수 회복 중 — 앞으로 {Math.ceil((g.recoveryPenaltyUntil - now) / 1000)}초 동안 일반 생산 50%. 재화는 그대로예요.
        </p>
      )}

      <div className="rhyme-row">
        <div className={`rhyme-box ${persona === 'normal' ? 'rhyme-active' : ''}`}>
          <span>일반 라임</span>
          <strong>{fmtHave(g.normalRhymes)}</strong>
        </div>
        <div className="rhyme-need">
          다음 싱글
          <br />
          <b>{fmtHave(preview.needRhymes)}</b> 필요
          <br />
          <small>({PERSONA_TEXT[persona].short} 라임만 사용)</small>
        </div>
        <div className={`rhyme-box rhyme-dark ${persona === 'dark' ? 'rhyme-active' : ''}`}>
          <span>어둠 라임</span>
          <strong>{fmtHave(g.darkRhymes)}</strong>
        </div>
      </div>

      <div className="rate-row">
        <div>
          <span className="rate-label">초당 라임</span>
          <strong>{fmtRate(rhymeRate(g))}</strong>
          <small>{persona === 'normal' ? '일반' : '어둠'} · 자동</small>
        </div>
        <div>
          <span className="rate-label">초당 인세</span>
          <strong>{fmtRate(royaltyRate(g))}</strong>
          <small>
            팬 {fmtHave(g.fans)}명 기준
            {g.fans === 0 && ' (싱글을 내면 생겨요)'}
          </small>
        </div>
      </div>

      <div className="pad-dock">
        <WorkPad persona={persona} />
      </div>

      {hint && (
        <button type="button" className="hint" onClick={() => setTab(hint.tab)}>
          <span aria-hidden>💡</span> {hint.text}
        </button>
      )}
    </section>
  );
}
