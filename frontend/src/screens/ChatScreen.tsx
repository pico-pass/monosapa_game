import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { fmtClock } from '../components/format';
import { Presence } from '../components/parts';
import { titleText } from '../game/achievements';
import { api, errorText } from '../platform/api';
import { useUi } from '../store/gameStore';
import { openProfile, openReport } from '../store/socialStore';

interface ChatMessage {
  id: string;
  /** 글쓴이의 계정 ID(프로필 보기) */
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  /** 글쓴이의 마지막 접속이 몇 ms 전인지 */
  seenAgoMs: number | null;
  title: string | null;
  text: string;
  at: number;
  mine: boolean;
  canDelete: boolean;
}

const POLL_MS = 3000;
const MAX_LENGTH = 200;

/** 공개 자유 챗방. 열려 있는 동안 3초마다 최근 메시지를 새로 불러온다. */
export function ChatScreen() {
  const { game: g } = useUi();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await api<{ messages: ChatMessage[] }>('chat');
      setMessages(r.messages);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // 맨 아래에 있을 때만 새 메시지가 오면 따라 내려간다. (위로 읽는 중이면 두지 않는다.)
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
      await api('chat', { method: 'POST', body: { text: body, title: titleText(g) } });
      setText('');
      stick.current = true;
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`chat/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className="screen chat" aria-label="챗방">
      <h2 className="section-title">챗방</h2>
      <p className="muted">로그인한 모든 사람이 함께 쓰는 공개 채팅이에요. 이름이나 사진을 누르면 프로필을 볼 수 있고, 이름과 사진은 프로필 설정에서 바꿀 수 있어요. 메시지는 14일 뒤 사라져요.</p>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <ul className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite" aria-label="챗방 메시지">
        {messages === null && !error && <li className="muted">불러오는 중…</li>}
        {messages?.length === 0 && <li className="empty">아직 메시지가 없어요. 첫 마디를 남겨 봐요.</li>}
        {messages?.map((m) => (
          <li key={m.id} className={`chat-msg${m.mine ? ' chat-mine' : ''}`}>
            <button type="button" className="chat-who" onClick={() => openProfile(m.uid)} aria-label={`${m.name} 프로필 보기`}>
              <Avatar name={m.name} picture={m.picture} avatar={m.avatar} />
            </button>
            <div className="chat-body">
              <div className="chat-meta">
                <button type="button" className="chat-name" onClick={() => openProfile(m.uid)}>
                  {m.name}
                </button>
                {m.title && <em>「{m.title}」</em>}
                <small>{fmtClock(m.at)}</small>
                <Presence agoMs={m.seenAgoMs} />
                {!m.mine && (
                  <button type="button" className="chat-del" aria-label="메시지 신고" onClick={() => openReport({ kind: 'chat', refId: m.id, label: m.name })}>
                    🚩
                  </button>
                )}
                {m.canDelete && (
                  <button type="button" className="chat-del" aria-label="메시지 삭제" onClick={() => void remove(m.id)}>
                    🗑️
                  </button>
                )}
              </div>
              <p className="chat-text">{m.text}</p>
            </div>
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
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="send"
        />
        <button type="submit" className="btn btn-primary" disabled={sending || text.trim().length === 0}>
          보내기
        </button>
      </form>
      <small className="fineprint">
        {text.length} / {MAX_LENGTH}자 · 도배를 막기 위해 연달아 보내는 데 간격이 있어요
      </small>
    </section>
  );
}
