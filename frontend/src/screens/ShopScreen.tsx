import { fmt, fmtDuration } from '../components/format';
import { Progress } from '../components/parts';
import { ASSETS } from '../assets';
import { BALANCE, CAMPAIGN_IDS, COSTUME_IDS_OF, GOODS_IDS, ITEM_IDS, SNACK_IDS, THEME_IDS } from '../game/balance';
import { CAMPAIGN_TEXT, COSTUME_TEXT, GOODS_TEXT, ITEM_TEXT, MEAL_TEXT, PACK_TEXT, PERSONA_TEXT, RECEIPT_TEXT, SNACK_TEXT, THEME_TEXT } from '../game/content';
import { campaignMult, maxRoyaltyPerSec, offlineCapMs, snackMult, wornCostume } from '../game/selectors';
import { campaignPrice, goodsPrice, itemPrice, mealPrice, packPrice, packsLeft, receiptPrice, snackPrice } from '../game/shop';
import type { GameState, Persona } from '../game/types';
import { doBuyCampaign, doBuyCostume, doBuyGoods, doBuyItem, doBuyMeal, doBuyPack, doBuyReceipt, doBuySnack, doBuyTheme, doRedeemCoupon, doSetCostume, doSetTheme, useUi } from '../store/gameStore';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ShopScreen() {
  const { game: g } = useUi();
  const now = g.lastSettledAt;
  const snack = g.buffs.snack && g.buffs.snack.until > now ? g.buffs.snack : null;
  const campaign = g.buffs.campaign && g.buffs.campaign.until > now ? g.buffs.campaign : null;
  const item = g.buffs.item && g.buffs.item.until > now ? g.buffs.item : null;
  const goods = g.buffs.goods && g.buffs.goods.until > now ? g.buffs.goods : null;
  const maxStack = BALANCE.shop.maxStack;

  return (
    <section className="screen" aria-label="상점">
      <h2 className="section-title">상점</h2>
      <p className="muted">가격은 플레이어 레벨이 오를수록 올라가요. 코인은 간식·홍보에, 다이아는 테마·코스튬에 써요.</p>

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

      <h3 className="sub-title">🛒 편의점 상품 — 특수 부스트</h3>
      {item && (
        <p className="buff-note" role="status">
          {ITEM_TEXT[item.id].icon} {ITEM_TEXT[item.id].name} 효과 중 · {ITEM_TEXT[item.id].effect(BALANCE.shop.items[item.id].bonus)} · {fmtDuration(item.until - now)} 남음
        </p>
      )}
      {ITEM_IDS.map((id) => {
        const def = BALANCE.shop.items[id];
        const t = ITEM_TEXT[id];
        const price = itemPrice(g, id);
        const stacked = item?.id === id && item.until >= now + def.durationMs * maxStack;
        return (
          <div key={id} className="card shop-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name}
              </h3>
              <small className="muted">{def.durationMs / 60_000}분</small>
            </div>
            <p className="muted">{t.blurb}</p>
            <p>
              <b>{t.effect(def.bonus)}</b>
            </p>
            <button type="button" className="btn btn-primary btn-wide" disabled={g.coins < price || stacked} onClick={() => doBuyItem(id)}>
              {stacked ? '더 쌓을 수 없어요' : item?.id === id ? `시간 더하기 🪙 ${fmt(price)}` : `사기 🪙 ${fmt(price)}`}
            </button>
          </div>
        );
      })}
      <p className="fineprint">초코바와 야식은 인세에 따라 가격이 올라가요. 상품은 간식·홍보 캠페인과 따로 켜져요. 같은 상품을 또 사면 시간이 더해지고(최대 {maxStack}배), 다른 상품을 사면 효과가 바뀌어요.</p>

      <h3 className="sub-title">🧰 편의점 생활용품 — 두 번째 부스트</h3>
      {goods && (
        <p className="buff-note" role="status">
          {GOODS_TEXT[goods.id].icon} {GOODS_TEXT[goods.id].name} 효과 중 · {GOODS_TEXT[goods.id].effect(BALANCE.shop.goods[goods.id].bonus)} · {fmtDuration(goods.until - now)} 남음
        </p>
      )}
      {GOODS_IDS.map((id) => {
        const def = BALANCE.shop.goods[id];
        const t = GOODS_TEXT[id];
        const price = goodsPrice(g, id);
        const stacked = goods?.id === id && goods.until >= now + def.durationMs * maxStack;
        return (
          <div key={id} className="card shop-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name}
              </h3>
              <small className="muted">{def.durationMs / 60_000}분</small>
            </div>
            <p className="muted">{t.blurb}</p>
            <p>
              <b>{t.effect(def.bonus)}</b>
            </p>
            <button type="button" className="btn btn-primary btn-wide" disabled={g.coins < price || stacked} onClick={() => doBuyGoods(id)}>
              {stacked ? '더 쌓을 수 없어요' : goods?.id === id ? `시간 더하기 🪙 ${fmt(price)}` : `사기 🪙 ${fmt(price)}`}
            </button>
          </div>
        );
      })}
      <p className="fineprint">생활용품은 간식·상품·홍보 캠페인과 따로 켜져요. 가격은 인세·스트리밍 수입에 따라 올라가요. 같은 용품을 또 사면 시간이 더해지고(최대 {maxStack}배), 다른 용품을 사면 효과가 바뀌어요.</p>

      <h3 className="sub-title">{RECEIPT_TEXT.icon} 할인 영수증 — 장비를 살 때</h3>
      <div className="card shop-card">
        <div className="card-row">
          <h3>
            <span aria-hidden>{RECEIPT_TEXT.icon}</span> {RECEIPT_TEXT.name}
          </h3>
          <small className="muted">
            가진 수 {g.mart.receipts} / {BALANCE.shop.receipt.max}
          </small>
        </div>
        <p className="muted">{RECEIPT_TEXT.blurb}</p>
        <p>
          <b>다음 장비 구매 한 번에 −{pct(BALANCE.shop.receipt.rate)} (최대 🪙 {fmt(Math.floor(maxRoyaltyPerSec(g) * BALANCE.shop.receipt.capSecs))} 할인)</b>
        </p>
        <small className="muted">마이크·스튜디오·홍보 장비를 살 때 자동으로 한 장이 쓰여요. 싼 장비에는 이득이 작으니 비싼 장비 앞에서 아껴 둬요.</small>
        <button type="button" className="btn btn-primary btn-wide" disabled={g.coins < receiptPrice(g) || g.mart.receipts >= BALANCE.shop.receipt.max} onClick={() => doBuyReceipt()}>
          {g.mart.receipts >= BALANCE.shop.receipt.max ? '더 챙길 수 없어요' : `사기 🪙 ${fmt(receiptPrice(g))}`}
        </button>
      </div>

      <h3 className="sub-title">{PACK_TEXT.icon} 카드팩 — 포토카드 티켓</h3>
      <div className="card shop-card">
        <div className="card-row">
          <h3>
            <span aria-hidden>{PACK_TEXT.icon}</span> {PACK_TEXT.name}
          </h3>
          <small className="muted">
            오늘 {packsLeft(g)} / {BALANCE.shop.pack.perDay}장 남음
          </small>
        </div>
        <p className="muted">{PACK_TEXT.blurb}</p>
        <p>
          <b>포토카드 티켓 1장 (수집 탭에서 뽑아요)</b>
        </p>
        <small className="muted">하루에 {BALANCE.shop.pack.perDay}장까지 살 수 있어요. 다이아로 사는 티켓과 같은 티켓이에요. 가진 티켓 {g.photo.tickets}장.</small>
        <button type="button" className="btn btn-primary btn-wide" disabled={g.coins < packPrice(g) || packsLeft(g) <= 0} onClick={() => doBuyPack()}>
          {packsLeft(g) <= 0 ? '오늘은 모두 샀어요' : `사기 🪙 ${fmt(packPrice(g))}`}
        </button>
      </div>

      <h3 className="sub-title">{MEAL_TEXT.icon} 야식 컵라면 세트 — 오래 자리를 비울 때</h3>
      <div className="card shop-card">
        <div className="card-row">
          <h3>
            <span aria-hidden>{MEAL_TEXT.icon}</span> {MEAL_TEXT.name}
          </h3>
          <small className="muted">
            가진 수 {g.mart.nightMeals} / {BALANCE.shop.meal.max}
          </small>
        </div>
        <p className="muted">{MEAL_TEXT.blurb}</p>
        <p>
          <b>자리 비운 시간이 기본 상한({fmt(offlineCapMs(g) / 3600_000)}시간)을 넘으면 정산 상한 +{BALANCE.shop.meal.extraMs / 3600_000}시간</b>
        </p>
        <small className="muted">상한을 넘겼을 때 하나씩만 쓰여요. 상한 안에서 돌아오면 아껴 둬요.</small>
        <button type="button" className="btn btn-primary btn-wide" disabled={g.coins < mealPrice(g) || g.mart.nightMeals >= BALANCE.shop.meal.max} onClick={() => doBuyMeal()}>
          {g.mart.nightMeals >= BALANCE.shop.meal.max ? '더 챙길 수 없어요' : `사기 🪙 ${fmt(mealPrice(g))}`}
        </button>
      </div>

      <h3 className="sub-title">🏷️ 편의점 멤버십</h3>
      <div className="card shop-card">
        <div className="card-row">
          <h3>스탬프</h3>
          <small className="muted">
            {g.mart.stamps} / {BALANCE.shop.stamps.goal}
          </small>
        </div>
        <Progress value={g.mart.stamps} max={BALANCE.shop.stamps.goal} label="멤버십 스탬프" />
        <p className="muted">간식·상품·생활용품·야식·영수증·카드팩을 살 때마다 스탬프가 하나씩 쌓여요. {BALANCE.shop.stamps.goal}개를 모으면 무료 간식 쿠폰이 나와요.</p>
        {g.mart.coupon ? (
          <>
            <p role="status">
              🎁 무료 쿠폰 — {SNACK_TEXT[g.mart.coupon].icon} <b>{SNACK_TEXT[g.mart.coupon].name}</b> (+{pct(BALANCE.shop.snacks[g.mart.coupon].bonus)} · {BALANCE.shop.snacks[g.mart.coupon].durationMs / 60_000}분)
            </p>
            <button
              type="button"
              className="btn btn-accent btn-wide"
              disabled={snack?.id === g.mart.coupon && snack.until >= now + BALANCE.shop.snacks[g.mart.coupon].durationMs * maxStack}
              onClick={() => doRedeemCoupon()}
            >
              쿠폰 쓰기
            </button>
            <small className="muted">쓰면 지금 켜진 간식이 이 간식으로 바뀌어요. 쿠폰은 모아 둘 수 없어서, 쓰기 전에는 스탬프가 {BALANCE.shop.stamps.goal}개에서 멈춰요.</small>
          </>
        ) : (
          <small className="muted">쿠폰은 어떤 간식이 나올지 뽑혀서 나와요.</small>
        )}
      </div>

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

      <h3 className="sub-title">👗 코스튬 — 모양만 바뀌어요</h3>
      <p className="muted">일반속성과 어둠속성이 따로 입어요. 작업실에서 그 속성일 때 입은 옷이 보여요. 산 코스튬은 프로필 사진으로도 쓸 수 있어요(더보기 → 친구 → 프로필 설정).</p>
      <CostumeGrid g={g} persona="normal" />
      <CostumeGrid g={g} persona="dark" />
    </section>
  );
}

