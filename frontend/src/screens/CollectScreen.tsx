import { useCallback, useEffect, useState } from 'react';
import { PersonaBadge, Progress } from '../components/parts';
import { fmt, fmtCountdown, fmtDuration } from '../components/format';
import { BALANCE, FEAT_NPCS, PHOTO_CARD_IDS, PHOTO_GRADES, PHOTO_SETS, photoCardId } from '../game/balance';
import { FEAT_TEXT, MASCOT_TEXT, MOOD_TEXT, PERSONA_TEXT, PHOTO_GRADE_NAMES, PHOTO_SET_TEXT, VIBE_TEXT, photoCardName } from '../game/content';
import { feedCost, mascotView } from '../game/mascot';
import { bonuses, featPassive, parsePhotoId, pickupOf, remasterCost, songCardOf } from '../game/packdata';
import { pullsToPity } from '../game/photocards';
import { playerLevel } from '../game/selectors';
import { nextRemasterCost } from '../game/songcards';
import type { Persona } from '../game/types';
import { api, errorText } from '../platform/api';
import {
  doAcceptTrade,
  doBuyTickets,
  doCancelTrade,
  doClaimPresent,
  doCollectTrade,
  doCraft,
  doDismantle,
  doFeatPull,
  doFeedMascot,
  doGiftMascot,
  doPhotoPull,
  doPlayMascot,
  doPostTrade,
  doRemaster,
  doToggleDeck,
  doToggleFeat,
  useUi,
} from '../store/gameStore';

type Sub = 'cards' | 'photo' | 'feat' | 'mascot';
const SUBS: { id: Sub; label: string }[] = [
  { id: 'cards', label: '곡 카드' },
  { id: 'photo', label: '포토카드' },
  { id: 'feat', label: '피처링' },
  { id: 'mascot', label: '마스코트' },
];

const pct = (x: number) => `${(x * 100).toFixed(x * 100 >= 10 ? 0 : 1)}%`;

