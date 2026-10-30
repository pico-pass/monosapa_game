import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE } from '../../game/balance';
import { MinigameClock } from '../../game/minigame';
import { createTicketing, isTicketDone, pressTicket, scoreOf, submitCode, tickTicketing, type TicketGame } from '../../game/ticketing';
import { abandonArcadeRun, finishArcadeRun } from '../../store/gameStore';

const T = BALANCE.ticketing;
const END_HOLD_MS = 900;

export function TicketPlay({ run }: { run: ArcadeRun }) {
  const [g, setG] = useState<TicketGame>(() => createTicketing(run.seed, run.power));
  const gRef = useRef(g);
  const clock = useRef(new MinigameClock());
  const doneRef = useRef(false);
  const [typed, setTyped] = useState('');
  const [left, setLeft] = useState<number>(T.captchaMs);

  const commit = (next: TicketGame) => {
    gRef.current = next;
    setG(next);
  };

  useEffect(() => {
    clock.current.start(performance.now());
    let raf = 0;
    const loop = (nowPerf: number) => {
      raf = requestAnimationFrame(loop);
      if (doneRef.current) return;
      const t = clock.current.read(nowPerf);
      const cur = gRef.current;
      const next = tickTicketing(cur, t);
      if (next !== cur) {
        if (next.phase === 'open' && cur.phase === 'wait') sfx.target();
        commit(next);
      }
      if (next.phase === 'captcha' && next.captchaStartMs !== null) setLeft(Math.max(0, T.captchaMs - (t - next.captchaStartMs)));
      if (isTicketDone(next)) {
        doneRef.current = true;
        window.setTimeout(() => finishArcadeRun(run.id, scoreOf(gRef.current)), END_HOLD_MS);
      }
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => (document.hidden ? clock.current.pause(performance.now()) : clock.current.resume(performance.now()));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [run.id]);

  const press = () => {
    if (doneRef.current) return;
    const next = pressTicket(gRef.current, clock.current.read(performance.now()));
    if (next.phase === 'captcha') sfx.buy();
    commit(next);
  };
  const submit = () => {
    if (doneRef.current || g.phase !== 'captcha') return;
    const next = submitCode(gRef.current, clock.current.read(performance.now()), typed);
    commit(next);
    if (next.captchaOk) sfx.finish(true);
    else sfx.fail();
  };

  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>피켓팅</strong>
          <div className="muted">오픈 신호에 바로 누르고 보안문자를 입력해요</div>
        </div>
      </div>
      {(g.phase === 'wait' || g.phase === 'open') && (
        <button type="button" className={`ticket-btn${g.phase === 'open' ? ' ticket-open' : ''}`} onPointerDown={press} aria-label="예매하기">
          <strong>{g.phase === 'open' ? '지금! 예매하기' : '대기열…'}</strong>
          <small>{g.phase === 'open' ? '눌러요!' : '신호가 오기 전에 누르면 반응 점수가 사라져요'}</small>
        </button>
      )}
      {g.phase === 'captcha' && (
        <div className="ticket-captcha">
          {g.falseStart && <p className="muted">신호 전에 눌러서 반응 점수는 0이에요.</p>}
          {g.reactionMs !== null && <p className="muted">반응 {Math.round(g.reactionMs)}ms</p>}
          <div className="ticket-code" aria-label="보안문자">
            {g.code.split('').join(' ')}
          </div>
          <input
            className="ticket-input"
            inputMode="numeric"
            autoFocus
            autoComplete="off"
            value={typed}
            maxLength={T.captchaDigits}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-label="보안문자 입력"
          />
          <div className="run-progress" aria-label="남은 시간">
            <i style={{ width: `${(left / T.captchaMs) * 100}%` }} />
          </div>
          <button type="button" className="btn btn-primary btn-wide" disabled={typed.length === 0} onClick={submit}>
            입력 완료
          </button>
        </div>
      )}
      {g.phase === 'done' && (
        <div className="ticket-captcha" role="status">
          <strong>{g.captchaOk ? '결제 완료!' : '보안문자 실패…'}</strong>
          <p className="muted">점수 {scoreOf(g)}</p>
        </div>
      )}
      <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
        나가기 (쿨다운은 유지돼요)
      </button>
    </div>
  );
}
