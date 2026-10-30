import { fmt, fmtCountdown } from '../components/format';
import { BALANCE } from '../game/balance';
import { MAIL_KIND_TEXT, mailTemplateById } from '../game/content';
import { replyEffect } from '../game/fanmail';
import type { GameState } from '../game/types';
import { doReplyMail, useUi } from '../store/gameStore';

/** 답장 버튼 밑에 보여 주는 한 줄 설명. 받아치기는 이기고 지는 두 경우를 모두 적는다. */
function effectLine(g: GameState, tier: Parameters<typeof replyEffect>[1]): string {
  const part = (e: { fans: number; coins: number; diamonds: number }) =>
    [e.fans !== 0 ? `👥 ${e.fans > 0 ? '+' : ''}${fmt(e.fans)}` : '', e.coins > 0 ? `🪙 +${fmt(e.coins)}` : '', e.diamonds > 0 ? `💎 +${e.diamonds}` : ''].filter(Boolean).join(' ') || '변화 없음';
  if (tier === 'clap') {
    return `${Math.round(BALANCE.fanMail.clap.winChance * 100)}% 이기면 ${part(replyEffect(g, tier, 'win'))} · 지면 ${part(replyEffect(g, tier, 'lose'))}`;
  }
  return part(replyEffect(g, tier));
}

export function MailScreen() {
  const { game: g } = useUi();
  const inbox = [...g.fanMail.inbox].reverse();
  const waitMs = Math.max(0, g.fanMail.nextAt - g.lastSettledAt);

  return (
    <section className="screen" aria-label="팬 DM">
      <h2 className="section-title">팬 DM</h2>
      <p className="muted">
        팬들이 {BALANCE.fanMail.intervalMinMs / 60_000}~{BALANCE.fanMail.intervalMaxMs / 60_000}분 사이 무작위 간격으로 한 통씩 보내요. 받은편지함은 {BALANCE.fanMail.cap}통까지이고 넘으면 오래된 것부터 사라져요. 답장하면 팬·코인·다이아를 받을 수 있어요.
      </p>
      {g.fans < 1 ? (
        <p className="empty">아직 팬이 없어요 — 첫 싱글을 발매하면 DM이 오기 시작해요.</p>
      ) : (
        <p className="fineprint" role="status">
          다음 DM까지 {fmtCountdown(waitMs)}
        </p>
      )}
      {inbox.length === 0 && g.fans >= 1 && <p className="empty">받은 DM이 없어요. 조금만 기다려 봐요.</p>}
      {inbox.map((m) => {
        const tpl = mailTemplateById(m.tpl);
        if (!tpl) return null;
        const k = MAIL_KIND_TEXT[tpl.kind];
        return (
          <div key={m.id} className={`card mail-card mail-${tpl.kind}`}>
            <div className="card-row">
              <h3>
                <span aria-hidden>{k.icon}</span> {m.nick}
              </h3>
              <span className={`badge mail-badge-${tpl.kind}`}>{k.name}</span>
            </div>
            <p className="mail-text">{tpl.text}</p>
            <div className="mail-replies">
              {tpl.replies.map((r, i) => (
                <button key={i} type="button" className="btn btn-ghost mail-reply" onClick={() => doReplyMail(m.id, i)}>
                  <span>{r.text}</span>
                  <small className="muted">{effectLine(g, r.tier)}</small>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
