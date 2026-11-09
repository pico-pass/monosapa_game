import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE } from '../../game/balance';
import { GateGame, crowdHalfWidth, type Op } from '../../game/gate';
import { abandonArcadeRun, finishArcadeRun } from '../../store/gameStore';
import { fmt } from '../../components/format';
import { toField, useFrameLoop } from './useFrameLoop';

const G = BALANCE.gate;
const W = 360;
const H = 480;
const SX = W / G.road;
/** 길 위 1칸이 화면에서 차지하는 세로 픽셀, 군중이 서 있는 화면 y */
const SY = 5;
const CROWD_Y = 380;
const SEE_AHEAD = CROWD_Y / SY + 6;
const END_HOLD_MS = 1500;
const KEY_SPEED = 70;

const opText = (op: Op): string => {
  switch (op.kind) {
    case 'add':
      return `+${op.v}`;
    case 'sub':
      return `−${op.v}`;
    case 'mul':
      return `×${op.v}`;
    case 'div':
      return `÷${op.v}`;
    case 'fight':
      return `⚔️ ${op.v}`;
  }
};
const opColor = (op: Op): string => (op.kind === 'add' || op.kind === 'mul' ? 'rgba(80,200,140,0.78)' : op.kind === 'fight' ? 'rgba(230,150,50,0.82)' : 'rgba(220,70,100,0.8)');

interface Hud {
  n: number;
  next: number;
}
const hudOf = (g: GateGame): Hud => ({ n: g.n, next: g.next });

export function drawGate(ctx: CanvasRenderingContext2D, g: GateGame): void {
  const dark = g.persona === 'dark';
  ctx.fillStyle = dark ? '#150510' : '#1b1a3f';
  ctx.fillRect(0, 0, W, H);
  // 길 표시선
  ctx.strokeStyle = dark ? 'rgba(255,60,120,0.25)' : 'rgba(160,150,255,0.25)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 12]);
  ctx.lineDashOffset = -(g.dist * SY) % 22;
  for (const x of [W / 3, (2 * W) / 3]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const screenY = (y: number) => CROWD_Y - (y - g.dist) * SY;
  for (let i = g.next; i < g.rows.length; i++) {
    const row = g.rows[i];
    if (row.y - g.dist > SEE_AHEAD) break;
    const y = screenY(row.y);
    for (const seg of row.segs) {
      ctx.fillStyle = opColor(seg.op);
      ctx.fillRect(seg.a * SX + 2, y - 20, (seg.b - seg.a) * SX - 4, 40);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText(opText(seg.op), ((seg.a + seg.b) / 2) * SX, y);
    }
  }
  // 괴수
  const by = screenY(g.bossDist);
  if (by > -80) {
    ctx.font = '64px system-ui, sans-serif';
    ctx.fillText(dark ? '👹' : '👾', W / 2, by);
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillStyle = '#ffd1e0';
    ctx.fillText(`HP ${fmt(g.bossHp)}`, W / 2, by + 44);
  }
  // 군중: 인원에 따라 점 수를 늘리고(최대 90) 반폭 안에 흩뿌린다
  const w = crowdHalfWidth(g.n) * SX;
  const dots = Math.min(90, Math.max(1, Math.round(g.n / 2)));
  ctx.fillStyle = dark ? '#ff7aa5' : '#9fd0ff';
  for (let i = 0; i < dots; i++) {
    // 결정적인 해바라기 배열: 항상 같은 모양
    const a = i * 2.399963;
    const rad = Math.sqrt((i + 0.5) / dots) * w;
    ctx.beginPath();
    ctx.arc(g.x * SX + Math.cos(a) * rad, CROWD_Y + Math.sin(a) * rad * 0.55, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.fillText(fmt(g.n), g.x * SX, CROWD_Y + w * 0.55 + 24);
}

/** 게이트 행진: 좌우로 군중을 움직여 좋은 게이트만 지나고, 끝에서 악플 괴수와 맞붙는다. */
export function GatePlay({ run }: { run: ArcadeRun }) {
  const game = useRef(new GateGame(run.persona, run.seed, run.power));
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef<number>(G.road / 2);
  const keys = useRef(new Set<string>());
  const doneRef = useRef(false);
  const lastHud = useRef(0);
  const [hud, setHud] = useState<Hud>(hudOf(game.current));
  const [end, setEnd] = useState<'won' | 'lost' | 'dead' | null>(null);

  useFrameLoop(run.id, (dt, nowPerf) => {
    const g = game.current;
    if (doneRef.current) return;
    const k = keys.current;
    if (k.size > 0) target.current = Math.max(0, Math.min(G.road, target.current + ((k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0)) * KEY_SPEED * (dt / 1000)));
    const nextBefore = g.next;
    const nBefore = g.n;
    g.advance(dt, { targetX: target.current });
    if (g.next > nextBefore) {
      if (g.n >= nBefore) sfx.tick();
      else sfx.hit();
    }
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawGate(ctx, g);
    if (nowPerf - lastHud.current > 100) {
      lastHud.current = nowPerf;
      setHud(hudOf(g));
    }
    if (g.status !== 'running') {
      doneRef.current = true;
      setHud(hudOf(g));
      setEnd(g.status);
      if (g.status === 'won') sfx.finish(true);
      window.setTimeout(() => finishArcadeRun(run.id, g.score()), END_HOLD_MS);
    }
  });

  useEffect(() => {
    const map: Record<string, string> = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
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

  const g = game.current;
  const move = (e: React.PointerEvent<HTMLElement>) => {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    target.current = Math.max(0, Math.min(G.road, toField(e, G.road, 1).x));
  };
  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>게이트 행진</strong>
          <div className="muted">
            {Math.min(hud.next, G.rows)}/{G.rows}번째 줄 · 괴수 HP {fmt(g.bossHp)}
          </div>
        </div>
        <div className="stage-score">
          <strong>{fmt(hud.n)}명</strong>
          <small>{end ? (end === 'won' ? '괴수를 쓰러뜨렸어요!' : end === 'lost' ? '모자라서 졌어요…' : '전멸했어요…') : `괴수의 ${Math.round((hud.n / g.bossHp) * 100)}%`}</small>
        </div>
      </div>
      <div
        className="run-field arc-field"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
      >
        <canvas ref={canvas} width={W} height={H} className="run-canvas" aria-label="게이트 행진 길" />
        {end && <div className={`run-end${end === 'won' ? ' run-end-win' : ''}`}>{end === 'won' ? `승리! ${fmt(hud.n)}명` : end === 'lost' ? `${fmt(hud.n)}명 · 모자랐어요` : '전멸…'}</div>}
      </div>
      <p className="fineprint">화면을 누르고 좌우로 끌어서(키보드는 ←→) 군중을 움직여요. 초록 게이트는 늘리고 빨강은 줄이고 ⚔️은 악플 무리와 싸워요. 군중이 클수록 폭이 넓어서 문에 걸쳐요!</p>
      <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
        나가기 (쿨다운은 유지돼요)
      </button>
    </div>
  );
}
