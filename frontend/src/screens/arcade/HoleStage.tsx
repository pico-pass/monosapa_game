import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE } from '../../game/balance';
import { HoleGame, type Input } from '../../game/hole';
import { abandonArcadeRun, finishArcadeRun } from '../../store/gameStore';
import { useFrameLoop } from './useFrameLoop';

const H = BALANCE.hole;
const SIZE = 360;
const SCALE = SIZE / H.size;
const END_HOLD_MS = 900;
const TIER_COLORS = ['#f0c27b', '#7bd0f0', '#9bf07b', '#f07bd0', '#f0e07b', '#ff8a5b'];
const PAL = {
  normal: { bg: '#1d1b45', grid: 'rgba(160,150,255,0.12)', me: '#0a0818', rim: '#b8c4ff', rival: ['#5b8cff', '#5bd6a0'] },
  dark: { bg: '#170612', grid: 'rgba(255,60,120,0.14)', me: '#050005', rim: '#ff5b8a', rival: ['#ff9d4a', '#a05bd6'] },
} as const;

interface Hud {
  secLeft: number;
  r: number;
  rank: number;
  eaten: number;
}

const hudOf = (g: HoleGame): Hud => ({ secLeft: Math.max(0, Math.ceil((H.durationMs - g.timeMs) / 1000)), r: g.me.r, rank: g.rank(), eaten: g.eaten });

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, rim: string, blink: boolean): void {
  if (blink) ctx.globalAlpha = 0.45;
  ctx.fillStyle = fill;
  ctx.strokeStyle = rim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x * SCALE, y * SCALE, r * SCALE, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawHoleField(ctx: CanvasRenderingContext2D, g: HoleGame): void {
  const pal = PAL[g.persona];
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 7; i++) {
    const p = (i / 7) * SIZE;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
    ctx.stroke();
  }
  // 삼킬 수 있는 소품은 또렷하게, 아직 큰 소품은 흐리게
  const limit = g.me.r * H.eatRatio;
  for (const p of g.props) {
    ctx.globalAlpha = p.size <= limit ? 1 : 0.45;
    ctx.fillStyle = TIER_COLORS[p.tier];
    ctx.beginPath();
    ctx.arc(p.x * SCALE, p.y * SCALE, p.size * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  g.rivals.forEach((rv, i) => circle(ctx, rv.x, rv.y, rv.r, '#000', pal.rival[i % pal.rival.length], g.timeMs < rv.invUntil && Math.floor(g.timeMs / 120) % 2 === 0));
  circle(ctx, g.me.x, g.me.y, g.me.r, pal.me, pal.rim, g.timeMs < g.me.invUntil && Math.floor(g.timeMs / 120) % 2 === 0);
}

/** 블랙홀 먹기: 화면을 끌어 구멍을 움직이고, 구멍보다 작은 소품을 삼켜 커진다. */
export function HolePlay({ run }: { run: ArcadeRun }) {
  const game = useRef(new HoleGame(run.persona, run.seed, run.power));
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<Input>({ x: 0, y: 0 });
  const keys = useRef(new Set<string>());
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const doneRef = useRef(false);
  const lastHud = useRef(0);
  const [hud, setHud] = useState<Hud>(hudOf(game.current));
  const [end, setEnd] = useState(false);

  useFrameLoop(run.id, (dt, nowPerf) => {
    const g = game.current;
    if (doneRef.current) return;
    if (!stick.current) {
      const k = keys.current;
      input.current = { x: (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0), y: (k.has('down') ? 1 : 0) - (k.has('up') ? 1 : 0) };
    }
    const eatenBefore = g.eaten;
    const swallowedBefore = g.swallowed;
    const rivalsBefore = g.rivalsEaten;
    g.advance(dt, input.current);
    if (g.eaten > eatenBefore) sfx.tick();
    if (g.rivalsEaten > rivalsBefore) sfx.boom();
    if (g.swallowed > swallowedBefore) sfx.hit();
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawHoleField(ctx, g);
    if (nowPerf - lastHud.current > 100) {
      lastHud.current = nowPerf;
      setHud(hudOf(g));
    }
    if (g.status !== 'running') {
      doneRef.current = true;
      setHud(hudOf(g));
      setEnd(true);
      window.setTimeout(() => finishArcadeRun(run.id, g.score()), END_HOLD_MS);
    }
  });

  useEffect(() => {
    const map: Record<string, string> = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' };
    const down = (e: KeyboardEvent) => {
      const k = map[e.key.toLowerCase()];
      if (k) {
        keys.current.add(k);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = map[e.key.toLowerCase()];
      if (k) keys.current.delete(k);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const rankText = ['🥇 1위', '🥈 2위', '🥉 3위'][hud.rank - 1] ?? `${hud.rank}위`;
  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>블랙홀 먹기</strong>
          <div className="muted">
            남은 시간 {hud.secLeft}초 · 삼킨 소품 {hud.eaten}
          </div>
        </div>
        <div className="stage-score">
          <strong>{rankText}</strong>
          <small>크기 {hud.r.toFixed(1)}</small>
        </div>
      </div>
      <div
        className="run-field surv-field"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const s = stick.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          const len = Math.hypot(dx, dy);
          input.current = len < 6 ? { x: 0, y: 0 } : { x: dx / Math.max(len, 36), y: dy / Math.max(len, 36) };
        }}
        onPointerUp={() => {
          stick.current = null;
          input.current = { x: 0, y: 0 };
        }}
        onPointerCancel={() => {
          stick.current = null;
          input.current = { x: 0, y: 0 };
        }}
      >
        <canvas ref={canvas} width={SIZE} height={SIZE} className="run-canvas" aria-label="블랙홀 먹기 무대" />
        {end && <div className="run-end">{rankText} · 크기 {hud.r.toFixed(1)}</div>}
      </div>
      <p className="fineprint">화면을 끌어서 구멍을 움직여요(키보드는 방향키·WASD). 구멍보다 작은 소품(또렷한 것)만 삼킬 수 있어요. 나보다 훨씬 큰 라이벌 구멍에는 잡아먹혀요!</p>
      <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
        나가기 (쿨다운은 유지돼요)
      </button>
    </div>
  );
}
