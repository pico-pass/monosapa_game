import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE } from '../../game/balance';
import { RELIC_TEXT } from '../../game/content';
import { PlinkoGame, RELIC_IDS, type PegKind, type RelicId } from '../../game/plinko';
import { abandonArcadeRun, finishArcadeRun } from '../../store/gameStore';
import { fmt } from '../../components/format';
import { toField, useFrameLoop } from './useFrameLoop';

const P = BALANCE.plinko;
const W = 360;
const H = Math.round((W * P.h) / P.w);
const SCALE = W / P.w;
const END_HOLD_MS = 1000;
const POPUP_MS = 700;
const MONSTERS = ['👿 악플러', '👹 악플 군단', '👑 악플의 왕'];
const PEG_COLOR: Record<PegKind, string> = { peg: '#7fb0ff', gold: '#ffd24a', bomb: '#ff6b6b', jeer: '#a05bd6' };
const PEG_MARK: Partial<Record<PegKind, string>> = { bomb: '💣', jeer: '👎' };

interface Hud {
  hp: number;
  maxHp: number;
  balls: number;
  stage: number;
  phase: PlinkoGame['phase'];
}
const hudOf = (g: PlinkoGame): Hud => ({ hp: g.hp, maxHp: g.maxHp, balls: g.balls, stage: g.stage, phase: g.phase });

