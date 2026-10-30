import { useCallback, useEffect, useState } from 'react';
import { fmtCountdown } from '../components/format';
import { api, errorText } from '../platform/api';
import { doClaimChallenge, notifyChallengePosted, useUi } from '../store/gameStore';

interface Entry {
  id: string;
  rank: number;
  name: string;
  text: string;
  likes: number;
  liked: boolean;
  mine: boolean;
  canDelete: boolean;
}
interface Last {
  week: number;
  theme: string;
  myRank: number | null;
  myLikes: number;
  reward: number | null;
  claimed: boolean;
  top: Entry[];
}
interface Challenge {
  week: number;
  theme: string;
  endsAt: number;
  entries: Entry[];
  mine: Entry | null;
  last: Last | null;
  hall: { week: number; theme: string; name: string; text: string; likes: number }[];
}

const MAX = 60;
const REFRESH_MS = 20_000;

/** 주간 해시태그 챌린지: 주제에 맞는 한 줄을 올리고 서로 좋아요를 눌러요. 지난주 결과는 보상으로 받아요. */
export function ChallengeScreen() {
  const { game: g } = useUi();
  const [data, setData] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await api<Challenge>('challenge'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const a = setInterval(() => void load(), REFRESH_MS);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
    await load();
    setBusy(false);
  };

  const post = () =>
    act(async () => {
      await api('challenge', { method: 'POST', body: { text } });
      setText('');
      notifyChallengePosted();
    });

  const posted = !!data && (data.mine !== null || data.entries.some((e) => e.mine));
  const len = [...text].length;

  const row = (e: Entry) => (
    <li key={e.id} className={`ch-row${e.mine ? ' ch-mine' : ''}`}>
      <span className="ch-rank">{e.rank > 0 ? e.rank : '·'}</span>
      <div className="ch-main">
        <p>{e.text}</p>
        <small className="muted">{e.name}</small>
      </div>
      <div className="ch-actions">
        <button type="button" className={`btn btn-ghost ch-like${e.liked ? ' ch-liked' : ''}`} disabled={busy || e.mine} onClick={() => void act(() => api(`challenge/${e.id}/like`, { method: 'POST' }))} aria-label={`좋아요 ${e.likes}개`}>
          {e.liked ? '❤️' : '🤍'} {e.likes}
        </button>
        {!e.mine && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => api(`challenge/${e.id}/report`, { method: 'POST' }))}>
            신고
          </button>
        )}
        {e.canDelete && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => api(`challenge/${e.id}`, { method: 'DELETE' }))}>
            삭제
          </button>
        )}
      </div>
    </li>
  );

  return (
    <section className="screen" aria-label="해시태그 챌린지">
      <h2 className="section-title">해시태그 챌린지</h2>
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">불러오는 중…</p>}
      {data && (
        <>
          <div className="card ch-theme">
            <strong className="ch-tag">{data.theme}</strong>
            <small className="muted">이번 주 마감까지 {fmtCountdown(Math.max(0, data.endsAt - now))} · 한 주에 한 줄만 올릴 수 있어요</small>
            {!posted && (
              <div className="ch-form">
                <input value={text} maxLength={MAX} placeholder={`${data.theme} 한 줄 가사`} onChange={(e) => setText(e.target.value)} aria-label="한 줄 가사" onKeyDown={(e) => e.key === 'Enter' && len > 0 && !busy && void post()} />
                <button type="button" className="btn btn-primary" disabled={busy || len === 0} onClick={() => void post()}>
                  올리기 ({len}/{MAX})
                </button>
              </div>
            )}
            {posted && <small className="muted">이번 주 한 줄을 올렸어요. 좋아요가 많을수록 지난주 결과 보상이 커져요.</small>}
          </div>

          {data.last && (
            <div className="card">
              <h3>지난주 {data.last.theme}</h3>
              <small className="muted">
                {data.last.myRank ? `내 순위 ${data.last.myRank}위 · 좋아요 ${data.last.myLikes}개` : '지난주에는 참여하지 않았어요.'}
              </small>
              {data.last.reward !== null && (
                <button type="button" className="btn btn-accent btn-wide" disabled={busy} onClick={() => void act(doClaimChallenge)}>
                  🏆 보상 받기 💎 {data.last.reward}
                </button>
              )}
              {data.last.claimed && <small className="muted">보상을 받았어요.</small>}
              <ol className="ch-list">{data.last.top.map(row)}</ol>
            </div>
          )}

          <h3 className="sub-title">이번 주 순위</h3>
          {data.entries.length === 0 && <p className="empty">아직 올라온 글이 없어요. 첫 번째가 되어 보세요!</p>}
          <ol className="ch-list">
            {data.entries.map(row)}
            {data.mine && row(data.mine)}
          </ol>

          {data.hall.length > 0 && (
            <>
              <h3 className="sub-title">🏛️ 명예의 전당 (지난 {data.hall.length}주 1위)</h3>
              <ul className="ch-hall">
                {data.hall.map((h) => (
                  <li key={h.week}>
                    <small className="muted">
                      {h.theme} · {h.name} · ❤️ {h.likes}
                    </small>
                    <p>{h.text}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <h3 className="sub-title">📓 내 가사 노트</h3>
      {g.stats.notes.length === 0 ? (
        <p className="empty">3위 안에 든 글이 여기에 남아요.</p>
      ) : (
        <ul className="ch-hall">
          {[...g.stats.notes].reverse().map((n) => (
            <li key={n}>
              <p>{n}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
