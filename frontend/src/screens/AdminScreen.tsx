import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fmtDateTime } from '../components/format';
import { api, errorText } from '../platform/api';
import { useAuth } from '../store/authStore';
import { toast } from '../store/gameStore';

type Action = 'dismiss' | 'warn' | 'mute';
interface Report {
  id: string;
  kind: 'profile' | 'chat' | 'dm';
  reason: string;
  reasonText: string;
  detail: string;
  snapshot: string;
  context: string[];
  reporter: { uid: string; name: string };
  target: { uid: string; name: string; mutedUntil: number | null; totalReports: number };
  status: 'open' | 'done';
  action: Action | null;
  note: string;
  muteHours: number;
  handledBy: string | null;
  handledAt: number | null;
  createdAt: number;
}
interface Muted {
  uid: string;
  name: string;
  until: number;
}

const KIND_TEXT = { chat: '챗방', dm: '개인채팅', profile: '프로필' } as const;
const ACTION_TEXT: Record<Action, string> = { dismiss: '기각', warn: '경고', mute: '이용 제한' };
const MUTE_CHOICES: [number, string][] = [
  [24, '1일'],
  [72, '3일'],
  [168, '7일'],
  [720, '30일'],
  [8760, '1년'],
];
const NOTE_MAX = 300;

type View = 'reports' | 'mail' | 'muted';

/** 관리자: 신고 처리, 우편 보내기, 이용 제한 중인 계정. 관리자 계정만 열 수 있어요(서버도 다시 확인해요). */
export function AdminScreen() {
  const { user } = useAuth();
  const [view, setView] = useState<View>('reports');
  if (!user?.isAdmin) {
    return (
      <section className="screen" aria-label="관리자">
        <h2 className="section-title">관리자</h2>
        <p className="empty">관리자만 볼 수 있는 화면이에요.</p>
      </section>
    );
  }
  return (
    <section className="screen" aria-label="관리자">
      <h2 className="section-title">관리자</h2>
      <div className="seg" role="group" aria-label="관리자 메뉴">
        <button type="button" aria-pressed={view === 'reports'} onClick={() => setView('reports')}>
          신고 처리
        </button>
        <button type="button" aria-pressed={view === 'mail'} onClick={() => setView('mail')}>
          우편 보내기
        </button>
        <button type="button" aria-pressed={view === 'muted'} onClick={() => setView('muted')}>
          제한 중
        </button>
      </div>
      {view === 'reports' && <Reports />}
      {view === 'mail' && <SendMail />}
      {view === 'muted' && <MutedList />}
    </section>
  );
}

