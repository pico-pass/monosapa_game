import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { fmt } from '../components/format';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import {
  BEATS,
  MinigameClock,
  approachMs,
  createMinigame,
  currentTask,
  durationMs,
  isFinished,
  judgeWindows,
  taskDifficulty,
  pressAt,
  scoreOf,
  tally,
  targetMs,
  tickTo,
  type Judgement,
  type MinigameState,
} from '../game/minigame';
import type { ConcertRun } from '../game/commands';
import { RunPlay } from './RunStage';
import {
  abandonManualConcert,
  closeConcertResult,
  finishManualConcertRun,
  useUi,
  type ConcertResult,
} from '../store/gameStore';

const C = BALANCE.concert;
const COUNTDOWN_MS = 3000;
const JUDGE_TEXT: Record<Judgement, string> = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' };

/** 직접 공연 전체화면. 이 화면이 열려 있는 동안 다른 탭으로 나갈 수 없다. */
export function ConcertStage({ run }: { run: ConcertRun }) {
  const ui = useUi();
  const result = ui.concertResult;
  const finished = run.status === 'finished' && result;
  return (
    <div className={`stage-overlay stage-${run.persona}`} role="dialog" aria-modal="true" aria-label={`${STAGE_TEXT[run.stageId].name} 직접 공연`}>
      {finished ? <ResultPanel result={result} /> : run.game === 'run' ? <RunPlay key={run.id} run={run} /> : <Play key={run.id} run={run} />}
    </div>
  );
}

