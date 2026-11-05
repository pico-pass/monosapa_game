import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { fmtClock } from '../components/format';
import { Presence } from '../components/parts';
import { api, errorText } from '../platform/api';
import { useAuth } from '../store/authStore';
import { toast } from '../store/gameStore';
import { openDm, openProfile, refreshSummary } from '../store/socialStore';

interface Person {
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  bio: string | null;
  seenAgoMs: number | null;
}
interface Friend extends Person {
  level: number;
  giftedToday: boolean;
  giftedMeToday: boolean;
  unread: number;
  last: { text: string; at: number; mine: boolean } | null;
}
interface Friends {
  friends: Friend[];
  incoming: Person[];
  outgoing: Person[];
  limit: number;
  giftDiamonds: number;
}

const REFRESH_MS = 15_000;

/** 친구: 친구 코드로 찾아 요청하고, 하루 한 번 서로 💎를 선물하고, 개인 채팅을 해요. */
export function FriendsScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<Friends | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Friends>('friends'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  /** 서버 요청 하나를 하고 목록과 알림 개수를 새로 불러온다. */
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done, 'good');
    } catch (e) {
      toast(errorText(e), 'warn');
    }
    await Promise.all([load(), refreshSummary()]);
  };

  const gift = (f: Friend) => act(() => api(`friends/${f.uid}/gift`, { method: 'POST' }), `💎 ${f.name}님에게 선물을 보냈어요.`);

  return (
    <section className="screen" aria-label="친구">
      <h2 className="section-title">친구</h2>
      <p className="muted">
        친구끼리는 하루에 한 번 서로에게 {data ? `💎 ${data.giftDiamonds}` : '다이아'}를 선물할 수 있고(한국 시간 0시에 초기화) 개인 채팅도 해요. 선물은 받는 사람의 우편함으로 가요.
      </p>
      <MyCode code={user?.friendCode ?? null} me={user?.id ?? null} />
      <AddByCode />
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">불러오는 중…</p>}
      {data && (
        <>
          {data.incoming.length > 0 && (
            <>
              <h3 className="sub-title">받은 친구 요청 ({data.incoming.length})</h3>
              <ul className="fr-list">
                {data.incoming.map((p) => (
                  <li key={p.uid} className="fr-row">
                    <PersonButton p={p} />
                    <div className="fr-actions">
                      <button type="button" className="btn btn-primary" onClick={() => void act(() => api(`friends/requests/${p.uid}/accept`, { method: 'POST' }), `${p.name}님과 친구가 됐어요.`)}>
                        수락
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => void act(() => api(`friends/requests/${p.uid}`, { method: 'DELETE' }))}>
                        거절
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="sub-title">
            내 친구 {data.friends.length}/{data.limit}
          </h3>
          {data.friends.length === 0 && <p className="empty">아직 친구가 없어요. 랭킹이나 챗방에서 프로필을 눌러 친구 요청을 보내 보세요.</p>}
          <ul className="fr-list">
            {data.friends.map((f) => (
              <li key={f.uid} className="fr-row">
                <PersonButton p={f} extra={`Lv.${f.level}`} />
                {f.last && (
                  <small className="fr-last muted">
                    {f.last.mine ? '나: ' : ''}
                    {f.last.text} · {fmtClock(f.last.at)}
                  </small>
                )}
                <div className="fr-actions">
                  <button type="button" className="btn btn-primary fr-chat" onClick={() => openDm(f.uid)}>
                    💬 채팅
                    {f.unread > 0 && <span className="dot-badge fr-unread">{f.unread > 9 ? '9+' : f.unread}</span>}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={f.giftedToday} onClick={() => void gift(f)}>
                    {f.giftedToday ? '선물 보냄 ✓' : '💎 선물'}
                  </button>
                </div>
                {f.giftedMeToday && <small className="fr-gifted">🎁 오늘 이 친구가 선물을 보냈어요. 우편함을 확인해 보세요.</small>}
              </li>
            ))}
          </ul>

          {data.outgoing.length > 0 && (
            <>
              <h3 className="sub-title">보낸 친구 요청 ({data.outgoing.length})</h3>
              <ul className="fr-list">
                {data.outgoing.map((p) => (
                  <li key={p.uid} className="fr-row">
                    <PersonButton p={p} />
                    <div className="fr-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => void act(() => api(`friends/requests/${p.uid}`, { method: 'DELETE' }))}>
                        요청 취소
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function PersonButton({ p, extra }: { p: Person; extra?: string }) {
  return (
    <button type="button" className="fr-main" onClick={() => openProfile(p.uid)} aria-label={`${p.name} 프로필 보기`}>
      <Avatar name={p.name} picture={p.picture} avatar={p.avatar} />
      <span className="fr-name">
        <b>
          {p.name}
          {extra && <small> {extra}</small>}
        </b>
        <Presence agoMs={p.seenAgoMs} />
      </span>
    </button>
  );
}

function MyCode({ code, me }: { code: string | null; me: string | null }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code ?? '');
      toast('친구 코드를 복사했어요.', 'good');
    } catch {
      toast('복사하지 못했어요. 코드를 직접 알려 주세요.', 'warn');
    }
  };
  return (
    <div className="card fr-code">
      <div>
        <small className="muted">내 친구 코드</small>
        <strong>{code ?? '…'}</strong>
      </div>
      <div className="fr-actions">
        {code && (
          <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
            복사
          </button>
        )}
        {me && (
          <button type="button" className="btn btn-primary" onClick={() => openProfile(me, true)}>
            ✏️ 프로필 설정
          </button>
        )}
      </div>
    </div>
  );
}

/** 친구 코드를 입력해 사람을 찾는다. 찾으면 프로필 창이 열리고 거기서 친구 요청을 보낸다. */
function AddByCode() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<{ uid: string }>(`profiles/code/${encodeURIComponent(trimmed)}`);
      setCode('');
      openProfile(p.uid);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="chat-form" onSubmit={(e) => void find(e)}>
      <input className="chat-input" value={code} maxLength={12} placeholder="친구 코드로 찾기 (8자)" aria-label="친구 코드" autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length === 0}>
        찾기
      </button>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