function Reports() {
  const [status, setStatus] = useState<'open' | 'done' | 'all'>('open');
  const [list, setList] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await api<{ reports: Report[] }>(`reports/admin?status=${status}`)).reports);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [status]);

  useEffect(() => {
    setList(null);
    void load();
  }, [load]);

  return (
    <>
      <div className="seg" role="group" aria-label="상태 필터">
        {(
          [
            ['open', '대기'],
            ['done', '완료'],
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
      {!list && !error && <p className="muted">불러오는 중…</p>}
      {list?.length === 0 && <p className="empty">신고가 없어요.</p>}
      {list?.map((r) => (
        <ReportCard key={r.id} r={r} onDone={() => void load()} />
      ))}
    </>
  );
}

function ReportCard({ r, onDone }: { r: Report; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const resolve = async (action: Action) => {
    setBusy(true);
    setError(null);
    try {
      await api(`reports/admin/${r.id}/resolve`, { method: 'POST', body: { action, note, muteHours: action === 'mute' ? hours : undefined } });
      toast(`신고를 ${ACTION_TEXT[action]}로 처리했어요.`, 'good');
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="card adm-card">
      <div className="card-row">
        <h3>
          {KIND_TEXT[r.kind]} · {r.reasonText}
        </h3>
        <span className={`badge ${r.status === 'done' ? 'badge-ok' : 'badge-wait'}`}>{r.status === 'done' ? `${r.action ? ACTION_TEXT[r.action] : '완료'}` : '대기'}</span>
      </div>
      <small className="muted">
        {fmtDateTime(r.createdAt)} · 신고자 {r.reporter.name} → 대상 <b>{r.target.name}</b> (누적 신고 {r.target.totalReports}건 · ID {r.target.uid})
        {r.target.mutedUntil && r.target.mutedUntil > now ? ` · 제한 중 ~${fmtDateTime(r.target.mutedUntil)}` : ''}
      </small>
      {r.context.length > 0 && (
        <ul className="adm-context" aria-label="앞선 대화">
          {r.context.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      <p className="adm-snapshot">{r.snapshot}</p>
      {r.detail && <p className="muted">신고자 설명: {r.detail}</p>}
      {r.status === 'open' ? (
        <div className="reply-box">
          <textarea value={note} rows={2} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="당사자에게 우편으로 가는 안내 글 (경고·제한에 필요)" aria-label="처리 메모" />
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          <div className="adm-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void resolve('dismiss')}>
              기각
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || note.trim().length === 0} onClick={() => void resolve('warn')}>
              경고 + 내용 삭제
            </button>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="이용 제한 기간">
              {MUTE_CHOICES.map(([h, label]) => (
                <option key={h} value={h}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-danger" disabled={busy || note.trim().length === 0} onClick={() => void resolve('mute')}>
              이용 제한
            </button>
          </div>
          <small className="fineprint">경고·이용 제한은 신고된 글(프로필이면 닉네임·소개)을 지우고 당사자에게 우편을 보내요. 신고한 사람에게도 처리 결과가 우편으로 가요.</small>
        </div>
      ) : (
        <small className="muted">
          {r.handledBy} · {r.handledAt ? fmtDateTime(r.handledAt) : ''}
          {r.action === 'mute' ? ` · ${r.muteHours}시간 제한` : ''}
          {r.note ? ` · ${r.note}` : ''}
        </small>
      )}
    </div>
  );
}

function SendMail() {
  const [to, setTo] = useState('');
  const [all, setAll] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [diamonds, setDiamonds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sent: number }>('mailbox/admin/send', { method: 'POST', body: { to: all ? 'all' : to.trim(), title, body, diamonds } });
      toast(`우편을 ${r.sent}명에게 보냈어요.`, 'good');
      setTitle('');
      setBody('');
      setDiamonds(0);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card inquiry-form" onSubmit={(e) => void submit(e)}>
      <label className="setting-row">
        <span>
          <strong>모든 계정에 보내기</strong>
          <small>공지·이벤트 보상용. 켜면 받는 사람 칸은 쓰지 않아요.</small>
        </span>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
      </label>
      {!all && (
        <label className="field">
          <span>받는 사람의 계정 ID (신고 화면·프로필에서 확인)</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="24자리 계정 ID" />
        </label>
      )}
      <label className="field">
        <span>제목 ({title.length}/30)</span>
        <input value={title} maxLength={30} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>내용 ({body.length}/500)</span>
        <textarea value={body} rows={4} maxLength={500} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="field">
        <span>붙일 💎 (0~500)</span>
        <input type="number" min={0} max={500} value={diamonds} onChange={(e) => setDiamonds(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      </label>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy || title.trim().length === 0 || (!all && to.trim().length === 0)}>
        {busy ? '보내는 중…' : all ? '모든 계정에 보내기' : '우편 보내기'}
      </button>
    </form>
  );
}

function MutedList() {
  const [list, setList] = useState<Muted[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await api<{ users: Muted[] }>('reports/admin/muted')).users);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const unmute = async (uid: string) => {
    try {
      await api('reports/admin/unmute', { method: 'POST', body: { uid } });
      toast('이용 제한을 풀었어요.', 'good');
      await load();
    } catch (e) {
      toast(errorText(e), 'warn');
    }
  };

  return (
    <>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p className="muted">불러오는 중…</p>}
      {list?.length === 0 && <p className="empty">이용 제한 중인 계정이 없어요.</p>}
      <ul className="fr-list">
        {list?.map((u) => (
          <li key={u.uid} className="fr-row">
            <span className="fr-name">
              <b>{u.name}</b>
              <small className="muted">
                {fmtDateTime(u.until)}까지 · {u.uid}
              </small>
            </span>
            <div className="fr-actions">
              <button type="button" className="btn btn-ghost" onClick={() => void unmute(u.uid)}>
                제한 풀기
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
