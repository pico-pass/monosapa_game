import { fmt, fmtDuration } from '../components/format';
import { BALANCE, CAMPAIGN_IDS, SNACK_IDS, THEME_IDS } from '../game/balance';
import { CAMPAIGN_TEXT, SNACK_TEXT, THEME_TEXT } from '../game/content';
import { campaignMult, snackMult } from '../game/selectors';
import { campaignPrice, snackPrice } from '../game/shop';
import { doBuyCampaign, doBuySnack, doBuyTheme, doSetTheme, useUi } from '../store/gameStore';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ShopScreen() {
  const { game: g } = useUi();
  const now = g.lastSettledAt;
  const snack = g.buffs.snack && g.buffs.snack.until > now ? g.buffs.snack : null;
  const campaign = g.buffs.campaign && g.buffs.campaign.until > now ? g.buffs.campaign : null;
  const maxStack = BALANCE.shop.maxStack;

  return (
    <section className="screen" aria-label="상점">
      <h2 className="section-title">상점</h2>
      <p className="muted">가격은 플레이어 레벨이 오를수록 올라가요. 코인은 간식·홍보에, 다이아는 테마에 써요.</p>

      <h3 className="sub-title">🏪 편의점 간식 — 작업하기 라임 보너스</h3>
      {snack && (
        <p className="buff-note" role="status">
          {SNACK_TEXT[snack.id].icon} {SNACK_TEXT[snack.id].name} 효과 중 · 작업하기 라임 ×{snackMult(g).toFixed(1)} · {fmtDuration(snack.until - now)} 남음
        </p>
      )}
      {SNACK_IDS.map((id) => {
        const def = BALANCE.shop.snacks[id];
        const t = SNACK_TEXT[id];
        const price = snackPrice(g, id);
        const stacked = snack?.id === id && snack.until >= now + def.durationMs * maxStack;
        return (
          <div key={id} className="card shop-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name}
              </h3>
              <small className="muted">
                +{pct(def.bonus)} · {def.durationMs / 60_000}분
              </small>
            </div>
            <p className="muted">{t.blurb}</p>
            <button type="button" className="btn btn-primary btn-wide" disabled={g.coins < price || stacked} onClick={() => doBuySnack(id)}>
              {stacked ? '더 쌓을 수 없어요' : snack?.id === id ? `시간 더하기 🪙 ${fmt(price)}` : `사기 🪙 ${fmt(price)}`}
            </button>
          </div>
        );
      })}
      <p className="fineprint">같은 간식을 또 사면 시간이 더해져요(최대 {maxStack}배). 다른 간식을 사면 효과가 바뀌어요.</p>

      <h3 className="sub-title">📢 홍보 캠페인 — 팬 획득 배율</h3>
      {campaign && (
        <p className="buff-note" role="status">
          {CAMPAIGN_TEXT[campaign.id].icon} {CAMPAIGN_TEXT[campaign.id].name} 진행 중 · 팬 획득 ×{campaignMult(g)} · {fmtDuration(campaign.until - now)} 남음
        </p>
      )}
      {CAMPAIGN_IDS.map((id) => {
        const def = BALANCE.shop.campaigns[id];
        const t = CAMPAIGN_TEXT[id];
        const price = campaignPrice(g, id);
        const stacked = campaign?.id === id && campaign.until >= now + def.durationMs * maxStack;
        return (
          <div key={id} className="card shop-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name}
              </h3>
              <small className="muted">
                팬 ×{def.mult} · {def.durationMs >= 3600_000 ? `${def.durationMs / 3600_000}시간` : `${def.durationMs / 60_000}분`}
              </small>
            </div>
            <p className="muted">{t.blurb} 싱글·앨범·모노그램으로 얻는 팬에 적용돼요.</p>
            <button type="button" className="btn btn-primary btn-wide" disabled={g.coins < price || stacked} onClick={() => doBuyCampaign(id)}>
              {stacked ? '더 쌓을 수 없어요' : campaign?.id === id ? `기간 늘리기 🪙 ${fmt(price)}` : `시작하기 🪙 ${fmt(price)}`}
            </button>
          </div>
        );
      })}

      <h3 className="sub-title">🎨 테마 — 모양만 바뀌어요</h3>
      <div className="theme-grid">
        {THEME_IDS.map((id) => {
          const t = THEME_TEXT[id];
          const owned = g.cosmetics.themes.includes(id);
          const active = g.cosmetics.theme === id;
          const price = BALANCE.shop.themes[id];
          return (
            <div key={id} className={`card theme-card${active ? ' theme-on' : ''}`}>
              <span className={`theme-swatch swatch-${id}`} aria-hidden>
                {t.icon}
              </span>
              <strong>{t.name}</strong>
              <small className="muted">{t.blurb}</small>
              {owned ? (
                <button type="button" className="btn btn-ghost" disabled={active} onClick={() => doSetTheme(id)}>
                  {active ? '적용 중' : '적용하기'}
                </button>
              ) : (
                <button type="button" className="btn btn-accent" disabled={g.diamonds < price} onClick={() => doBuyTheme(id)}>
                  💎 {price}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
