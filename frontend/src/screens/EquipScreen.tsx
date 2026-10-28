import { fmt, fmtRate } from '../components/format';
import { Progress } from '../components/parts';
import { BALANCE, EQUIPMENT_KINDS } from '../game/balance';
import { EQUIPMENT_TEXT } from '../game/content';
import { previewEquipment, roomTier } from '../game/selectors';
import { doBuy, useUi } from '../store/gameStore';

export function EquipScreen() {
  const ui = useUi();
  const g = ui.game;
  return (
    <section className="screen" aria-label="장비">
      <h2 className="section-title">장비</h2>
      <p className="muted">전투 능력치는 없어요. 장비는 생산과 인세만 올려줘요. 최대 레벨 {BALANCE.equipment.maxLevel}.</p>
      {EQUIPMENT_KINDS.map((kind) => {
        const pv = previewEquipment(g, kind);
        const t = EQUIPMENT_TEXT[kind];
        const can = !pv.maxed && g.coins >= pv.cost;
        const isProm = kind === 'promotion';
        return (
          <div key={kind} className="card equip-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name} <small>Lv.{pv.level}</small>
              </h3>
              {kind === 'studio' && <small className="muted">외형 단계 {roomTier(g)}/4</small>}
            </div>
            <Progress value={pv.level} max={BALANCE.equipment.maxLevel} label={`${t.name} 레벨`} />
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
                    <dt>{pv.rateLabel} (현재 자아)</dt>
                    <dd>
                      {fmtRate(pv.rateBefore)} → <b>{fmtRate(pv.rateAfter)}</b>
                    </dd>
                  </div>
                </dl>
                <button type="button" className="btn btn-primary btn-wide" disabled={!can} onClick={() => doBuy(kind)}>
                  {can ? `강화 🪙 ${fmt(pv.cost)}` : `🪙 ${fmt(pv.cost)} 필요 (보유 ${fmt(Math.floor(g.coins))})`}
                </button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
