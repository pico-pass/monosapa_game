import { useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT } from '../game/content';
import { MinigameClock } from '../game/minigame';
import type { TowerRun } from '../game/tower';
import { TowerBattle, type Input } from '../game/towerbattle';
import { abandonTowerRun, finishTowerRun } from '../store/gameStore';

const B = BALANCE.tower.battle;
const SIZE = 360;
const SCALE = SIZE / (B.half * 2);
const END_HOLD_MS = 800;
const COLORS = {
  normal: { bg: '#1c1a3e', grid: 'rgba(160,150,255,0.12)', me: '#cfd9ff', shot: '#fff7b0', boss: '#8f89dc', bossHit: '#ffffff', enemy: '#ff7fb0' },
  dark: { bg: '#170612', grid: 'rgba(255,60,120,0.14)', me: '#ff5b8a', shot: '#ffd1e0', boss: '#a05bd6', bossHit: '#ffe14a', enemy: '#ffb04a' },
} as const;

interface Hud {
  timeMs: number;
  hp: number;
  boss: number;
}

const hudOf = (g: TowerBattle): Hud => ({ timeMs: g.timeMs, hp: g.hpFrac, boss: g.bossFrac });

function draw(ctx: CanvasRenderingContext2D, g: TowerBattle, persona: TowerRun['persona'], bossHurt: boolean): void {
  const pal = COLORS[persona];
  const sx = (v: number) => (v + B.half) * SCALE;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * SIZE;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
    ctx.stroke();
  }
  // 보스
  ctx.fillStyle = bossHurt ? pal.bossHit : pal.boss;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx(g.bossX), sx(g.bossY), B.bossR * SCALE, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 보스 탄
  ctx.fillStyle = pal.enemy;
  for (const s of g.enemyShots) {
    ctx.beginPath();
    ctx.arc(sx(s.x), sx(s.y), B.enemyShotR * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
  // 내 탄
  ctx.fillStyle = pal.shot;
  for (const s of g.shots) {
    ctx.beginPath();
    ctx.arc(sx(s.x), sx(s.y), B.shotR * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
  // 나 (무적 시간에는 깜빡인다)
  const blink = g.invMs > 0 && Math.floor(g.invMs / 80) % 2 === 0;
  if (!blink) {
    ctx.fillStyle = pal.me;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx(g.px), sx(g.py), B.playerR * SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** 무한의 계단 보스전 전체화면. 끌어서 움직이고(키보드는 방향키·WASD) 마이크는 보스를 자동으로 노려요. */
export function TowerStage({ run }: { run: TowerRun }) {
  const game = useRef(new TowerBattle(run.seed, run.floor, run.ratio, run.enemy.boss));
  const clock = useRef(new MinigameClock());
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<Input>({ x: 0, y: 0 });
  const keys = useRef(new Set<string>());
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const doneRef = useRef(false);
  const beganAt = useRef(performance.now());
  const startedRef = useRef(false);
  const lastHud = useRef(0);
  const lastBossHp = useRef<number>(B.bossHp);
  const hurtUntil = useRef(0);
  const [hud, setHud] = useState<Hud>(hudOf(game.current));
  const [countdown, setCountdown] = useState<number>(B.countdownMs);
  const [end, setEnd] = useState<'won' | 'lost' | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const ctx = canvas.current?.getContext('2d') ?? null;
    const loop = (nowPerf: number) => {
      raf = requestAnimationFrame(loop);
      const g = game.current;
      if (doneRef.current) return;
      if (!startedRef.current) {
        const left = Math.max(0, B.countdownMs - (nowPerf - beganAt.current));
        setCountdown(left);
        if (ctx) draw(ctx, g, run.persona, false);
        if (left <= 0) {
          startedRef.current = true;
          clock.current.start(nowPerf);
        }
        return;
      }
      const t = clock.current.read(nowPerf);
      const dt = t - last;
      last = t;
      if (!stick.current) {
        const k = keys.current;
        input.current = { x: (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0), y: (k.has('down') ? 1 : 0) - (k.has('up') ? 1 : 0) };
      }
      const hpBefore = g.hp;
      g.advance(dt, input.current);
      if (g.hp < hpBefore) sfx.hit();
      if (g.bossHp < lastBossHp.current) {
        lastBossHp.current = g.bossHp;
        hurtUntil.current = nowPerf + 80;
      }
      if (ctx) draw(ctx, g, run.persona, nowPerf < hurtUntil.current);
      if (nowPerf - lastHud.current > 100) {
        lastHud.current = nowPerf;
        setHud(hudOf(g));
      }
      if (g.status !== 'running') {
        doneRef.current = true;
        setHud(hudOf(g));
        setEnd(g.status);
        const won = g.status === 'won';
        window.setTimeout(() => finishTowerRun(run.id, won), END_HOLD_MS);
      }
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => (document.hidden ? clock.current.pause(performance.now()) : clock.current.resume(performance.now()));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [run.id, run.persona]);

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

  const secLeft = Math.max(0, Math.ceil((B.timeLimitMs - hud.timeMs) / 1000));
  return (
    <div className={`stage-overlay stage-${run.persona}`} role="dialog" aria-modal="true" aria-label="무한의 계단 보스전">
      <div className="stage-play">
        <div className="stage-head">
          <div>
            <strong>
              {run.floor}층 {run.enemy.boss ? '보스' : '수문장'}
            </strong>
            <div className="muted">
              {PERSONA_TEXT[run.persona].short} · 전투력 ×{run.ratio.toFixed(2)} · 약점 {PERSONA_TEXT[run.enemy.weak].short}
            </div>
          </div>
          <div className="stage-score">
            <strong>
              {Math.floor(secLeft / 60)}:{String(secLeft % 60).padStart(2, '0')}
            </strong>
            <small className="muted">남은 시간</small>
          </div>
        </div>
        <div className="surv-bars">
          <div className="run-progress" aria-label="보스 체력">
            <i style={{ width: `${hud.boss * 100}%`, background: '#ff5b8a' }} />
          </div>
          <div className="run-progress" aria-label="내 체력">
            <i style={{ width: `${hud.hp * 100}%`, background: '#7be0b0' }} />
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
          <canvas ref={canvas} width={SIZE} height={SIZE} className="run-canvas" aria-label="보스전 전장" />
          {countdown > 0 && (
            <div className="run-countdown">
              <strong className="big-score">{Math.ceil(countdown / 1000)}</strong>
              <small>화면을 끌어서 탄을 피해요</small>
            </div>
          )}
          {end && <div className={`run-end${end === 'won' ? ' run-end-win' : ''}`}>{end === 'won' ? '쓰러뜨렸어요!' : hud.hp <= 0 ? '쓰러졌어요…' : '시간이 다 됐어요…'}</div>}
        </div>
        <p className="fineprint">화면을 끌어서 움직여요(키보드는 방향키·WASD). 주황색 탄을 맞으면 체력이 줄고, 시간 안에 보스 체력을 모두 깎으면 이겨요.</p>
        <button type="button" className="btn btn-ghost" onClick={abandonTowerRun}>
          나가기 (쿨다운은 유지돼요)
        </button>
      </div>
    </div>
  );
}