/** 한 자아의 코스튬 목록: 기본 옷 + 파는 옷 */
function CostumeGrid({ g, persona }: { g: GameState; persona: Persona }) {
  const worn = wornCostume(g, persona);
  return (
    <>
      <h4 className="sub-title">{PERSONA_TEXT[persona].name}</h4>
      <div className="theme-grid" role="group" aria-label={`${PERSONA_TEXT[persona].short}속성 코스튬`}>
        <div className={`card theme-card${worn === null ? ' theme-on' : ''}`}>
          <img className="costume-thumb" src={ASSETS.characters[persona] ?? undefined} alt="" loading="lazy" />
          <strong>기본 옷</strong>
          <small className="muted">처음 모습 그대로.</small>
          <button type="button" className="btn btn-ghost" disabled={worn === null} onClick={() => doSetCostume(persona, null)}>
            {worn === null ? '입는 중' : '입기'}
          </button>
        </div>
        {COSTUME_IDS_OF[persona].map((id) => {
          const t = COSTUME_TEXT[id];
          const owned = g.cosmetics.costumes.includes(id);
          const active = worn === id;
          const price = BALANCE.shop.costumes[id];
          return (
            <div key={id} className={`card theme-card${active ? ' theme-on' : ''}`}>
              <img className="costume-thumb" src={ASSETS.costumes[id]} alt="" loading="lazy" />
              <strong>
                <span aria-hidden>{t.icon}</span> {t.name}
              </strong>
              <small className="muted">{t.blurb}</small>
              {owned ? (
                <button type="button" className="btn btn-ghost" disabled={active} onClick={() => doSetCostume(persona, id)}>
                  {active ? '입는 중' : '입기'}
                </button>
              ) : (
                <button type="button" className="btn btn-accent" disabled={g.diamonds < price} onClick={() => doBuyCostume(id)}>
                  💎 {price}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