export function drawPlinko(ctx: CanvasRenderingContext2D, g: PlinkoGame, aim: { x: number; y: number }[] | null): void {
  const dark = g.persona === 'dark';
  ctx.fillStyle = dark ? '#150510' : '#1b1a3f';
  ctx.fillRect(0, 0, W, H);
  // 바닥 칸: 가장자리(데미지) · 안쪽(약한 데미지) · 가운데(구슬 돌려받기)
  const free = (P.freeHalf + (g.relics.bin > 0 ? P.binWide : 0)) * SCALE;
  const floorY = (P.h - 3) * SCALE;
  ctx.fillStyle = 'rgba(255,180,90,0.35)';
  ctx.fillRect(0, floorY, W * 0.2, 3 * SCALE);
  ctx.fillRect(W * 0.8, floorY, W * 0.2, 3 * SCALE);
  ctx.fillStyle = 'rgba(160,200,255,0.25)';
  ctx.fillRect(W * 0.2, floorY, W * 0.6, 3 * SCALE);
  ctx.fillStyle = 'rgba(120,255,170,0.55)';
  ctx.fillRect(W / 2 - free, floorY, free * 2, 3 * SCALE);
  // 핀
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of g.pegs) {
    if (p.gone) continue;
    ctx.fillStyle = p.lit ? '#fff' : PEG_COLOR[p.kind];
    ctx.beginPath();
    ctx.arc(p.x * SCALE, p.y * SCALE, P.pegR * SCALE, 0, Math.PI * 2);
    ctx.fill();
    const mark = PEG_MARK[p.kind];
    if (mark) {
      ctx.font = `${P.pegR * 2.2 * SCALE}px system-ui, sans-serif`;
      ctx.fillText(mark, p.x * SCALE, p.y * SCALE);
    }
  }
  // 대포와 조준선
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc((P.w / 2) * SCALE, P.cannonY * SCALE, 3.5 * SCALE, 0, Math.PI * 2);
  ctx.fill();
  if (aim && g.phase === 'aim') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const q of aim) {
      ctx.beginPath();
      ctx.arc(q.x * SCALE, q.y * SCALE, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 구슬
  if (g.ball) {
    ctx.fillStyle = dark ? '#ff9bbd' : '#fff7b0';
    ctx.beginPath();
    ctx.arc(g.ball.x * SCALE, g.ball.y * SCALE, g.ballR * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
  // 떠오르는 데미지 숫자
  ctx.font = 'bold 16px system-ui, sans-serif';
  for (const pop of g.popups) {
    const k = (g.timeMs - pop.at) / POPUP_MS;
    if (k < 0 || k > 1) continue;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(`${pop.dmg}`, pop.x * SCALE, (pop.y - k * 8) * SCALE);
  }
  ctx.globalAlpha = 1;
}

/** 음표 플링코: 대포 각도를 정해 구슬을 쏘고, 핀에 튕겨 악플 괴수의 체력을 깎는다. */
export function PlinkoPlay({ run }: { run: ArcadeRun }) {
  const game = useRef(new PlinkoGame(run.persona, run.seed, run.power));
  const canvas = useRef<HTMLCanvasElement>(null);
  const angle = useRef(0);
  const aimPts = useRef<{ x: number; y: number }[] | null>(null);
  const aimDirty = useRef(true);
  const doneRef = useRef(false);
  const lastHud = useRef(0);
  const lastPhase = useRef<PlinkoGame['phase']>('aim');
  const [hud, setHud] = useState<Hud>(hudOf(game.current));
  const [choices, setChoices] = useState<RelicId[] | null>(null);
  const [end, setEnd] = useState<'won' | 'lost' | null>(null);

  useFrameLoop(run.id, (dt, nowPerf) => {
    const g = game.current;
    if (doneRef.current) return;
    const dmgBefore = g.totalDmg;
    const ballsBefore = g.balls;
    g.advance(dt);
    if (g.totalDmg > dmgBefore) sfx.tick();
    if (g.balls > ballsBefore && g.phase !== 'fly') sfx.buy();
    if (g.phase !== lastPhase.current) {
      if (lastPhase.current === 'fly') aimDirty.current = true;
      lastPhase.current = g.phase;
      if (g.phase === 'choose') {
        sfx.unlock();
        setChoices(g.choices ? [...g.choices] : null);
      }
      setHud(hudOf(g));
    }
    if (aimDirty.current && g.phase === 'aim') {
      aimPts.current = g.preview(angle.current);
      aimDirty.current = false;
    }
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawPlinko(ctx, g, aimPts.current);
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

  const aimAt = (e: React.PointerEvent<HTMLElement>) => {
    const q = toField(e, P.w, P.h);
    angle.current = Math.max(-P.maxAngle, Math.min(P.maxAngle, Math.atan2(q.x - P.w / 2, Math.max(8, q.y - P.cannonY))));
    aimDirty.current = true;
  };
  const shoot = () => {
    const g = game.current;
    if (g.fire(angle.current)) {
      sfx.place();
      setHud(hudOf(g));
    }
  };
  const pick = (i: number) => {
    const g = game.current;
    if (g.choose(i)) {
      sfx.buy();
      setChoices(null);
      aimDirty.current = true;
      lastPhase.current = g.phase;
      setHud(hudOf(g));
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        angle.current = Math.max(-P.maxAngle, Math.min(P.maxAngle, angle.current + (e.key === 'ArrowLeft' ? -0.06 : 0.06)));
        aimDirty.current = true;
        e.preventDefault();
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (game.current.phase === 'aim') {
          shoot();
          e.preventDefault();
        }
      } else if (['1', '2', '3'].includes(e.key) && game.current.choices) pick(Number(e.key) - 1);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const g = game.current;
  const taken = RELIC_IDS.filter((id) => g.relics[id] > 0);
  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>음표 플링코</strong>
          <div className="muted">
            {MONSTERS[Math.min(hud.stage, MONSTERS.length - 1)]} ({hud.stage + 1}/{P.hp.length})
          </div>
        </div>
        <div className="stage-score">
          <strong>🎵 ×{hud.balls}</strong>
          <small>남은 구슬</small>
        </div>
      </div>
      <div className="run-progress" role="progressbar" aria-label="괴수 체력" aria-valuemin={0} aria-valuemax={hud.maxHp} aria-valuenow={hud.hp}>
        <i style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }} />
      </div>
      <small className="muted">
        괴수 체력 {fmt(hud.hp)} / {fmt(hud.maxHp)}
        {taken.length > 0 && ` · 유물 ${taken.map((id) => `${RELIC_TEXT[id].icon}${g.relics[id] > 1 ? `×${g.relics[id]}` : ''}`).join(' ')}`}
      </small>
      <div className="run-field arc-field" onPointerDown={aimAt} onPointerMove={(e) => e.buttons > 0 && aimAt(e)} onPointerUp={shoot}>
        <canvas ref={canvas} width={W} height={H} className="run-canvas" aria-label="플링코 판" />
        {end && <div className={`run-end${end === 'won' ? ' run-end-win' : ''}`}>{end === 'won' ? '악플을 다 잡았어요!' : '구슬이 모자랐어요…'}</div>}
        {choices && !end && (
          <div className="surv-choices" role="group" aria-label="유물 고르기">
            <strong>괴수를 쓰러뜨렸어요! 유물을 골라요</strong>
            {choices.map((id, i) => {
              const t = RELIC_TEXT[id];
              return (
                <button key={id} type="button" className="btn btn-primary" onClick={() => pick(i)}>
                  <span aria-hidden>{t.icon}</span> {t.name}
                  <small>{t.desc}</small>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="fineprint">화면을 누르고 끌어서 조준하고 놓으면 쏴요(키보드는 ←→ 조준, 스페이스 발사). 노란 핀은 ×{P.goldMult}, 💣은 주변 핀을 터뜨려요. 바닥 초록 칸에 떨어지면 구슬을 돌려받아요.</p>
      <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
        나가기 (쿨다운은 유지돼요)
      </button>
    </div>
  );
}
