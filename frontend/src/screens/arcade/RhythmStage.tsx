import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE } from '../../game/balance';
import { RHYTHM_LEVEL_TEXT } from '../../game/content';
import { MinigameClock, type Judgement } from '../../game/minigame';
import { buildChart, createRhythm, isRhythmFinished, pressLane, rhythmScore, tickTo, type RhythmState } from '../../game/rhythm';
import { abandonArcadeRun, finishArcadeRun } from '../../store/gameStore';

const R = BALANCE.rhythm;
const COUNTDOWN_MS = 3000;
const W = 360;
const H = 520;
const HIT_Y = 440;
const KEYS = ['d', 'f', 'j', 'k'];
const COLORS = { normal: ['#9fd0ff', '#c9b8ff', '#ffd86b', '#8ff0c4'], dark: ['#ff6b8f', '#ff9bd0', '#ffb04a', '#c58bff'] } as const;
const TEXT: Record<Judgement, string> = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' };

interface Hud {
  combo: number;
  score: number;
  flash: { j: Judgement; id: number } | null;
}

function draw(ctx: CanvasRenderingContext2D, st: RhythmState, persona: ArcadeRun['persona'], now: number): void {
  const laneW = W / R.lanes;
  ctx.clearRect(0, 0, W, H);
  const colors = COLORS[persona];
  for (let l = 0; l < R.lanes; l++) {
    ctx.fillStyle = l % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
    ctx.fillRect(l * laneW, 0, laneW, H);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, HIT_Y, W, 3);
  for (let i = 0; i < st.chart.notes.length; i++) {
    const n = st.chart.notes[i];
    if (st.results[i] === 'perfect' || st.results[i] === 'good') continue;
    const until = n.t - now;
    if (until > R.approachMs || until < -200) continue;
    const y = HIT_Y - (until / R.approachMs) * HIT_Y;
    ctx.globalAlpha = st.results[i] === 'miss' ? 0.3 : 1;
    ctx.fillStyle = colors[n.lane];
    ctx.beginPath();
    ctx.roundRect(n.lane * laneW + 8, y - 11, laneW - 16, 22, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let l = 0; l < R.lanes; l++) ctx.fillText(KEYS[l].toUpperCase(), l * laneW + laneW / 2, HIT_Y + 40);
}

export function RhythmPlay({ run }: { run: ArcadeRun }) {
  const chart = useMemo(() => buildChart(run.seed, run.persona, run.level), [run.seed, run.persona, run.level]);
  const stRef = useRef<RhythmState>(createRhythm(chart, run.power));
  const clock = useRef(new MinigameClock());
  const canvas = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  const beganAt = useRef(performance.now());
  const flashId = useRef(0);
  const lastMiss = useRef(0);
  const lastHud = useRef(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [hud, setHud] = useState<Hud>({ combo: 0, score: 0, flash: null });

  const flash = useCallback((j: Judgement) => setHud((h) => ({ ...h, flash: { j, id: ++flashId.current } })), []);

  const press = useCallback(
    (lane: number) => {
      if (!startedRef.current || doneRef.current) return;
      const t = clock.current.read(performance.now());
      const r = pressLane(stRef.current, lane, t);
      stRef.current = r.state;
      sfx.tap(lane);
      if (r.judgement) {
        sfx.judge(r.judgement);
        flash(r.judgement);
      }
    },
    [flash],
  );

  useEffect(() => {
    let raf = 0;
    const ctx = canvas.current?.getContext('2d') ?? null;
    const loop = (nowPerf: number) => {
      raf = requestAnimationFrame(loop);
      if (doneRef.current) return;
      if (!startedRef.current) {
        const left = Math.max(0, COUNTDOWN_MS - (nowPerf - beganAt.current));
        setCountdown(left);
        if (left <= 0) {
          startedRef.current = true;
          clock.current.start(nowPerf);
        }
        if (ctx) draw(ctx, stRef.current, run.persona, -R.leadInMs);
        return;
      }
      const t = clock.current.read(nowPerf);
      stRef.current = tickTo(stRef.current, t);
      if (ctx) draw(ctx, stRef.current, run.persona, t);
      const misses = stRef.current.results.filter((x) => x === 'miss').length;
      if (misses > lastMiss.current) {
        lastMiss.current = misses;
        flash('miss');
      }
      if (nowPerf - lastHud.current > 100) {
        lastHud.current = nowPerf;
        setHud((h) => ({ ...h, combo: stRef.current.combo, score: rhythmScore(stRef.current) }));
      }
      if (isRhythmFinished(stRef.current)) {
        doneRef.current = true;
        finishArcadeRun(run.id, rhythmScore(stRef.current));
      }
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => (document.hidden ? clock.current.pause(performance.now()) : clock.current.resume(performance.now()));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [run.id, run.persona, flash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const lane = KEYS.indexOf(e.key.toLowerCase());
      if (lane >= 0) press(lane);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>리듬 모드 · {RHYTHM_LEVEL_TEXT[run.level]}</strong>
          <div className="muted">{chart.notes.length}노트 · BPM {chart.bpm}</div>
        </div>
        <div className="stage-score">
          <strong>{hud.score}</strong>
          <small className="muted">점수</small>
        </div>
      </div>
      <div
        className="run-field rhythm-field"
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          press(Math.max(0, Math.min(R.lanes - 1, Math.floor(((e.clientX - rect.left) / rect.width) * R.lanes))));
        }}
      >
        <canvas ref={canvas} width={W} height={H} className="run-canvas" aria-label="리듬 노트 판" />
        {hud.combo >= 2 && <div className="rhythm-combo">{hud.combo} COMBO</div>}
        {hud.flash && (
          <div key={hud.flash.id} className={`judge judge-${hud.flash.j} rhythm-judge`}>
            {TEXT[hud.flash.j]}
          </div>
        )}
        {countdown > 0 && (
          <div className="run-countdown">
            <strong className="big-score">{Math.ceil(countdown / 1000)}</strong>
            <small>레인을 누르거나 D F J K 키</small>
          </div>
        )}
      </div>
      <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
        나가기 (쿨다운은 유지돼요)
      </button>
    </div>
  );
}
