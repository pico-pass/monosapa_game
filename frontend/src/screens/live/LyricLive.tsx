import { useReducer, useState } from 'react';
import { fmt } from '../../components/format';
import { QUIZ_REWARD_TEXT } from './text';
import { initialLyric, lyricReduce, type LyricState } from './lyricState';
import { STATUS_TEXT, useLive, useNow, type LiveStatus } from './useLive';

const secLeft = (at: number, now: number): number => Math.max(0, Math.ceil((at - now) / 1000));

/** 빈칸 모양: 앞 글 + 빈칸 상자(칸 수만큼) + 뒤 글. 힌트가 오면 첫 칸에 첫 글자를 보여 준다. */
function LineWithBlank({ before, after, len, hint }: { before: string; after: string; len: number; hint: string | null }) {
  return (
    <p className="live-line" aria-label={`${before}${'□'.repeat(len)}${after}`}>
      <span>{before}</span>
      <span className="live-blank" aria-hidden>
        {Array.from({ length: len }, (_, i) => (
          <i key={i} className="live-box">
            {i === 0 && hint ? hint : ''}
          </i>
        ))}
      </span>
      <span>{after}</span>
    </p>
  );
}

function RewardNote({ state, rewarded, mine }: { state: LyricState; rewarded: boolean; mine: number }) {
  if (!rewarded) return <p className="fineprint">혼자 시작한 판은 보상이 없어요. 다른 팬과 함께하면 순위 보상이 나가요.</p>;
  if (mine <= 0) return <p className="fineprint">이번엔 한 문제도 못 맞혀서 보상이 없어요.</p>;
  if (!state.reward) return <p className="fineprint">보상 💎{mine}을 우편함으로 보내는 중이에요…</p>;
  if (state.reward.diamonds <= 0) return <p className="fineprint">오늘 라이브 보상 한도에 닿아서 이번 보상은 없어요.</p>;
  return (
    <p className="live-reward">
      📬 보상 💎{state.reward.diamonds}을 우편함으로 보냈어요!{state.reward.capped ? ' (오늘 한도까지만 나갔어요)' : ''}
    </p>
  );
}

interface BoardProps {
  state: LyricState;
  now: number;
  onAnswer: (text: string) => void;
  onAgain: () => void;
  onExit: () => void;
}

