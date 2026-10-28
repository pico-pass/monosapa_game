import { useState } from 'react';
import { fmt, fmtRate } from '../components/format';
import { Progress } from '../components/parts';
import { BALANCE, DIAMOND_UPGRADE_KINDS, EQUIPMENT_KINDS } from '../game/balance';
import { CLICK_POWER_TEXT, EQUIPMENT_TEXT, PERSONA_TEXT } from '../game/content';
import { equipmentDef, previewDiamondUpgrade, previewEquipment, previewMusicPower, roomTier } from '../game/selectors';
import type { DiamondUpgradeKind, EquipmentKind, GameState, Persona } from '../game/types';
import { doBuy, doBuyDiamondUpgrade, doBuyMusicPower, useUi } from '../store/gameStore';

export function EquipScreen() {
  const ui = useUi();
  const g = ui.game;
  // 처음에는 지금 쓰는 자아의 장비를 보여준다.
  const [view, setView] = useState<Persona>(g.activePersona);
  return (
    <section className="screen" aria-label="장비">
      <h2 className="section-title">장비</h2>
      <p className="muted">
        전투 능력치는 없어요. 장비는 생산과 인세만 올려줘요. 장비는 속성마다 따로 있고, 그 속성일 때만 효과가 나요. 최대 레벨 {BALANCE.equipment.maxLevel}.
      </p>
      <div className="seg" role="group" aria-label="장비 속성">
        {(['normal', 'dark'] as const).map((p) => (
          <button key={p} type="button" aria-pressed={view === p} onClick={() => setView(p)}>
            {PERSONA_TEXT[p].short}속성 장비
          </button>
        ))}
      </div>
      {EQUIPMENT_KINDS.map((kind) => (
        <EquipCard key={`${view}-${kind}`} g={g} kind={kind} persona={view} />
      ))}
      <ClickPowerCard g={g} persona={view} />

      <h2 className="section-title">다이아 업그레이드</h2>
      <p className="muted">다이아로만 올릴 수 있는 영구 업그레이드예요. 일반·어둠 두 속성 모두에 적용돼요. 최대 레벨 {BALANCE.diamond.upgrade.maxLevel}.</p>
      {DIAMOND_UPGRADE_KINDS.map((kind) => (
        <DiamondUpgradeCard key={kind} g={g} kind={kind} />
      ))}
    </section>
  );
}

const DIAMOND_UPGRADE_TEXT = {
  production: { name: '생산 증폭', icon: '⚡', effect: '자동 생산과 작업하기 라임이 늘어나요 (+5% / 레벨)', label: '생산 배율' },
  royalty: { name: '인세 증폭', icon: '💰', effect: '초당 인세 코인이 늘어나요 (+5% / 레벨)', label: '인세 배율' },
} as const;

function DiamondUpgradeCard({ g, kind }: { g: GameState; kind: DiamondUpgradeKind }) {
  const pv = previewDiamondUpgrade(g, kind);
  const t = DIAMOND_UPGRADE_TEXT[kind];
  return (
    <div className="card equip-card">
      <div className="card-row">
        <h3>
          <span aria-hidden>{t.icon}</span> {t.name} <small>Lv.{pv.level}</small>
        </h3>
      </div>
      <Progress value={pv.level} max={BALANCE.diamond.upgrade.maxLevel} label={`${t.name} 레벨`} />
      <p className="muted">{t.effect}</p>
      {pv.maxed ? (
        <p className="maxed">최대 레벨 도달 ✨</p>
      ) : (
        <>
          <dl className="before-after">
            <div>
              <dt>{t.label}</dt>
              <dd>
                ×{pv.before.toFixed(2)} → <b>×{pv.after.toFixed(2)}</b>
              </dd>
            </div>
          </dl>
          <button type="button" className="btn btn-accent btn-wide" disabled={!pv.affordable} onClick={() => doBuyDiamondUpgrade(kind)}>
            {pv.affordable ? `강화 💎 ${fmt(pv.cost)}` : `💎 ${fmt(pv.cost)} 필요 (보유 ${fmt(Math.floor(g.diamonds))})`}
          </button>
        </>
      )}
    </div>
  );
}

function EquipCard({ g, kind, persona }: { g: GameState; kind: EquipmentKind; persona: Persona }) {
  const pv = previewEquipment(g, kind, persona);
  const t = EQUIPMENT_TEXT[kind];
  const can = !pv.maxed && g.coins >= pv.cost;
  const isProm = kind === 'promotion';
  return (
    <div className="card equip-card">
      <div className="card-row">
        <h3>
          <span aria-hidden>{t.icon}</span> {t.name} <small>Lv.{pv.level}</small>
        </h3>
        {kind === 'studio' && <small className="muted">외형 단계 {roomTier(g, persona)}/4</small>}
      </div>
      <Progress value={pv.level} max={equipmentDef(persona).maxLevel} label={`${t.name} 레벨`} />
      <p className="muted">{t.effect}</p>
      {pv.maxed ? (
        <p className="maxed">최대 레벨 도달 ✨</p>
      ) : (
        <>
          <dl className="before-after">
            <div>
              <dt>{isProm ? '인세 배율' : '생산배율'}</dt>
              <dd>
                ×{pv.before.toFixed(2)} → <b>×{pv.after.toFixed(2)}</b>
              </dd>
            </div>
            <div>
              <dt>
                {pv.rateLabel} ({PERSONA_TEXT[persona].short}속성)
              </dt>
              <dd>
                {fmtRate(pv.rateBefore)} → <b>{fmtRate(pv.rateAfter)}</b>
              </dd>
            </div>
          </dl>
          <button type="button" className="btn btn-primary btn-wide" disabled={!can} onClick={() => doBuy(kind, persona)}>
            {can ? `강화 🪙 ${fmt(pv.cost)}` : `🪙 ${fmt(pv.cost)} 필요 (보유 ${fmt(Math.floor(g.coins))})`}
          </button>
        </>
      )}
    </div>
  );
}

/** 일반속성은 순수 음악력, 어둠속성은 음지 드립력. 장비와 달리 최대 레벨이 없고 작업하기 한 번에 얻는 라임을 올린다. */
function ClickPowerCard({ g, persona }: { g: GameState; persona: Persona }) {
  const pv = previewMusicPower(g, persona);
  const t = CLICK_POWER_TEXT[persona];
  return (
    <div className="card equip-card">
      <div className="card-row">
        <h3>
          <span aria-hidden>{t.icon}</span> {t.name} <small>Lv.{pv.level}</small>
        </h3>
        <small className="muted">최대 레벨 없음</small>
      </div>
      <p className="muted">{t.effect}</p>
      <dl className="before-after">
        <div>
          <dt>작업하기 1회 라임 ({PERSONA_TEXT[persona].short}속성)</dt>
          <dd>
            {fmtRate(pv.gainBefore)} → <b>{fmtRate(pv.gainAfter)}</b>
          </dd>
        </div>
      </dl>
      <button type="button" className="btn btn-primary btn-wide" disabled={!pv.affordable} onClick={() => doBuyMusicPower(persona)}>
        {pv.affordable ? `강화 🪙 ${fmt(pv.cost)}` : `🪙 ${fmt(pv.cost)} 필요 (보유 ${fmt(Math.floor(g.coins))})`}
      </button>
    </div>
  );
}
