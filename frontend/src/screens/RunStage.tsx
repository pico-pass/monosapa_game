import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { RunGame } from '../game/runner';
import type { Persona } from '../game/types';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';

const R = BALANCE.run;
const COUNTDOWN_MS = 3000;
/** 끝난 순간(결승·쓰러짐)을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 900;
const PLAYER_X = 0.22;
const GROUND_Y = 0.8;

const PALETTE: Record<Persona, { skyTop: string; skyBottom: string; far: string; ground: string; line: string; jelly: string; body: string; block: string }> = {
  normal: { skyTop: '#2f2e66', skyBottom: '#8f89dc', far: '#4a4894', ground: '#26234a', line: '#6f69c6', jelly: '#ffd86b', body: '#cfd9ff', block: '#5a4f9e' },
  dark: { skyTop: '#1b0618', skyBottom: '#7a1243', far: '#4b0f33', ground: '#14040f', line: '#c01c63', jelly: '#ff7fb0', body: '#ff5b8a', block: '#7e1c52' },
};

interface Hud {
  hearts: number;
  jellies: number;
  distanceM: number;
  progress: number;
}

const hudOf = (g: RunGame): Hud => ({ hearts: g.hearts, jellies: g.jellyCount, distanceM: g.distanceM, progress: g.progress });

function draw(ctx: CanvasRenderingContext2D, g: RunGame, W: number, H: number, persona: Persona): void {
  const pal = PALETTE[persona];
  const scale = W / R.viewUnits;
  const gy = H * GROUND_Y;
  const px = W * PLAYER_X;
  const sx = (wx: number) => (wx - g.x) * scale + px;
  const sy = (wy: number) => gy - wy * scale;

  const sky = ctx.createLinearGradient(0, 0, 0, gy);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 멀리 있는 앰프 실루엣 (느리게 흐른다)
  ctx.fillStyle = pal.far;
  const farStep = 9 * scale;
  const farShift = -((g.x * 0.25 * scale) % farStep);
  const farBase = Math.floor((g.x * 0.25) / 9);
  for (let i = -1; i * farStep + farShift < W + farStep; i++) {
    const bh = (2.4 + (((farBase + i) * 7) % 3) * 1.2) * scale;
    ctx.fillRect(i * farStep + farShift, gy - bh, farStep * 0.7, bh);
  }

  // 속도감을 주는 가로 줄: 빨라질수록 길고 많아진다
  const speedRatio = Math.min(1, (g.speed - g.course.startSpeed) / Math.max(1, g.course.endSpeed - g.course.startSpeed));
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  const lines = 4 + Math.round(speedRatio * 6);
  for (let i = 0; i < lines; i++) {
    const ly = ((i * 53) % 100) / 100 * gy * 0.9 + 6;
    const lx = W - (((g.x * scale * 1.4) + i * 97) % (W + 120));
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + 24 + speedRatio * 60, ly);
    ctx.stroke();
  }

  // 바닥
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, gy, W, H - gy);
  ctx.fillStyle = pal.line;
  ctx.fillRect(0, gy, W, 3);
  const dash = 3 * scale;
  const dashShift = -((g.x * scale) % (dash * 2));
  for (let x = dashShift; x < W; x += dash * 2) ctx.fillRect(x, gy + (H - gy) * 0.45, dash, 3);

  // 결승선
  const fx = sx(g.course.lengthU);
  if (fx > -20 && fx < W + 20) {
    const cell = 0.8 * scale;
    for (let i = 0; i < Math.ceil(gy / cell); i++) {
      ctx.fillStyle = i % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(fx, gy - (i + 1) * cell, cell, cell);
      ctx.fillStyle = i % 2 === 0 ? '#111' : '#fff';
      ctx.fillRect(fx + cell, gy - (i + 1) * cell, cell, cell);
    }
  }

  // 장애물: 스피커 박스
  for (const o of g.course.obstacles) {
    const x0 = sx(o.x);
    if (x0 > W || x0 + o.w * scale < 0) continue;
    const w = o.w * scale;
    const h = o.h * scale;
    ctx.fillStyle = pal.block;
    ctx.fillRect(x0, gy - h, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, gy - h + 1, w - 2, h - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(x0 + w / 2, gy - h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 젤리
  const jr = 0.35 * scale;
  for (let k = 0; k < g.course.jellies.length; k++) {
    if (g.collected[k]) continue;
    const j = g.course.jellies[k];
    const x0 = sx(j.x);
    if (x0 < -jr) continue;
    if (x0 > W + jr) break;
    ctx.fillStyle = pal.jelly;
    ctx.beginPath();
    ctx.arc(x0, sy(j.y), jr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(x0 - jr * 0.3, sy(j.y) - jr * 0.3, jr * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  // 플레이어 (무적 시간에는 깜빡인다)
  const blink = g.invincibleMs > 0 && Math.floor(g.invincibleMs / 90) % 2 === 0;
  if (!blink) {
    const pw = R.playerW * scale;
    const ph = R.playerH * scale;
    const top = sy(g.y) - ph;
    ctx.fillStyle = pal.body;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(px, top, pw, ph, pw * 0.35);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1b1830';
    ctx.beginPath();
    ctx.arc(px + pw * 0.68, top + ph * 0.25, pw * 0.09, 0, Math.PI * 2);
    ctx.fill();
    // 마이크
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + pw * 0.9, top + ph * 0.5, pw * 0.5, pw * 0.14);
  }
}

/** 모노사파런 전체화면. 점프(탭·스페이스·↑), 공중에서 한 번 더 점프할 수 있다. */
export function RunPlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<RunGame | null>(null);
  if (!gameRef.current) gameRef.current = new RunGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 360, h: 220 });
  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const lastHud = useRef<Hud>(hudOf(game));
  const [hud, setHud] = useState<Hud>(lastHud.current);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);

  const jump = useCallback(() => {
    if (!startedRef.current || pausedRef.current) return;
    game.jump();
  }, [game]);

  // 캔버스 크기: 가로는 컨테이너 폭, 세로는 비율 고정
  useEffect(() => {
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const fit = () => {
      const w = Math.max(240, Math.floor(el.clientWidth));
      const h = Math.round(w * 0.7);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 프레임 루프
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(now - last, 250);
      last = now;
      if (!pausedRef.current && !(game.status !== 'running')) {
        if (!startedRef.current) {
          countRef.current -= dt;
          setCountdown(countRef.current);
          if (countRef.current <= 0) startedRef.current = true;
        } else {
          game.advance(dt);
          for (const e of game.events.splice(0)) {
            if (e === 'jump') sfx.jump(game.jumpsUsed > 1);
            else if (e === 'jelly') sfx.jelly();
            else if (e === 'hit') sfx.hit();
          }
          if (game.status !== 'running') setEnded(game.status);
        }
      }
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, game, w, h, run.persona);
      if (now - hudAt > 90) {
        hudAt = now;
        const next = hudOf(game);
        const prev = lastHud.current;
        if (next.hearts !== prev.hearts || next.jellies !== prev.jellies || next.distanceM !== prev.distanceM) {
          lastHud.current = next;
          setHud(next);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, run.persona]);

  // 끝나면 잠깐 보여준 뒤 결과를 확정한다. 그 사이 포기하면 이 타이머도 함께 사라진다.
  useEffect(() => {
    if (!ended) return;
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, {
        cleared: ended === 'cleared',
        run: {
          distanceM: game.distanceM,
          goalM: game.course.goalM,
          jellies: game.jellyCount,
          totalJellies: game.course.jellies.length,
          heartsLeft: game.hearts,
          seconds: Math.round(game.elapsedMs / 1000),
        },
      });
    }, END_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [ended, game, run.id]);

  // 탭 숨김: 달리기를 멈추고 복귀하면 이어서 한다.
  useEffect(() => {
    const onVis = () => {
      pausedRef.current = document.hidden;
      setPaused(document.hidden);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (!e.repeat) jump();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jump]);

  const goalM = game.course.goalM;
  const started = countdown <= 0;

  return (
    <div className="stage-play run-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 모노사파런
          </div>
        </div>
        <div className="stage-score" aria-live="off">
          <span>젤리</span>
          <strong>{hud.jellies}</strong>
          <small>목표 {goalM.toLocaleString()}m</small>
        </div>
      </header>

      <div className="run-hud" aria-hidden>
        <span className="run-hearts">
          {Array.from({ length: R.hearts }, (_, i) => (
            <i key={i} className={i < hud.hearts ? 'heart' : 'heart heart-lost'}>
              ♥
            </i>
          ))}
        </span>
        <span className="run-dist">
          {hud.distanceM.toLocaleString()} / {goalM.toLocaleString()}m
        </span>
      </div>
      <div className="run-progress" aria-hidden>
        <i style={{ width: `${Math.round(hud.progress * 100)}%` }} />
      </div>

      <div
        className="run-field"
        ref={wrapRef}
        onPointerDown={(e) => {
          e.preventDefault();
          jump();
        }}
      >
        <canvas ref={canvasRef} className="run-canvas" aria-label="모노사파런 화면" />
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>화면을 누르거나 스페이스로 점프 · 공중에서 한 번 더 점프</small>
          </div>
        )}
        {ended && (
          <div className={`run-end ${ended === 'cleared' ? 'run-end-win' : ''}`} role="status">
            {ended === 'cleared' ? '완주!' : '쓰러졌어요…'}
          </div>
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
          jump();
        }}
        aria-label="점프 (스페이스)"
      >
        JUMP
      </button>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