export function CollectScreen() {
  const [sub, setSub] = useState<Sub>('cards');
  return (
    <section className="screen" aria-label="수집">
      <h2 className="section-title">수집</h2>
      <BonusSummary />
      <div className="seg" role="group" aria-label="수집 종류">
        {SUBS.map((s) => (
          <button key={s.id} type="button" aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'cards' && <CardsTab />}
      {sub === 'photo' && <PhotoTab />}
      {sub === 'feat' && <FeatTab />}
      {sub === 'mascot' && <MascotTab />}
    </section>
  );
}

/** 모든 수집품이 지금 주는 영구 보너스 합계 */
function BonusSummary() {
  const { game: g } = useUi();
  const b = bonuses(g);
  const items: [string, string][] = [
    ['✍️ 일반 라임', pct(b.rhyme.normal)],
    ['✍️ 어둠 라임', pct(b.rhyme.dark)],
    ['🪙 인세', pct(b.coin)],
    ['👥 팬 획득', pct(b.fan)],
    ['⚡ 전투력', pct(b.power)],
  ];
  return (
    <div className="card collect-bonus">
      <div className="bonus-grid">
        {items.map(([k, v]) => (
          <div key={k}>
            <small className="muted">{k}</small>
            <strong>+{v}</strong>
          </div>
        ))}
      </div>
      {b.offlineMs > 0 && <small className="muted">오프라인 정산 +{fmtDuration(b.offlineMs)}</small>}
    </div>
  );
}

/* ---------- 곡 카드 ---------- */

export function CardsTab() {
  const { game: g } = useUi();
  const cards = [...g.singles].reverse().map((x) => songCardOf(g.cards, x));
  const slots = BALANCE.cards.deckSlots;
  return (
    <>
      <p className="muted">
        발매한 싱글이 카드가 돼요. 덱 {slots}장의 보너스가 합쳐져요. 라임 보너스는 그 곡을 낸 자아에만 붙어요. 덱 {g.cards.deck.length}/{slots}
      </p>
      {cards.length === 0 && <p className="empty">아직 카드가 없어요 — 싱글을 발매하면 곡마다 카드가 생겨요.</p>}
      {cards.map((c) => {
        const inDeck = g.cards.deck.includes(c.id);
        const cost = nextRemasterCost(g, c.id);
        const v = VIBE_TEXT[c.vibe];
        return (
          <div key={c.id} className={`card song-card rar-${c.rarity}${inDeck ? ' song-card-on' : ''}`}>
            <div className="card-row">
              <h3>
                <span className={`rar rar-${c.rarity}`}>{c.rarity}</span> 「{c.title}」
              </h3>
              <PersonaBadge persona={c.persona} />
            </div>
            <div className="card-row">
              <small className="muted">
                {v.icon} {v.desc} +{pct(c.bonus)}
                {c.remaster > 0 && ` · 리마스터 Lv.${c.remaster}`}
              </small>
              <span className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={() => doToggleDeck(c.id)}>
                  {inDeck ? '덱에서 빼기' : '덱에 넣기'}
                </button>
                <button type="button" className="btn btn-primary" disabled={cost === null || g.coins < cost} onClick={() => doRemaster(c.id)}>
                  {cost === null ? '리마스터 최대' : `리마스터 🪙 ${fmt(cost)}`}
                </button>
              </span>
            </div>
          </div>
        );
      })}
      {cards.length > 0 && (
        <p className="fineprint">
          리마스터는 레벨당 보너스 +{Math.round(BALANCE.cards.remasterBonus * 100)}% (최대 Lv.{BALANCE.cards.remasterMax}). 비용 예: {cards[0].rarity} 첫 단계 🪙 {fmt(remasterCost(cards[0].rarity, 0))}
        </p>
      )}
    </>
  );
}

/* ---------- 포토카드 ---------- */

export function PhotoTab() {
  const { game: g } = useUi();
  const [sel, setSel] = useState<string | null>(null);
  const p = g.photo;
  const selInfo = sel ? parsePhotoId(sel) : null;
  const count = sel ? (p.owned[sel] ?? 0) : 0;
  const rates = BALANCE.photo.rates;
  return (
    <>
      <div className="card">
        <div className="card-row">
          <strong>🎟️ 티켓 {p.tickets}장</strong>
          <small className="muted">
            천장까지 {pullsToPity(g)}회 · 조각 {fmt(p.shards)}
          </small>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={p.tickets < 1} onClick={() => doPhotoPull(1)}>
            1회 뽑기
          </button>
          <button type="button" className="btn btn-primary" disabled={p.tickets < 10} onClick={() => doPhotoPull(10)}>
            10회 뽑기
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" disabled={g.diamonds < BALANCE.photo.ticketDiamonds} onClick={() => doBuyTickets(1)}>
            티켓 1장 💎 {BALANCE.photo.ticketDiamonds}
          </button>
          <button type="button" className="btn btn-ghost" disabled={g.diamonds < BALANCE.photo.ticketDiamonds * 10} onClick={() => doBuyTickets(10)}>
            티켓 10장 💎 {BALANCE.photo.ticketDiamonds * 10}
          </button>
        </div>
        <p className="fineprint">
          티켓은 싱글(+{BALANCE.photo.tickets.single})·앨범(+{BALANCE.photo.tickets.album})·공연 첫 클리어(+{BALANCE.photo.tickets.firstClear})로 얻어요. 등급 확률{' '}
          {rates.map((r, i) => `${PHOTO_GRADE_NAMES[i]} ${(r * 100).toFixed(r < 0.01 ? 1 : 0)}%`).join(' · ')}. {BALANCE.photo.pityAt}회 안에 {PHOTO_GRADE_NAMES[BALANCE.photo.pityGrade - 1]} 이상이 확정이에요.
        </p>
      </div>

      {Array.from({ length: PHOTO_SETS }, (_, i) => i + 1).map((set) => {
        const have = Array.from({ length: PHOTO_GRADES }, (_, j) => (p.owned[photoCardId(set, j + 1)] ?? 0) > 0).filter(Boolean).length;
        const t = PHOTO_SET_TEXT[set - 1];
        return (
          <div key={set} className="card pk-set">
            <div className="card-row">
              <h3>
                {t.icon} {t.name}
              </h3>
              <small className="muted">
                {have}/{PHOTO_GRADES} · {t.bonus}
                {p.claimedSets.includes(set) ? ' ✅' : ''}
              </small>
            </div>
            <div className="pk-row">
              {Array.from({ length: PHOTO_GRADES }, (_, j) => {
                const id = photoCardId(set, j + 1);
                const n = p.owned[id] ?? 0;
                return (
                  <button key={id} type="button" className={`pk-cell pk-g${j + 1}${n > 0 ? ' pk-own' : ''}${sel === id ? ' pk-sel' : ''}`} aria-label={`${photoCardName(set, j + 1)} ${n > 0 ? `${n}장` : '없음'}`} onClick={() => setSel(id)}>
                    <span aria-hidden>{n > 0 ? '🃏' : '？'}</span>
                    {n > 1 && <i>×{n}</i>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {sel && selInfo && (
        <div className="card">
          <div className="card-row">
            <h3>{photoCardName(selInfo.set, selInfo.grade)}</h3>
            <span className={`pk-grade pk-g${selInfo.grade}`}>{PHOTO_GRADE_NAMES[selInfo.grade - 1]}</span>
          </div>
          <small className="muted">{count > 0 ? `${count}장 가지고 있어요.` : '아직 없는 카드예요.'}</small>
          <div className="btn-row">
            {count >= 2 && (
              <button type="button" className="btn btn-ghost" onClick={() => doDismantle(sel)}>
                중복 분해 🔹 +{BALANCE.photo.shardValue[selInfo.grade - 1]}
              </button>
            )}
            {count === 0 && (
              <button type="button" className="btn btn-primary" disabled={p.shards < BALANCE.photo.craftCost[selInfo.grade - 1]} onClick={() => doCraft(sel)}>
                조각으로 만들기 🔹 {BALANCE.photo.craftCost[selInfo.grade - 1]}
              </button>
            )}
          </div>
        </div>
      )}
      <TradePanel />
    </>
  );
}

interface TradeRow {
  id: string;
  give: string;
  want: string;
  status: 'open' | 'taken';
  owner: string;
  mine: boolean;
}

const cardLabel = (id: string): string => {
  const x = parsePhotoId(id);
  return x ? `${photoCardName(x.set, x.grade)} (${PHOTO_GRADE_NAMES[x.grade - 1]})` : id;
};

/** 교환소: 내 중복 카드를 맡기고 원하는 카드를 적어 두면, 그 카드의 중복을 가진 사람이 바꿔 가요. */
export function TradePanel() {
  const { game: g } = useUi();
  const [data, setData] = useState<{ open: TradeRow[]; mine: TradeRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dups = PHOTO_CARD_IDS.filter((id) => (g.photo.owned[id] ?? 0) >= 2);
  const [give, setGive] = useState('');
  const [want, setWant] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<{ open: TradeRow[]; mine: TradeRow[] }>('trades'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    await fn();
    await load();
    setBusy(false);
  };

  const giveId = dups.includes(give) ? give : (dups[0] ?? '');
  const wantId = want || PHOTO_CARD_IDS.find((id) => (g.photo.owned[id] ?? 0) === 0) || PHOTO_CARD_IDS[0];

  return (
    <div className="card">
      <div className="card-row">
        <h3>🔁 교환소</h3>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          새로고침
        </button>
      </div>
      <p className="muted">중복으로 가진 카드를 맡기고 받고 싶은 카드를 적어 두세요. 그 카드의 중복을 가진 사람이 가져가면 서로 바뀌어요.</p>
      {error && <p className="muted" role="alert">{error}</p>}

      <div className="pk-trade-form">
        <label>
          <small className="muted">내놓을 카드(중복)</small>
          <select value={giveId} onChange={(e) => setGive(e.target.value)} disabled={dups.length === 0}>
            {dups.length === 0 && <option value="">중복 카드가 없어요</option>}
            {dups.map((id) => (
              <option key={id} value={id}>
                {cardLabel(id)} ×{g.photo.owned[id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <small className="muted">받고 싶은 카드</small>
          <select value={wantId} onChange={(e) => setWant(e.target.value)}>
            {PHOTO_CARD_IDS.map((id) => (
              <option key={id} value={id}>
                {cardLabel(id)}
                {(g.photo.owned[id] ?? 0) > 0 ? ' · 보유' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || !giveId || giveId === wantId} onClick={() => void run(() => doPostTrade(giveId, wantId))}>
          교환 올리기
        </button>
      </div>

      {data && data.mine.length > 0 && <h4 className="sub-title">내가 올린 교환</h4>}
      {data?.mine.map((t) => (
        <div key={t.id} className="pk-trade">
          <span>
            {cardLabel(t.give)} → {cardLabel(t.want)}
          </span>
          {t.status === 'taken' ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => doCollectTrade(t.id))}>
              받기
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => doCancelTrade(t.id))}>
              거두기
            </button>
          )}
        </div>
      ))}

      {data && <h4 className="sub-title">다른 사람의 교환</h4>}
      {data && data.open.length === 0 && <p className="empty">열려 있는 교환이 없어요.</p>}
      {data?.open.map((t) => {
        const canPay = (g.photo.owned[t.want] ?? 0) >= 2;
        return (
          <div key={t.id} className="pk-trade">
            <span>
              <b>{t.owner}</b> · {cardLabel(t.give)} → {cardLabel(t.want)}
            </span>
            <button type="button" className="btn btn-primary" disabled={busy || !canPay} onClick={() => void run(() => doAcceptTrade(t.id, t.give, t.want))}>
              {canPay ? '바꾸기' : '내 중복 없음'}
            </button>
          </div>
        );
      })}
      <p className="fineprint">서버는 카드를 가졌는지 확인하지 않아요. 가진 카드만 올려 주세요.</p>
    </div>
  );
}

/* ---------- 피처링 ---------- */

export function FeatTab() {
  const { game: g } = useUi();
  const f = g.feat;
  const pickup = pickupOf(g.lastSettledAt);
  const F = BALANCE.feat;
  return (
    <>
      <div className="card">
        <div className="card-row">
          <strong>🎤 이번 주 픽업: {FEAT_TEXT[pickup.id].icon} {FEAT_TEXT[pickup.id].name}</strong>
          <small className="muted">
            천장까지 {F.pityAt - f.pity}회{f.guaranteed ? ' · 다음 SSR은 픽업 확정' : ''}
          </small>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={g.diamonds < F.pullCost} onClick={() => doFeatPull(1)}>
            1회 💎 {F.pullCost}
          </button>
          <button type="button" className="btn btn-primary" disabled={g.diamonds < F.tenCost} onClick={() => doFeatPull(10)}>
            10회 💎 {F.tenCost}
          </button>
        </div>
        <p className="fineprint">
          SSR {F.rates.SSR * 100}% · SR {F.rates.SR * 100}% · SSR은 픽업이 {F.pickupRate * 100}%, 빗나가면 다음 SSR은 픽업 확정. 10회의 마지막은 SR 이상. 같은 래퍼가 또 나오면 별이 올라요(최대 {F.maxStar}).
        </p>
      </div>
      <p className="muted">장착한 래퍼 {f.slots.length}/{F.slots}명의 패시브가 붙어요.</p>
      {FEAT_NPCS.map((def) => {
        const stars = f.owned[def.id] ?? 0;
        const t = FEAT_TEXT[def.id];
        const v = VIBE_TEXT[def.vibe];
        const on = f.slots.includes(def.id);
        return (
          <div key={def.id} className={`card feat-card rar-${def.rarity}${stars === 0 ? ' feat-locked' : ''}${on ? ' song-card-on' : ''}`}>
            <div className="card-row">
              <h3>
                <span className={`rar rar-${def.rarity}`}>{def.rarity}</span> {stars > 0 ? `${t.icon} ${t.name}` : '？？？'}
              </h3>
              <small className="muted">{stars > 0 ? '★'.repeat(stars) + '☆'.repeat(F.maxStar - stars) : '미계약'}</small>
            </div>
            <small className="muted">{stars > 0 ? t.blurb : '뽑기로 만날 수 있어요.'}</small>
            <div className="card-row">
              <small className="muted">
                {v.icon} {v.desc} +{pct(featPassive(def, Math.max(1, stars)))}
              </small>
              {stars > 0 && (
                <button type="button" className="btn btn-ghost" onClick={() => doToggleFeat(def.id)}>
                  {on ? '해제' : '장착'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ---------- 마스코트 ---------- */

export function MascotTab() {
  return (
    <>
      <p className="muted">간식을 주고 놀아 주면 자라요. 자라면 그 자아의 라임 생산이 늘어요. 배고픈 채로 오래 두면 삐져서 보너스가 사라져요.</p>
      <MascotCard persona="normal" />
      <MascotCard persona="dark" />
    </>
  );
}

function MascotCard({ persona }: { persona: Persona }) {
  const { game: g } = useUi();
  const v = mascotView(g, persona);
  const t = MASCOT_TEXT[persona];
  const mood = MOOD_TEXT[v.mood];
  const level = playerLevel(g.fans);
  const cost = feedCost(level);
  const base = BALANCE.mascot.stageXp[v.stage];
  return (
    <div className={`card mascot mascot-${v.mood}`}>
      <div className="card-row">
        <h3>
          <span className="mascot-face" aria-hidden>
            {t.icons[v.stage]}
          </span>{' '}
          {t.stages[v.stage]}
        </h3>
        <PersonaBadge persona={persona} />
      </div>
      <small className="muted">
        {PERSONA_TEXT[persona].short} 라임 +{pct(v.bonus)} · {mood.name} — {mood.line}
      </small>
      <Progress value={v.nextXp === null ? 1 : v.mascot.xp - base} max={v.nextXp === null ? 1 : v.nextXp - base} label={`${t.name} 성장`} />
      <small className="fineprint">{v.nextXp === null ? '전설 단계예요.' : `다음 단계까지 ${v.nextXp - v.mascot.xp} xp`}</small>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={g.coins < cost} onClick={() => doFeedMascot(persona)}>
          간식 🪙 {fmt(cost)}
        </button>
        <button type="button" className="btn btn-ghost" disabled={v.playWaitMs > 0} onClick={() => doPlayMascot(persona)}>
          {v.playWaitMs > 0 ? `놀기 ${fmtCountdown(v.playWaitMs)}` : '놀아주기'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={g.diamonds < BALANCE.mascot.gift.diamonds} onClick={() => doGiftMascot(persona)}>
          선물 💎 {BALANCE.mascot.gift.diamonds}
        </button>
      </div>
      {v.stage >= 1 && (
        <button type="button" className="btn btn-accent btn-wide" disabled={!v.giftReady} onClick={() => doClaimPresent(persona)}>
          {v.giftReady ? '🎁 선물 받기' : v.mood !== 'happy' ? '배부를 때만 선물을 가져와요' : `선물까지 ${fmtCountdown(v.giftWaitMs)}`}
        </button>
      )}
    </div>
  );
}
