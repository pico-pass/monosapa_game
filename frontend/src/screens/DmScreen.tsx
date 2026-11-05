import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { fmtClock } from '../components/format';
import { Presence } from '../components/parts';
import { api, ApiError, errorText } from '../platform/api';
import { setTab } from '../store/gameStore';
import { openProfile, openReport, refreshSummary, useSocial } from '../store/socialStore';

interface Thread {
  friend: { uid: string; name: string; picture: string | null; avatar: AvatarKind; seenAgoMs: number | null };
  messages: { id: string; mine: boolean; text: string; at: number; read: boolean }[];
}

const POLL_MS = 3000;
const MAX_LENGTH = 300;

/** 친구와의 개인 채팅. 열려 있는 동안 3초마다 새로 불러오고, 상대가 보낸 메시지는 읽음으로 표시돼요. */
export function DmScreen() {
  const { dmWith } = useSocial();
  if (!dmWith) {
    return (
      <section className="screen" aria-label="개인 채팅">
        <h2 className="section-title">개인 채팅</h2>
        <p className="empty">친구 목록에서 대화할 친구를 골라 주세요.</p>
        <button type="button" className="btn btn-primary" onClick={() => setTab('friends')}>
          친구 목록으로
        </button>
      </section>
    );
  }
  return <DmThread uid={dmWith} />;
}

function DmThread({ uid }: { uid: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      setThread(await api<Thread>(`dm/${uid}`));
      setError(null);
      void refreshSummary();
    } catch (e) {
      setError(errorText(e));
      // 친구가 아니게 됐거나 상대가 없으면 더 불러오지 않는다
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setBlocked(true);
    }
  }, [uid]);

  useEffect(() => {
    setThread(null);
    setBlocked(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (blocked) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, blocked]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [thread]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api(`dm/${uid}`, { method: 'POST', body: { text: body } });
      setText('');
      stick.current = true;
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  };

  const f = thread?.friend;
  return (
    <section className="screen chat dm" aria-label="개인 채팅">
      <div className="dm-head">
        <button type="button" className="btn btn-ghost" onClick={() => setTab('friends')} aria-label="친구 목록으로">
          ← 친구
        </button>
        {f && (
          <button type="button" className="fr-main" onClick={() => openProfile(f.uid)} aria-label={`${f.name} 프로필 보기`}>
            <Avatar name={f.name} picture={f.picture} avatar={f.avatar} />
            <span className="fr-name">
              <b>{f.name}</b>
              <Presence agoMs={f.seenAgoMs} />
            </span>
          </button>
        )}
      </div>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <ul className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite" aria-label="개인 채팅 메시지">
        {!thread && !error && <li className="muted">불러오는 중…</li>}
        {thread?.messages.length === 0 && <li className="empty">아직 대화가 없어요. 먼저 인사해 보세요.</li>}
        {thread?.messages.map((m) => (
          <li key={m.id} className={`dm-msg${m.mine ? ' dm-mine' : ''}`}>
            <p className="dm-bubble">{m.text}</p>
            <small className="dm-meta">
              {m.mine && m.read && '읽음 · '}
              {fmtClock(m.at)}
              {!m.mine && f && (
                <button type="button" className="chat-del" aria-label="메시지 신고" onClick={() => openReport({ kind: 'dm', refId: m.id, label: f.name })}>
                  🚩
                </button>
              )}
            </small>
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={(e) => void send(e)}>
        <input
          className="chat-input"
          value={text}
          maxLength={MAX_LENGTH}
          placeholder="메시지를 입력하세요"
          aria-label="메시지"
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="send"
        />
        <button type="submit" className="btn btn-primary" disabled={blocked || sending || text.trim().length === 0}>
          보내기
        </button>
      </form>
      <small className="fineprint">
        {text.length} / {MAX_LENGTH}자 · 대화는 14일 뒤 사라지고, 친구를 삭제하면 바로 지워져요
      </small>
    </section>
  );
}
