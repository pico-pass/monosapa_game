import { fmt, fmtDuration } from '../components/format';
import { Progress } from '../components/parts';
import { BALANCE, POST_KINDS } from '../game/balance';
import { CAMPAIGN_TEXT, POST_TEXT } from '../game/content';
import { nextSlotCost, postBaseFans, postStatuses } from '../game/monogram';
import { campaignMult } from '../game/selectors';
import { doBuySlot, doCollectPost, doStartPost, useUi } from '../store/gameStore';

const OUTCOME_TEXT = { normal: '', viral: ' 🔥 바이럴!', hate: ' 💢 악플' } as const;

export function MonogramScreen() {
  const { game: g } = useUi();
  const posts = postStatuses(g);
  const slotCost = nextSlotCost(g);
  const free = g.monogram.slots - posts.length;
  const mult = campaignMult(g);
  const camp = g.buffs.campaign && g.buffs.campaign.until > g.lastSettledAt ? g.buffs.campaign : null;
  const G = BALANCE.monogram;

  return (
    <section className="screen" aria-label="모노그램">
      <h2 className="section-title">모노그램</h2>
      <p className="muted">
        게시물을 올려 두면 시간이 지난 뒤 팬이 모여요. 결과는 보통이 대부분이지만 가끔 바이럴(팬 ×{G.viralMult} + 다이아)이나 악플(팬 ×{G.hateMult})이 터져요.
      </p>
      {camp && (
        <p className="buff-note" role="status">
          {CAMPAIGN_TEXT[camp.id].icon} {CAMPAIGN_TEXT[camp.id].name} 진행 중 — 모이는 팬 ×{mult}
        </p>
      )}

      <div className="card">
        <div className="card-row">
          <h3>
            📸 게시물 슬롯 {posts.length} / {g.monogram.slots}
          </h3>
          {slotCost !== null && (
            <button type="button" className="btn btn-ghost" disabled={g.diamonds < slotCost} onClick={doBuySlot}>
              슬롯 늘리기 💎 {slotCost}
            </button>
          )}
        </div>
        {posts.length === 0 && <p className="muted">올려 둔 게시물이 없어요.</p>}
        <ul className="post-list">
          {posts.map((p) => {
            const t = POST_TEXT[p.post.kind];
            const total = G.kinds[p.post.kind].durationMs;
            return (
              <li key={p.post.id} className="post-row">
                <div className="mission-head">
                  <span>
                    {t.icon} {t.name}
                  </span>
                  <small className="muted">{p.ready ? '완료!' : `${fmtDuration(p.remainingMs)} 남음`}</small>
                </div>
                <Progress value={total - p.remainingMs} max={total} label={`${t.name} 진행`} />
                <button type="button" className="btn btn-primary" disabled={!p.ready} onClick={() => doCollectPost(p.post.id)}>
                  {p.ready ? `결과 확인 👥 +${fmt(p.fans)}${OUTCOME_TEXT[p.outcome]}` : '기다리는 중…'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <h3 className="sub-title">새 게시물</h3>
      {g.singles.length < 1 && <p className="empty">첫 싱글을 발매한 뒤에 올릴 수 있어요.</p>}
      {POST_KINDS.map((kind) => {
        const t = POST_TEXT[kind];
        const base = Math.max(1, Math.round(postBaseFans(g.fans, kind) * mult));
        return (
          <div key={kind} className="card shop-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{t.icon}</span> {t.name}
              </h3>
              <small className="muted">{fmtDuration(G.kinds[kind].durationMs)}</small>
            </div>
            <p className="muted">
              {t.blurb} 보통 결과면 👥 약 +{fmt(base)}
            </p>
            <button type="button" className="btn btn-primary btn-wide" disabled={free <= 0 || g.singles.length < 1} onClick={() => doStartPost(kind)}>
              {free <= 0 ? '슬롯이 가득 찼어요' : '올리기'}
            </button>
          </div>
        );
      })}
    </section>
  );
}
