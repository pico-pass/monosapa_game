import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fmtDateTime } from '../components/format';
import { api, errorText } from '../platform/api';
import { useAuth } from '../store/authStore';

type Category = 'bug' | 'idea' | 'account' | 'other';
interface Inquiry {
  id: string;
  category: Category;
  title: string;
  body: string;
  status: 'open' | 'answered';
  reply: string | null;
  createdAt: number;
  repliedAt: number | null;
  from?: { name: string | null; email: string | null };
}

const CATEGORY_TEXT: Record<Category, string> = { bug: '🐞 버그 신고', idea: '💡 아이디어 제안', account: '🔑 계정·저장 문제', other: '💬 기타' };
const TITLE_MAX = 50;
const BODY_MAX = 1000;

type View = 'new' | 'mine' | 'admin';

/** 문의함. 문의를 보내고 답변을 확인한다. 관리자 계정이면 모든 문의에 답변하는 탭이 더 보인다. */
export function InquiryScreen() {
  const { user } = useAuth();
  const [view, setView] = useState<View>('new');
  return (
    <section className="screen" aria-label="문의함">
      <h2 className="section-title">문의함</h2>
      <p className="muted">버그, 제안, 계정 문제를 남겨 주세요. 답변이 달리면 「내 문의」에서 볼 수 있어요.</p>
      <div className="seg" role="group" aria-label="문의함 보기">
        <button type="button" aria-pressed={view === 'new'} onClick={() => setView('new')}>
          문의하기
        </button>
        <button type="button" aria-pressed={view === 'mine'} onClick={() => setView('mine')}>
          내 문의
        </button>
        {user?.isAdmin && (
          <button type="button" aria-pressed={view === 'admin'} onClick={() => setView('admin')}>
            관리자
          </button>
        )}
      </div>
      {view === 'new' && <NewInquiry onSent={() => setView('mine')} />}
      {view === 'mine' && <MyInquiries />}
      {view === 'admin' && user?.isAdmin && <AdminInquiries />}
    </section>
  );
}

function NewInquiry({ onSent }: { onSent: () => void }) {
  const [category, setCategory] = useState<Category>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('inquiries', { method: 'POST', body: { category, title, body } });
      setTitle('');
      setBody('');
      onSent();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card inquiry-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>종류</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {(Object.keys(CATEGORY_TEXT) as Category[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_TEXT[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>제목 ({title.length}/{TITLE_MAX})</span>
        <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="한 줄로 요약해 주세요" />
      </label>
      <label className="field">
        <span>내용 ({body.length}/{BODY_MAX})</span>
        <textarea value={body} maxLength={BODY_MAX} rows={7} onChange={(e) => setBody(e.target.value)} placeholder="어떤 상황인지 자세히 적어 주세요. 기기와 브라우저를 알려 주시면 도움이 돼요." />
      </label>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy || title.trim().length === 0 || body.trim().length === 0}>
        {busy ? '보내는 중…' : '문의 보내기'}
      </button>
      <small className="fineprint">문의에는 구글 계정 이름과 이메일이 함께 전달돼요. 비밀번호나 개인 정보는 적지 말아 주세요.</small>
    </form>
  );
}

function useList(path: string) {
  const [list, setList] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ inquiries: Inquiry[] }>(path);
      setList(r.inquiries);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { list, error, reload: load };
}

function MyInquiries() {
  const { list, error } = useList('inquiries/mine');
  return (
    <>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {list === null && !error && <p className="muted">불러오는 중…</p>}
      {list?.length === 0 && <p className="empty">보낸 문의가 없어요.</p>}
      {list?.map((q) => <InquiryCard key={q.id} q={q} />)}
    </>
  );
}

function InquiryCard({ q, children }: { q: Inquiry; children?: React.ReactNode }) {
  return (
    <div className="card inquiry-card">
      <div className="card-row">
        <h3>{q.title}</h3>
        <span className={`badge ${q.status === 'answered' ? 'badge-ok' : 'badge-wait'}`}>{q.status === 'answered' ? '답변 완료' : '답변 대기'}</span>
      </div>
      <small className="muted">
        {CATEGORY_TEXT[q.category]} · {fmtDateTime(q.createdAt)}
        {q.from && ` · ${q.from.name ?? '이름 없음'}${q.from.email ? ` <${q.from.email}>` : ''}`}
      </small>
      <p className="inquiry-body">{q.body}</p>
      {q.reply && (
        <div className="inquiry-reply">
          <b>답변</b> <small className="muted">{q.repliedAt ? fmtDateTime(q.repliedAt) : ''}</small>
          <p className="inquiry-body">{q.reply}</p>
        </div>
      )}
      {children}
    </div>
  );
}

function AdminInquiries() {
  const [status, setStatus] = useState<'open' | 'answered' | 'all'>('open');
  const { list, error, reload } = useList(`inquiries/admin?status=${status}`);
  return (
    <>
      <div className="seg" role="group" aria-label="상태 필터">
        {(
          [
            ['open', '대기'],
            ['answered', '완료'],
            ['all', '전체'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {list?.length === 0 && <p className="empty">문의가 없어요.</p>}
      {list?.map((q) => (
        <InquiryCard key={q.id} q={q}>
          <ReplyBox q={q} onDone={() => void reload()} />
        </InquiryCard>
      ))}
    </>
  );
}

function ReplyBox({ q, onDone }: { q: Inquiry; onDone: () => void }) {
  const [text, setText] = useState(q.reply ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`inquiries/${q.id}/reply`, { method: 'POST', body: { text } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="reply-box">
      <textarea value={text} rows={3} maxLength={BODY_MAX} onChange={(e) => setText(e.target.value)} placeholder="답변을 입력하세요" aria-label="답변" />
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={busy || text.trim().length === 0} onClick={() => void send()}>
        {q.status === 'answered' ? '답변 수정' : '답변 보내기'}
      </button>
    </div>
  );
}