/** 가사 빈칸 속도전 화면(그리기만. 연결은 LyricLive가 한다). */
export function LyricBoard({ state, now, onAnswer, onAgain, onExit }: BoardProps) {
  const [text, setText] = useState('');
  const v = state.view;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (v.k !== 'question' || v.me || text.trim() === '') return;
    onAnswer(text);
    setText('');
  };

  if (v.k === 'wait') {
    return <p className="muted">방에 들어가는 중…{state.error && <b> {state.error}</b>}</p>;
  }

  if (v.k === 'lobby') {
    return (
      <div className="card live-card">
        <div className="card-row">
          <h3>대기실</h3>
          <strong>{secLeft(v.startsAt, now)}초 뒤 시작</strong>
        </div>
        <ul className="live-players">
          {v.players.map((p) => (
            <li key={p.uid} className={p.uid === state.myUid ? 'live-me' : ''}>
              {p.name}
              {p.uid === state.myUid && <em>나</em>}
            </li>
          ))}
        </ul>
        <p className="muted">{v.solo ? '혼자서도 연습할 수 있어요. 보상은 다른 팬과 함께한 판에만 나가요.' : '곧 시작해요! 정답을 먼저 칠수록 점수가 높아요.'}</p>
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          나가기
        </button>
      </div>
    );
  }

  if (v.k === 'question') {
    const left = Math.max(0, v.endsAt - now);
    const pct = Math.min(100, (left / Math.max(1, v.totalMs)) * 100);
    return (
      <div className="card live-card">
        <div className="card-row">
          <h3>
            {v.round}/{v.rounds} 문제
          </h3>
          <strong>{secLeft(v.endsAt, now)}초</strong>
        </div>
        <div className="live-timer" role="progressbar" aria-label="남은 시간" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <LineWithBlank before={v.before} after={v.after} len={v.len} hint={v.hint} />
        <form key={v.round} onSubmit={submit} className="live-form">
          <input
            className="live-input"
            type="text"
            inputMode="text"
            value={text}
            maxLength={60}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
            disabled={v.me !== null}
            placeholder={v.me ? '정답!' : '빈칸에 들어갈 말을 쳐요'}
            aria-label="정답 입력"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={v.me !== null || text.trim() === ''}>
            보내기
          </button>
        </form>
        {v.me ? <p className="live-reward">✅ 정답! +{v.me.gain}점</p> : v.wrong > 0 ? <p className="muted">틀렸어요. 다시 쳐 봐요 ({v.wrong}번)</p> : <p className="muted">띄어쓰기는 상관없어요.</p>}
        {v.solved.length > 0 && (
          <ul className="live-feed" aria-label="맞힌 사람">
            {v.solved.map((s) => (
              <li key={s.uid} className={s.uid === state.myUid ? 'live-me' : ''}>
                {s.place}번째 · {s.name} <b>+{s.gain}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (v.k === 'reveal') {
    const [a, b] = [v.line.indexOf(v.answer), v.answer.length];
    return (
      <div className="card live-card">
        <div className="card-row">
          <h3>정답 공개</h3>
          <small className="muted">
            {v.round}/{v.rounds} · {secLeft(v.nextAt, now)}초 뒤 다음
          </small>
        </div>
        <p className="live-line">
          {a >= 0 ? (
            <>
              {v.line.slice(0, a)}
              <mark className="live-answer">{v.line.slice(a, a + b)}</mark>
              {v.line.slice(a + b)}
            </>
          ) : (
            v.line
          )}
        </p>
        <ol className="live-board">
          {v.board.map((r, i) => (
            <li key={r.uid} className={r.uid === state.myUid ? 'live-me' : ''}>
              <span>{i + 1}</span>
              <span className="live-name">{r.name}</span>
              <b>{fmt(r.score)}</b>
              <small>{r.gain > 0 ? `+${r.gain}` : '—'}</small>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const mine = v.rows.find((r) => r.uid === state.myUid);
  return (
    <div className="card live-card">
      <div className="card-row">
        <h3>결과</h3>
        {mine && <strong>{mine.rank}위</strong>}
      </div>
      <ol className="live-board">
        {v.rows.map((r) => (
          <li key={r.uid} className={r.uid === state.myUid ? 'live-me' : ''}>
            <span>{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
            <span className="live-name">{r.name}</span>
            <b>{fmt(r.score)}</b>
            <small>{r.reward > 0 ? `💎${r.reward}` : '—'}</small>
          </li>
        ))}
      </ol>
      <RewardNote state={state} rewarded={v.rewarded} mine={mine?.reward ?? 0} />
      <div className="btn-col">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          한 판 더
        </button>
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          나가기
        </button>
      </div>
    </div>
  );
}

/** 가사 빈칸 속도전: 소켓에 연결해 방에 들어가고, 서버가 내는 문제를 먼저 맞힌다. */
export function LyricLive({ onExit }: { onExit: () => void }) {
  const [state, dispatch] = useReducer((s: LyricState, a: { m: Parameters<typeof lyricReduce>[1]; at: number }) => lyricReduce(s, a.m, a.at), initialLyric);
  const { status, send, retry } = useLive('lyric', (m) => dispatch({ m, at: performance.now() }));
  const now = useNow(200, status === 'open');

  return (
    <>
      <ConnectionNote status={status} onRetry={retry} />
      {status === 'open' && (
        <LyricBoard
          state={state}
          now={now}
          onAnswer={(text) => send({ t: 'ans', text })}
          onAgain={() => send({ t: 'join', game: 'lyric' })}
          onExit={onExit}
        />
      )}
      {status !== 'open' && status !== 'connecting' && (
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          나가기
        </button>
      )}
      <p className="fineprint">{QUIZ_REWARD_TEXT}</p>
    </>
  );
}

export function ConnectionNote({ status, onRetry }: { status: LiveStatus; onRetry: () => void }) {
  if (status === 'open') return null;
  if (status === 'connecting') return <p className="muted">라이브 서버에 연결하는 중…</p>;
  return (
    <div className="card">
      <p role="alert">{STATUS_TEXT[status]}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        다시 연결
      </button>
    </div>
  );
}
