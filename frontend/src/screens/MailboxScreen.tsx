import { useCallback, useEffect, useState } from 'react';
import { fmtDateTime } from '../components/format';
import { api, errorText } from '../platform/api';
import { doClaimMail, toast } from '../store/gameStore';
import { refreshSummary } from '../store/socialStore';

type Kind = 'gift' | 'admin' | 'warning' | 'report' | 'live';
interface Mail {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  diamonds: number;
  claimed: boolean;
  read: boolean;
  fromName: string | null;
  at: number;
  expiresAt: number;
}
interface Mailbox {
  mails: Mail[];
  unread: number;
  claimable: number;
}

const KIND_ICON: Record<Kind, string> = { gift: '🎁', admin: '📢', warning: '⚠️', report: '📝', live: '🎤' };
const DAY_MS = 86_400_000;
const daysLeft = (expiresAt: number, now: number) => Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));

/** 우편함: 친구의 선물과 운영 안내가 와요. 💎가 붙은 우편은 「받기」를 눌러야 반영되고, 30일이 지나면 사라져요. */
export function MailboxScreen() {
  const [box, setBox] = useState<Mailbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBox(await api<Mailbox>('mailbox'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  // 열면 우편을 모두 읽은 것으로 표시한다. 방금 불러온 목록은 그대로 두어 이번에 새로 온 우편이 눈에 띄게 한다.
  useEffect(() => {
    void (async () => {
      await load();
      try {
        await api('mailbox/read-all', { method: 'POST' });
      } catch {
        /* 다음에 열 때 다시 시도된다 */
      }
      void refreshSummary();
    })();
  }, [load]);

  const claim = async (id?: string) => {
    if (busy) return;
    setBusy(true);
    await doClaimMail(id);
    await Promise.all([load(), refreshSummary()]);
    setBusy(false);
  };

  const remove = async (id: string) => {
    try {
      await api(`mailbox/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      toast(errorText(e), 'warn');
    }
  };

  const clean = async () => {
    try {
      await api('mailbox', { method: 'DELETE' });
      await load();
    } catch (e) {
      toast(errorText(e), 'warn');
    }
  };

  const now = Date.now();
  const total = box?.mails.filter((m) => m.diamonds > 0 && !m.claimed).reduce((n, m) => n + m.diamonds, 0) ?? 0;
  const done = box?.mails.some((m) => m.read && (m.diamonds === 0 || m.claimed)) ?? false;

  return (
    <section className="screen" aria-label="우편함">
      <h2 className="section-title">우편함</h2>
      <p className="muted">친구가 보낸 선물과 운영 안내가 와요. 우편은 30일 동안 보관돼요. 받지 않은 💎는 우편과 함께 사라지니 잊지 말고 받아 주세요.</p>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {!box && !error && <p className="muted">불러오는 중…</p>}
      {box && (
        <>
          <div className="pm-bar">
            <button type="button" className="btn btn-primary" disabled={busy || total === 0} onClick={() => void claim()}>
              {total > 0 ? `💎 ${total} 모두 받기` : '받을 💎 없음'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={!done} onClick={() => void clean()}>
              읽은 우편 정리
            </button>
          </div>
          {box.mails.length === 0 && <p className="empty">우편함이 비어 있어요. 친구에게 선물을 받으면 여기에 도착해요.</p>}
          <ul className="pm-list">
            {box.mails.map((m) => (
              <li key={m.id} className={`card pm-card${m.read ? '' : ' pm-new'}`}>
                <div className="card-row">
                  <h3>
                    <span aria-hidden>{KIND_ICON[m.kind]}</span> {m.title}
                    {!m.read && <em className="pm-badge">NEW</em>}
                  </h3>
                </div>
                <small className="muted">
                  {m.fromName ? `${m.fromName} · ` : ''}
                  {fmtDateTime(m.at)} · {daysLeft(m.expiresAt, now)}일 뒤 사라져요
                </small>
                {m.body && <p className="pm-body">{m.body}</p>}
                <div className="pm-actions">
                  {m.diamonds > 0 &&
                    (m.claimed ? (
                      <span className="badge badge-ok">💎 {m.diamonds} 받음</span>
                    ) : (
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void claim(m.id)}>
                        💎 {m.diamonds} 받기
                      </button>
                    ))}
                  {(m.diamonds === 0 || m.claimed) && (
                    <button type="button" className="btn btn-ghost" onClick={() => void remove(m.id)} aria-label="우편 삭제">
                      🗑️ 삭제
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