function Play({ run }: { run: ConcertRun }) {
  const clock = useRef(new MinigameClock());
  const mgRef = useRef<MinigameState>(createMinigame(run.persona, run.difficulty, run.taskGrowth));
  const doneRef = useRef(false);
  const nextBeat = useRef(0);
  const [mg, setMg] = useState<MinigameState>(mgRef.current);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState<{ j: Judgement; id: number } | null>(null);
  const countRef = useRef(COUNTDOWN_MS);
  const startedRef = useRef(false);
  const pausedRef = useRef(false);

  const finish = useCallback(
    (state: MinigameState) => {
      if (doneRef.current) return;
      doneRef.current = true;
      finishManualConcertRun(run.id, scoreOf(state), { tally: tally(state) });
    },
    [run.id],
  );

  // 프레임 루프: 미니게임 시계만 진행. 숨김 중에는 pause() 때문에 흐르지 않는다.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (nowPerf: number) => {
      raf = requestAnimationFrame(loop);
      if (pausedRef.current || doneRef.current) {
        last = nowPerf;
        return;
      }
      if (!startedRef.current) {
        countRef.current -= Math.min(nowPerf - last, 250);
        last = nowPerf;
        setCountdown(countRef.current);
        if (countRef.current <= 0) {
          startedRef.current = true;
          clock.current.start(nowPerf);
        }
        return;
      }
      last = nowPerf;
      const t = clock.current.read(nowPerf);
      const next = tickTo(mgRef.current, t);
      // 박자음은 목표 간격에 맞춰 울린다. 한 프레임에 여러 박이 지났으면 마지막 박만 낸다.
      let beat: (typeof BEATS)[number] | null = null;
      while (nextBeat.current < BEATS.length && BEATS[nextBeat.current].t <= t) beat = BEATS[nextBeat.current++];
      if (beat) sfx.beat(beat.accent);
      if (next !== mgRef.current) {
        mgRef.current = next;
        setMg(next);
      }
      if (isFinished(next)) finish(next);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [finish]);

  // 탭 숨김: 미니게임 시계만 멈추고, 복귀하면 이어서 재개한다. (배경 보상은 store가 따로 정산)
  useEffect(() => {
    const onVis = () => {
      const now = performance.now();
      if (document.hidden) {
        clock.current.pause(now);
        pausedRef.current = true;
        setPaused(true);
      } else {
        clock.current.resume(now);
        pausedRef.current = false;
        setPaused(false);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const press = useCallback(() => {
    if (!startedRef.current || pausedRef.current || doneRef.current) return;
    const t = clock.current.read(performance.now());
    const base = tickTo(mgRef.current, t);
    const next = pressAt(base, t);
    mgRef.current = next;
    setMg(next);
    const idx = next.results.findIndex((r, i) => r !== base.results[i] && r !== null);
    const judged = idx >= 0 ? next.results[idx] : null;
    if (judged) {
      sfx.judge(judged);
      setFlash({ j: judged, id: performance.now() });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) press();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const started = countdown <= 0;
  const t = mg.elapsedMs;
  const cur = started ? currentTask(mg) : 0;
  // 판정 폭은 과제마다 좁아진다. 표시는 지금 입력받는 과제(없으면 마지막 과제) 기준.
  const shownTask = cur ?? C.taskCount - 1;
  const shownDifficulty = taskDifficulty(run.difficulty, shownTask, run.taskGrowth);
  const windows = judgeWindows(run.persona, shownDifficulty);
  const delta = cur === null ? null : targetMs(cur) - t;
  const approach = delta === null || cur === null ? 0 : Math.max(0, Math.min(1, delta / approachMs(cur)));
  const inWindow = delta !== null && Math.abs(delta) <= windows.goodMs;
  const score = scoreOf(mg);
  const remain = Math.max(0, durationMs - t);

  return (
    <div className="stage-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name}
          </div>
        </div>
        <div className="stage-score" aria-live="off">
          <span>점수</span>
          <strong>{score}</strong>
          <small>/ 1000 · 클리어 {C.clearScore}</small>
        </div>
      </header>

      <div className="stage-lane" aria-hidden>
        {mg.results.map((r, i) => (
          <i key={i} className={`dot ${r ? `dot-${r}` : i === cur ? 'dot-now' : ''}`} />
        ))}
      </div>

      <div className="stage-field">
        {!started ? (
          <div className="countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>준비… 스페이스 또는 큰 패드로 타이밍에 맞춰요</small>
          </div>
        ) : (
          <>
            <div className="ring ring-target" />
            {cur !== null && (
              <div
                className={`ring ring-approach ${inWindow ? 'ring-now' : ''}`}
                style={{ transform: `scale(${1 + approach * 2.2})`, opacity: 0.35 + (1 - approach) * 0.65 }}
              />
            )}
            <div className="stage-time">{(remain / 1000).toFixed(1)}s</div>
            {flash && (
              <div key={flash.id} className={`judge judge-${flash.j}`}>
                {JUDGE_TEXT[flash.j]}
              </div>
            )}
          </>
        )}
        {paused && (
          <div className="pause-note" role="status">
            ⏸ 일시정지 — 돌아오면 이어서 진행돼요
          </div>
        )}
      </div>

      <button
        type="button"
        className="tap-pad"
        onPointerDown={(e) => {
          e.preventDefault();
          press();
        }}
        aria-label="타이밍 입력 (스페이스)"
      >
        TAP
      </button>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}

function ResultPanel({ result }: { result: ConcertResult }) {
  const t = result.tally;
  const r = result.run;
  return (
    <div className="stage-result">
      <h2>{result.cleared ? (r ? '완주 성공!' : '공연 성공!') : r ? '아쉬운 질주…' : '아쉬운 공연…'}</h2>
      <p className="big-score">
        {result.score ?? 0}
        <small> / 1000</small>
      </p>
      {t && (
        <p className="muted">
          Perfect {t.perfect} · Good {t.good} · Miss {t.miss}
        </p>
      )}
      {r && (
        <p className="muted">
          {r.distanceM.toLocaleString()} / {r.goalM.toLocaleString()}m · 젤리 {r.jellies}/{r.totalJellies} · 남은 하트 {r.heartsLeft} · {r.seconds}초
        </p>
      )}
      <ul className="reward-list">
        <li>
          🪙 코인 <b>+{fmt(result.coins)}</b>
          {result.firstClear && <small> (첫 클리어 보너스 {fmt(result.firstClearCoins)} 포함)</small>}
        </li>
        {!result.cleared && (
          <li className="muted">
            {r ? '완주하지 못해서 보상 50%, 첫 클리어로 인정되지 않아요.' : '600점 미만이라 보상 50%, 첫 클리어로 인정되지 않아요.'}
          </li>
        )}
      </ul>
      <button type="button" className="btn btn-primary btn-wide" onClick={closeConcertResult}>
        확인
      </button>
    </div>
  );
}
