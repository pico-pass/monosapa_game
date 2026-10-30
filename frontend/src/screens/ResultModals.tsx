import { Modal } from '../components/Modal';
import { fmt } from '../components/format';
import { FEAT_TEXT, PERSONA_TEXT, PHOTO_GRADE_NAMES, PHOTO_SET_TEXT, photoCardName } from '../game/content';
import { closeGacha, closeTowerResult, useUi } from '../store/gameStore';

/** 가챠 결과 창 (포토카드·피처링) */
export function GachaModal() {
  const { gachaResult: r } = useUi();
  if (!r) return null;
  if (r.kind === 'photo') {
    return (
      <Modal title={`포토카드 ${r.results.length}장`} onClose={closeGacha} tone="gold">
        <ul className="gacha-list">
          {r.results.map((x, i) => (
            <li key={i} className={`gacha-item pk-g${x.grade}`}>
              <span className={`pk-grade pk-g${x.grade}`}>{PHOTO_GRADE_NAMES[x.grade - 1]}</span>
              <span>{photoCardName(x.set, x.grade)}</span>
              <small>{x.isNew ? 'NEW' : '중복'}{x.pity ? ' · 천장' : ''}</small>
            </li>
          ))}
        </ul>
        {r.sets.length > 0 && (
          <p>
            🗂️ 세트 완성: {r.sets.map((s) => PHOTO_SET_TEXT[s - 1].name).join(', ')} · 💎 +{r.diamonds}
          </p>
        )}
        <p className="fineprint">중복 카드는 분해해서 조각으로 만들거나 교환소에 올릴 수 있어요.</p>
      </Modal>
    );
  }
  return (
    <Modal title={`피처링 ${r.results.length}회`} onClose={closeGacha} tone="gold">
      <ul className="gacha-list">
        {r.results.map((x, i) => (
          <li key={i} className={`gacha-item rar-${x.rarity}`}>
            <span className={`rar rar-${x.rarity}`}>{x.rarity}</span>
            <span>
              {FEAT_TEXT[x.id].icon} {FEAT_TEXT[x.id].name}
            </span>
            <small>{x.isNew ? 'NEW' : x.starUp ? '별 +1' : `환급 💎 ${x.refund}`}{x.pickup ? ' · 픽업' : ''}</small>
          </li>
        ))}
      </ul>
      {r.refund > 0 && <p>별이 가득 찬 래퍼는 💎 {r.refund}로 환급됐어요.</p>}
    </Modal>
  );
}

/** 무한의 계단 도전 결과 창 */
export function TowerModal() {
  const { towerResult: r } = useUi();
  if (!r) return null;
  return (
    <Modal title={r.win ? `${r.floor}층 돌파!` : `${r.floor}층에서 쓰러졌어요`} onClose={closeTowerResult} tone={r.win ? 'gold' : 'normal'}>
      <p>
        {r.enemy.boss ? '보스 ' : ''}적 전투력 <b>{fmt(Math.round(r.enemy.power))}</b> vs 내 전투력 <b>{fmt(Math.round(r.power))}</b> (운 ×{r.roll.toFixed(2)})
      </p>
      <small className="muted">이 층의 약점은 {PERSONA_TEXT[r.enemy.weak].short}이었어요.</small>
      {r.win ? (
        <ul className="reward-list">
          {r.first ? (
            <>
              <li>
                🪙 코인 <b>+{fmt(r.coins)}</b>
              </li>
              {r.diamonds > 0 && (
                <li>
                  💎 다이아 <b>+{r.diamonds}</b>
                </li>
              )}
            </>
          ) : (
            <li>이번 주에 이미 깬 층이라 보상은 없어요.</li>
          )}
          {r.newBest && <li>🎉 새 최고 기록이에요!</li>}
        </ul>
      ) : (
        <p className="muted">잠시 쉬었다가 다시 도전해요. 약점 자아로 도전하면 유리해요.</p>
      )}
    </Modal>
  );
}
