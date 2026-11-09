import { useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE } from '../../game/balance';
import { SlashGame, type Item } from '../../game/slash';
import { abandonArcadeRun, finishArcadeRun } from '../../store/gameStore';
import { toField, useFrameLoop } from './useFrameLoop';

const S = BALANCE.slash;
const W = 360;
const H = Math.round((W * S.h) / S.w);
const SCALE = W / S.w;
const END_HOLD_MS = 800;
const TRAIL_MS = 180;
const EMOJI: Record<Item['kind'], string> = { troll: '💬', big: '🤬', heart: '💖', shard: '💢' };
const COLORS = { normal: ['#241f52', '#3b2f7a'], dark: ['#180612', '#4a0f2e'] } as const;

interface Hud {
  hp: number;
  pts: number;
  combo: number;
  secLeft: number;
}

const hudOf = (g: SlashGame): Hud => ({ hp: g.hp, pts: g.pts, combo: g.combo, secLeft: Math.max(0, Math.ceil((S.durationMs - g.timeMs) / 1000)) });

export function drawSlash(ctx: CanvasRenderingContext2D, g: SlashGame, trail: { x: number; y: number; t: number }[], now: number): void {
  const [top, bottom] = COLORS[g.persona];
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const it of g.items) {
    const px = it.x * SCALE;
    const py = it.y * SCALE;
    const size = it.r * 2.2 * SCALE;
    ctx.font = `${size}px system-ui, sans-serif`;
    if (!it.cut) {
      ctx.fillText(EMOJI[it.kind], px, py);
      continue;
    }
    // 베어진 것은 둘로 갈라져 흩어지며 사라진다
    const k = Math.min(1, (g.timeMs - it.cutAt) / S.fadeMs);
    ctx.globalAlpha = 1 - k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px - size, py - size, size, size * 2);
    ctx.clip();
    ctx.fillText(EMOJI[it.kind], px - k * 14, py);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py - size, size, size * 2);
    ctx.clip();
    ctx.fillText(EMOJI[it.kind], px + k * 14, py);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // 칼자국
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const life = 1 - (now - b.t) / TRAIL_MS;
    if (life <= 0) continue;
    ctx.strokeStyle = `rgba(255,255,255,${life.toFixed(2)})`;
    ctx.lineWidth = 2 + 4 * life;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x * SCALE, a.y * SCALE);
    ctx.lineTo(b.x * SCALE, b.y * SCALE);
    ctx.stroke();
  }
}

/** 악플 베기: 화면을 손가락으로 그어서 튀어 오르는 말풍선을 벤다. */
export function SlashPlay({ run }: { run: ArcadeRun }) {
  const game = useRef(new SlashGame(run.persona, run.seed, run.power));
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const doneRef = useRef(false);
  const lastHud = useRef(0);
  const [hud, setHud] = useState<Hud>(hudOf(game.current));
  const [end, setEnd] = useState<'won' | 'dead' | null>(null);

  useFrameLoop(run.id, (dt, nowPerf) => {
    const g = game.current;
    if (doneRef.current) return;
    const hpBefore = g.hp;
    g.advance(dt);
    if (g.hp < hpBefore) sfx.hit();
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawSlash(ctx, g, trail.current, nowPerf);
    trail.current = trail.current.filter((p) => nowPerf - p.t < TRAIL_MS);
    if (nowPerf - lastHud.current > 100) {
      lastHud.current = nowPerf;
      setHud(hudOf(g));
    }
    if (g.status !== 'running') {
      doneRef.current = true;
      setHud(hudOf(g));
      setEnd(g.status);
      window.setTimeout(() => finishArcadeRun(run.id, g.score()), END_HOLD_MS);
    }
  });

  const move = (e: React.PointerEvent<HTMLElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId || doneRef.current) return;
    const q = toField(e, S.w, S.h);
    const n = game.current.slash(p.x, p.y, q.x, q.y);
    if (n > 0) sfx.tap(Math.min(3, n));
    trail.current.push({ x: q.x, y: q.y, t: performance.now() });
    pointer.current = { id: p.id, x: q.x, y: q.y };
  };

  const g = game.current;
  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>악플 베기</strong>
          <div className="muted">
            남은 시간 {hud.secLeft}초 · 벤 악플 {g.cuts}
          </div>
        </div>
        <div className="stage-score">
          <strong>{Math.round(hud.pts)}</strong>
          <small>{hud.combo >= 2 ? `${hud.combo} 콤보` : '포인트'}</small>
        </div>
      </div>
      <div className="run-hearts" aria-label={`체력 ${hud.hp}`}>
        {Array.from({ length: g.maxHp }, (_, i) => (
          <i key={i} className={i < hud.hp ? 'heart' : 'heart heart-lost'}>
            ♥
          </i>
        ))}
      </div>
      <div
        className="run-field arc-field"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const q = toField(e, S.w, S.h);
          pointer.current = { id: e.pointerId, x: q.x, y: q.y };
          trail.current = [{ x: q.x, y: q.y, t: performance.now() }];
        }}
        onPointerMove={move}
        onPointerUp={() => (pointer.current = null)}
        onPointerCancel={() => (pointer.current = null)}
      >
        <canvas ref={canvas} width={W} height={H} className="run-canvas" aria-label="악플 베기 화면" />
        {end && <div className={`run-end${end === 'won' ? ' run-end-win' : ''}`}>{end === 'won' ? '다 베었어요!' : '악플에 졌어요…'}</div>}
      </div>
      <p className="fineprint">손가락을 쓱 그어서 💬 악플을 베어요. 💖 팬 하트는 건드리면 체력이 깎여요. 놓친 악플도 체력이 깎여요.</p>
      <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
        나가기 (쿨다운은 유지돼요)
      </button>
    </div>
  );
}
