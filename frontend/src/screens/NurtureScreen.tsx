import { useState } from 'react';
import { ASSETS } from '../assets';
import { BALANCE, DRINK_IDS, FUN_IDS, NURTURE_TEMP_OPEN, nurtureActionById, type NurtureActionDef } from '../game/balance';
import { NURTURE_ACTION_TEXT, NURTURE_TEXT, nurtureFace, PERSONA_TEXT } from '../game/content';
import { nurtureActions, nurtureView, previewNurture } from '../game/nurture';
import { wornCostume } from '../game/selectors';
import { NURTURE_GAUGES, nextMilestone, nurtureUnlocked, xpForLevel } from '../game/nurturedata';
import type { FailReason, GameState, NurtureGauge, Persona } from '../game/types';
import { Progress } from '../components/parts';
import { fmt, fmtCountdown } from '../components/format';
import { doNurture, doNurtureWake, useUi } from '../store/gameStore';

const N = BALANCE.nurture;
const pct = (x: number) => `${parseFloat((x * 100).toFixed(1))}%`;

const GAUGE_ICON: Record<NurtureGauge, string> = { full: '🍚', mood: '💗', tired: '💤', clean: '🫧' };
const gaugeLabel = (persona: Persona, g: NurtureGauge): string =>
  g === 'full' ? '포만감' : g === 'mood' ? NURTURE_TEXT[persona].moodName : g === 'tired' ? '피로도' : '청결도';

/** 버튼에 짧게 보여 주는 못 하는 이유 */
const BLOCK_TEXT: Partial<Record<FailReason, string>> = {
  gauge_high: '충분해요',
  too_tired: '너무 지침',
  sleeping: '자는 중',
  not_sleepy: '졸리지 않아요',
  care_cooldown: '잠깐 대기 중',
};

export function NurtureScreen() {
  const { game: g } = useUi();
  const [who, setWho] = useState<Persona>(g.activePersona);
  if (!nurtureUnlocked(g.fans)) {
    return (
      <section className="screen" aria-label="모노사파 육성">
        <h2 className="section-title">모노사파 육성</h2>
        <div className="card">
          <h3>🔒 팬 {fmt(N.unlockFans)}명부터 열려요</h3>
          <p className="muted">
            일반속성 모노사파는 밥을 먹이고 놀아 주고, 어둠속성 모노사파는 술과 밤놀이로 키워요. 레벨이 오르면 본 게임의 라임과 인세가 늘어요. (지금 팬 {fmt(g.fans)}명)
          </p>
          <Progress value={g.fans} max={N.unlockFans} label="육성 해금까지" />
        </div>
      </section>
    );
  }
  return (
    <section className="screen" aria-label="모노사파 육성">
      <h2 className="section-title">모노사파 육성</h2>
      {NURTURE_TEMP_OPEN && g.fans < N.unlockFans && (
        <p className="buff-note" role="note">
          🧪 임시로 열려 있어요. 원래는 팬 {fmt(N.unlockFans)}명부터예요.
        </p>
      )}
      <p className="muted">게이지는 시간이 지나면 변해요. 컨디션이 좋을수록 성장도가 많이 쌓이고, 레벨이 오르면 그 자아의 라임과 인세가 늘어요.</p>
      <div className="seg" role="group" aria-label="자아">
        {(['normal', 'dark'] as const).map((p) => {
          const v = nurtureView(g, p);
          return (
            <button key={p} type="button" className="nurture-tab" aria-pressed={who === p} onClick={() => setWho(p)}>
              <Portrait g={g} persona={p} className="nurture-thumb" />
              {PERSONA_TEXT[p].short} Lv {v.progress.level}
              {v.needsCare && <i className="nurture-dot" aria-label="돌봐 주세요" />}
            </button>
          );
        })}
      </div>
      <NurtureCard persona={who} />
    </section>
  );
}

