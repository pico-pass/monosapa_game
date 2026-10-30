import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE } from '../../game/balance';
import { ENEMY_TEXT, SKILL_TEXT } from '../../game/content';
import { MinigameClock } from '../../game/minigame';
import { SurvivalGame, skillMax, type Input } from '../../game/survival';
import { abandonArcadeRun, finishArcadeRun } from '../../store/gameStore';

const S = BALANCE.survival;
const SIZE = 360;
const SCALE = SIZE / (S.half * 2);
const END_HOLD_MS = 700;
const COLORS = {
  normal: { bg: '#1c1a3e', grid: 'rgba(160,150,255,0.12)', me: '#cfd9ff', bullet: '#fff7b0', noise: '#8f89dc', troll: '#e0839c', mob: '#c1613a', boss: '#ff3b6e', aura: 'rgba(160,200,255,0.25)' },
  dark: { bg: '#170612', grid: 'rgba(255,60,120,0.14)', me: '#ff5b8a', bullet: '#ffd1e0', noise: '#a05bd6', troll: '#ff7a9b', mob: '#ff9d4a', boss: '#ffe14a', aura: 'rgba(255,60,120,0.25)' },
} as const;

interface Hud {
  timeMs: number;
  hp: number;
  level: number;
  xp: number;
  xpNeed: number;
  kills: number;
}

const hudOf = (g: SurvivalGame): Hud => ({ timeMs: g.timeMs, hp: g.hp, level: g.level, xp: g.xp, xpNeed: g.xpNeed, kills: g.kills });

function draw(ctx: CanvasRenderingContext2D, g: SurvivalGame): void {
  const pal = COLORS[g.persona];
  const sx = (x: number) => (x + S.half) * SCALE;
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
  if (g.skills.aura > 0) {
    const r = (2.2 + 0.6 * g.skills.aura) * SCALE;
    ctx.fillStyle = g.timeMs - g.auraAt < 160 ? pal.aura : 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.arc(sx(g.px), sx(g.py), r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const e of g.enemies) {
    const def = S.enemies[e.kind];
    ctx.fillStyle = pal[e.kind];
    ctx.beginPath();
    ctx.arc(sx(e.x), sx(e.y), def.r * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = pal.bullet;
  for (const b of g.bullets) {
    ctx.beginPath();
    ctx.arc(sx(b.x), sx(b.y), S.bulletR * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
  const blink = g.invMs > 0 && Math.floor(g.invMs / 80) % 2 === 0;
  if (!blink) {
    ctx.fillStyle = pal.me;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(g.px), sx(g.py), S.playerR * SCALE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

export function SurvivalPlay({ run }: { run: ArcadeRun }) {
  const game = useRef(new SurvivalGame(run.persona, run.seed, run.power));
  const clock = useRef(new MinigameClock());
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<Input>({ x: 0, y: 0 });
  const keys = useRef(new Set<string>());
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const doneRef = useRef(false);
  const choicesShown = useRef(false);
  const lastHud = useRef(0);
  const [hud, setHud] = useState<Hud>(hudOf(game.current));
  const [choices, setChoices] = useState<string[] | null>(null);
  const [end, setEnd] = useState<'won' | 'dead' | null>(null);

  const pick = (i: number) => {
    const g = game.current;
    const id = g.choices?.[i];
    if (g.choose(i)) {
      sfx.unlock();
      choicesShown.current = !!g.choices;
      setChoices(g.choices ? [...g.choices] : null);
      setHud(hudOf(g));
      if (id === 'heal') sfx.buy();
    }
  };

  useEffect(() => {
    clock.current.start(performance.now());
    let raf = 0;
    let last = performance.now();
    const ctx = canvas.current?.getContext('2d') ?? null;
    const loop = (nowPerf: number) => {
      raf = requestAnimationFrame(loop);
      const g = game.current;
      if (doneRef.current) return;
      const t = clock.current.read(nowPerf);
      const dt = t - last;
      last = t;
      // 키보드 입력은 매 프레임 합쳐서 읽는다. 조이스틱이 눌려 있으면 조이스틱이 우선한다.
      if (!stick.current) {
        const k = keys.current;
        input.current = { x: (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0), y: (k.has('down') ? 1 : 0) - (k.has('up') ? 1 : 0) };
      }
      const hpBefore = g.hp;
      const levelBefore = g.level;
      g.advance(dt, input.current);
      if (g.hp < hpBefore) sfx.hit();
      if (g.level > levelBefore) sfx.unlock();
      if (g.choices && !choicesShown.current) {
        choicesShown.current = true;
        setChoices([...g.choices]);
      }
      if (ctx) draw(ctx, g);
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
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => (document.hidden ? clock.current.pause(performance.now()) : clock.current.resume(performance.now()));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  useEffect(() => {
    const map: Record<string, string> = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' };
    const down = (e: KeyboardEvent) => {
      const k = map[e.key.toLowerCase()];
      if (k) {
        keys.current.add(k);
        e.preventDefault();
      }
      if (['1', '2', '3'].includes(e.key) && game.current.choices) pick(Number(e.key) - 1);
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

  const secLeft = Math.max(0, Math.ceil((S.durationMs - hud.timeMs) / 1000));
  const dark = run.persona === 'dark';
  const g = game.current;
  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>새벽 생존</strong>
          <div className="muted">
            남은 시간 {Math.floor(secLeft / 60)}:{String(secLeft % 60).padStart(2, '0')} · 처치 {hud.kills}
          </div>
        </div>
        <div className="stage-score">
          <strong>Lv.{hud.level}</strong>
          <small className="muted">{dark ? '과열' : '체력'} {dark ? Math.round(g.heat) : Math.ceil(hud.hp)}</small>
        </div>
      </div>
      <div className="surv-bars">
        <div className="run-progress" aria-label={dark ? '과열' : '체력'}>
          <i style={{ width: `${(dark ? g.heat : (hud.hp / S.hp) * 100).toFixed(0)}%`, background: dark ? '#ff5b8a' : '#7be0b0' }} />
        </div>
        <div className="run-progress" aria-label="경험치">
          <i style={{ width: `${Math.min(100, (hud.xp / hud.xpNeed) * 100)}%` }} />
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
        <canvas ref={canvas} width={SIZE} height={SIZE} className="run-canvas" aria-label="생존 전장" />
        {end && <div className={`run-end${end === 'won' ? ' run-end-win' : ''}`}>{end === 'won' ? '새벽을 버텼어요!' : '쓰러졌어요…'}</div>}
        {choices && !end && (
          <div className="surv-choices" role="group" aria-label="가사 스킬 고르기">
            <strong>레벨 업! 가사 스킬을 골라요</strong>
            {choices.map((id, i) => {
              const t = SKILL_TEXT[id];
              const lv = id === 'heal' ? 0 : g.skills[id as keyof typeof g.skills];
              return (
                <button key={id} type="button" className="btn btn-primary" onClick={() => pick(i)}>
                  <span aria-hidden>{t.icon}</span> {t.name}
                  <small>
                    {t.desc}
                    {id !== 'heal' && ` · Lv.${lv + 1}/${skillMax(id as 'rate')}`}
                  </small>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="fineprint">화면을 끌어서 움직여요(키보드는 방향키·WASD). 마이크는 가장 가까운 {ENEMY_TEXT.troll}을 자동으로 노려요.</p>
      <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
        나가기 (쿨다운은 유지돼요)
      </button>
    </div>
  );
}