function NurtureCard({ persona }: { persona: Persona }) {
  const { game: g } = useUi();
  const v = nurtureView(g, persona);
  const face = nurtureFace(persona, v);
  const t = NURTURE_TEXT[persona];
  const acts = nurtureActions(persona);
  const level = v.progress.level;
  const next = nextMilestone(persona, level);
  const vibeName = v.bonus.vibe === 'fan' ? '팬 획득' : '공연·계단 전투력';
  return (
    <div className={`card nurture nurture-${persona}`}>
      <div className="card-row">
        <h3>{t.title}</h3>
        <span className={`badge badge-${persona}`}>Lv {level}</span>
      </div>
      <div className="nurture-head">
        <div className={`nurture-sapa${v.sleeping ? ' nurture-asleep' : v.condition < 30 ? ' nurture-weak' : ''}`}>
          <Portrait g={g} persona={persona} className="nurture-sapa-img" fallback={face.icon} />
          <span className="nurture-mood" aria-hidden>
            {face.icon}
          </span>
        </div>
        <div>
          <p className="nurture-line">{face.line}</p>
          <small className="muted">
            컨디션 {Math.round(v.condition)}% · 성장도 ×{v.efficiency.toFixed(2)}
          </small>
        </div>
      </div>

      <Progress value={v.progress.into} max={v.progress.need} label={`${t.title} 성장`} />
      <small className="fineprint">
        다음 레벨까지 성장도 {fmt(v.progress.need - v.progress.into)} (누적 {fmt(v.side.xp)}/{fmt(xpForLevel(level + 1))}) · 레벨 제한 없음
      </small>
      <div className="nurture-bonus">
        <span>✍️ 라임 +{pct(v.bonus.rhyme)}</span>
        <span>🪙 인세 +{pct(v.bonus.coin)}</span>
        {v.bonus.extra > 0 && (
          <span>
            {v.bonus.vibe === 'fan' ? '👥' : '⚡'} {vibeName} +{pct(v.bonus.extra)}
          </span>
        )}
      </div>
      <small className="fineprint">
        Lv {next.level}에 {vibeName} +{pct(next.value)} · 레벨 {N.diamonds.every}마다 💎 {N.diamonds.amount}
      </small>

      <div className="nurture-gauges">
        {NURTURE_GAUGES.map((k) => (
          <Gauge key={k} persona={persona} kind={k} value={v.gauges[k]} />
        ))}
      </div>

      {v.sleeping && (
        <div className="nurture-sleep" role="status">
          <span>💤 자는 중… {fmtCountdown(v.sleepLeftMs)} 남았어요</span>
          <button type="button" className="btn btn-ghost" onClick={() => doNurtureWake(persona)}>
            깨우기
          </button>
        </div>
      )}

      {v.waitMs > 0 && (
        <div className="nurture-wait" role="status">
          ⏳ 다음 돌보기까지 {fmtCountdown(v.waitMs)} <small className="muted">(모든 돌보기는 자아마다 1분에 한 번)</small>
        </div>
      )}

      {persona === 'normal' ? (
        <div className="nurture-actions">
          {acts.map((a) => (
            <ActionButton key={a.id} g={g} persona={persona} def={a} />
          ))}
        </div>
      ) : (
        <>
          <Ladder title="🍶 알코올" ids={DRINK_IDS} g={g} persona={persona} />
          <Ladder title="🪩 놀기" ids={FUN_IDS} g={g} persona={persona} />
          <div className="nurture-actions">
            {acts
              .filter((a) => a.kind === 'wash' || a.kind === 'sleep')
              .map((a) => (
                <ActionButton key={a.id} g={g} persona={persona} def={a} />
              ))}
          </div>
        </>
      )}
      <small className="fineprint">
        {persona === 'dark' ? '어둠속성은 술이 포만감을 조금 채워 줘요. 더 센 단계가 열리면 낮은 단계의 쾌락과 성장도가 내성으로 줄어요. ' : ''}
        밥·놀이·씻기는 수치가 {N.needBelow} 이하일 때만 할 수 있어요. 코인은 그 자아의 인세 몇 초 분량이에요.
      </small>
    </div>
  );
}

/** 그 자아의 모노사파 그림. 입고 있는 코스튬이 있으면 코스튬 모습이고, 이미지가 없으면 얼굴 이모지로 대신한다. */
function Portrait({ g, persona, className, fallback }: { g: GameState; persona: Persona; className: string; fallback?: string }) {
  const costume = wornCostume(g, persona);
  const src = costume ? ASSETS.costumes[costume] : ASSETS.characters[persona];
  if (!src) return <span className={`${className} nurture-portrait-fallback`}>{fallback ?? NURTURE_TEXT[persona].moodIcon}</span>;
  return <img className={className} src={src} alt={NURTURE_TEXT[persona].title} draggable={false} />;
}

function Gauge({ persona, kind, value }: { persona: Persona; kind: NurtureGauge; value: number }) {
  const label = gaugeLabel(persona, kind);
  const bad = kind === 'tired' ? value >= 80 : value <= 20;
  return (
    <div className={`nurture-gauge nurture-gauge-${kind}${bad ? ' nurture-bad' : ''}`}>
      <span className="nurture-gauge-label">
        {GAUGE_ICON[kind]} {label}
      </span>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={N.gauge.max} aria-valuenow={Math.round(value)}>
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
      <strong className="nurture-gauge-num">{Math.round(value)}</strong>
    </div>
  );
}

function Ladder({ title, ids, g, persona }: { title: string; ids: readonly string[]; g: GameState; persona: Persona }) {
  return (
    <div className="nurture-ladder">
      <h4>{title}</h4>
      <div className="nurture-rungs">
        {ids.map((id) => {
          const def = nurtureActionById(id);
          return def ? <ActionButton key={id} g={g} persona={persona} def={def} rung /> : null;
        })}
      </div>
    </div>
  );
}

function ActionButton({ g, persona, def, rung }: { g: GameState; persona: Persona; def: NurtureActionDef; rung?: boolean }) {
  const text = NURTURE_ACTION_TEXT[def.id];
  const p = previewNurture(g, persona, def);
  const poor = p.blocked === null && g.coins < p.cost;
  const status = p.blocked === 'level_low' ? `Lv ${def.unlockLevel}` : p.blocked ? (BLOCK_TEXT[p.blocked] ?? '') : poor ? '코인 부족' : '';
  const worn = rung && p.tolerance < 1;
  return (
    <button
      type="button"
      className={`nurture-act${rung ? ' nurture-rung' : ''}${p.blocked === 'level_low' ? ' nurture-locked' : ''}`}
      disabled={p.blocked !== null || poor}
      title={text.line}
      onClick={() => doNurture(persona, def.id)}
    >
      <span className="nurture-act-icon" aria-hidden>
        {text.icon}
      </span>
      <span className="nurture-act-name">
        {rung && <small className="muted">{def.tier}단계 </small>}
        {text.name}
        {worn && <small className="muted"> · 내성 ×{p.tolerance.toFixed(2)}</small>}
      </span>
      <span className="nurture-act-meta">
        {status || `${p.cost > 0 ? `🪙 ${fmt(p.cost)} · ` : ''}성장도 +${p.xp}`}
      </span>
    </button>
  );
}
