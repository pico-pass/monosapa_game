import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { BALL_R, BOOM, BounceGame, COLS, EMPTY, FAN, FIELD_H, MIC, MUTE, aimToward, tierOfRow, type EffectId } from '../game/bounce';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.bounce;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 900;
const BANNER_MS = 1300;
const FLASH_MS = 120;
/** 그림 좌표: 엔진의 칸 단위에 곱해서 viewBox를 키운다(작은 글자 크기가 브라우저 최소 글자 크기에 걸리지 않게) */
const U = 100;
const DEG = Math.PI / 180;

/** 이펙터 이름·설명. 수치는 balance.ts에서 읽는다. */
export const BOUNCE_EFFECT_TEXT: Record<EffectId, { icon: string; name: string; desc: string }> = {
  amp: { icon: '🔊', name: '앰프', desc: `음파가 관객에게 주는 응원 +${B.effects.ampStep}` },
  rate: { icon: '🥁', name: '연사', desc: `음파가 ${Math.round(B.effects.rateStep * 100)}% 더 빨리 나가요` },
  split: { icon: '🔀', name: '분열', desc: `음파가 처음 부딪힐 때 ${Math.round(B.effects.splitChance * 100)}% 확률로 둘로 갈라져요` },
  pierce: { icon: '🎯', name: '관통', desc: `음파가 관객 ${B.effects.pierceStep}명을 뚫고 지나가요` },
  echo: { icon: '🔁', name: '메아리', desc: `바닥에 닿은 음파가 ${B.effects.echoStep}번 더 튕겨 올라가요` },
};

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

const TIER_NAME = ['', '1층', '2층', '3층(맨 뒷줄)'];

export function BouncePlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<BounceGame | null>(null);
  if (!gameRef.current) gameRef.current = new BounceGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const idRef = useRef(0);
  const flashRef = useRef(new Map<number, number>());
  const backSaidRef = useRef(false);
  const sfxAtRef = useRef({ tick: 0, brk: 0, bad: 0 });
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림으로 옮긴다. 소리는 겹치지 않게 간격을 둔다. */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    if (evs.length === 0) return;
    const now = performance.now();
    const at = sfxAtRef.current;
    let hits = 0;
    let breaks = 0;
    let topTier = 1;
    let booms = 0;
    let bad = 0;
    for (const e of evs) {
      if (e.type === 'hit') {
        hits += 1;
        flashRef.current.set(e.cell, now);
      } else if (e.type === 'break') {
        breaks += 1;
        topTier = Math.max(topTier, e.tier);
        if (e.tier === 3 && !backSaidRef.current) {
          backSaidRef.current = true;
          say('맨 뒷줄까지 닿았어요!', 'good');
        }
      } else if (e.type === 'boom') {
        booms += 1;
      } else if (e.type === 'absorb') {
        bad += 1;
      } else if (e.type === 'pick') {
        sfx.unlock();
      } else if (e.type === 'wave') {
        backSaidRef.current = false;
        say(`${SET_NAMES[e.index]} 시작!`, 'info');
      }
    }
    for (const [cell, t] of flashRef.current) if (now - t > 400) flashRef.current.delete(cell);
    if (hits > 0 && now - at.tick > 70) {
      at.tick = now;
      sfx.tick();
    }
    if (breaks > 0 && now - at.brk > 110) {
      at.brk = now;
      sfx.clear(topTier);
    }
    if (booms > 0) {
      sfx.boom();
      if (booms >= 2) say(`폭죽 연쇄 ×${booms}!`, 'good');
    }
    if (bad > 0 && now - at.bad > 200) {
      at.bad = now;
      sfx.fail();
    }
  }, [game, say]);

  // 공연 시계: 카운트다운 뒤 실제 경과 시간을 엔진에 넣는다(이펙터를 고르는 동안은 엔진이 시간을 세지 않는다)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (!pausedRef.current && !game.over) {
        if (!startedRef.current) {
          countRef.current -= dt;
          setCountdown(countRef.current);
          if (countRef.current <= 0) startedRef.current = true;
        } else {
          game.advance(dt);
          handleEvents();
          if (game.over) setEnded(game.cleared ? 'cleared' : 'failed');
        }
      }
      refresh();
      if (!game.over) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, handleEvents, refresh]);

  // 알림은 잠깐 보여준 뒤 지운다
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner((b) => (b && b.id === banner.id ? null : b)), BANNER_MS);
    return () => window.clearTimeout(id);
  }, [banner]);

  // 끝나면 잠깐 보여준 뒤 결과를 확정한다. 그 사이 포기하면 이 타이머도 함께 사라진다.
  useEffect(() => {
    if (!ended) return;
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, { bounce: game.summary });
    }, END_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [ended, game, run.id]);

  // 탭 숨김: 공연을 멈추고 복귀하면 이어서 한다.
  useEffect(() => {
    const onVis = () => {
      pausedRef.current = document.hidden;
      setPaused(document.hidden);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 키보드: 좌우 화살표로 쏘는 각도를 조금씩 돌린다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') game.setAim(game.aim + 4 * DEG);
      else if (e.key === 'ArrowRight') game.setAim(game.aim - 4 * DEG);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  const started = countdown <= 0;
  const playable = started && !paused && game.status === 'running';

  const aimAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!playable) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    game.setAim(aimToward(((e.clientX - rect.left) / rect.width) * COLS, ((e.clientY - rect.top) / rect.height) * FIELD_H));
  };

  const onPick = (i: number) => {
    if (!game.pick(i)) return;
    sfx.buy();
    handleEvents();
    refresh();
  };

  const picking = game.picking;
  const wave = game.waveIdx;
  const power = game.wavePower[wave];
  const goal = game.goal;
  const have = (Object.keys(game.effects) as EffectId[]).filter((id) => game.effects[id] > 0);
  const now = performance.now();
  const aim = game.aim;
  const path = game.aimPath(aim, 2);
  const dark = run.persona === 'dark';

  return (
    <div className="stage-play bounce-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 음파 튕기기
          </div>
        </div>
        <div className="stage-score" aria-live="off">
          <span>열기 점수</span>
          <strong>{game.score}</strong>
          <small>
            {SET_NAMES[wave]} {wave + 1}/{B.waves.length}
          </small>
        </div>
      </header>

      <div className="run-hud" aria-hidden>
        <span>
          {SET_NAMES[wave]} · {Math.ceil(game.remainingMs / 1000)}초
        </span>
        <span className="bounce-balls">음파 {game.balls.length}개</span>
      </div>
      <div className="bounce-meter" aria-hidden>
        <i style={{ width: `${Math.min(100, (power / goal) * 100)}%` }} />
      </div>
      <div className="bounce-power muted" aria-hidden>
        응원 {Math.round(power)} / {goal}
      </div>

      <div className="bounce-field">
        <svg
          ref={svgRef}
          className="bounce-svg"
          viewBox={`0 0 ${COLS * U} ${FIELD_H * U}`}
          role="img"
          aria-label="객석과 마이크. 손가락을 움직여 음파를 쏠 방향을 정해요"
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 포인터 캡처를 못 써도 조준은 된다 */
            }
            aimAt(e);
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse' || e.buttons > 0) aimAt(e);
          }}
        >
          {[3, 2, 1].map((tier, k) => (
            <g key={tier}>
              <rect className={`bounce-tier ${k % 2 === 0 ? 'bounce-tier-a' : 'bounce-tier-b'}`} x={0} y={k * 3 * U} width={COLS * U} height={3 * U} />
              <text className="bounce-tier-label" x={COLS * U - 8} y={k * 3 * U + 34} textAnchor="end">
                {TIER_NAME[tier]} ×{B.tierMult[tier]}
              </text>
            </g>
          ))}
          {Array.from(game.kind).map((k, i) => {
            if (k === EMPTY) return null;
            const r = Math.floor(i / COLS);
            const c = i % COLS;
            const tier = tierOfRow(r);
            const t = flashRef.current.get(i);
            const cls = ['bk', k === BOOM ? 'bk-boom' : k === MUTE ? 'bk-mute' : `bk-t${tier}`];
            if (t !== undefined && now - t < FLASH_MS) cls.push('bk-hit');
            return (
              <g key={i} data-cell={i}>
                <rect className={cls.join(' ')} x={c * U + 4} y={r * U + 4} width={U - 8} height={U - 8} rx={14} />
                {k === FAN ? (
                  <text className="bk-num" x={c * U + U / 2} y={r * U + U / 2}>
                    {game.hp[i]}
                  </text>
                ) : (
                  <>
                    <text className="bk-icon" x={c * U + U / 2} y={r * U + U / 2 - 6}>
                      {k === BOOM ? '💥' : '🔇'}
                    </text>
                    <text className="bk-num bk-num-small" x={c * U + U / 2} y={r * U + U - 20}>
                      {game.hp[i]}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          {playable && (
            <polyline className="bounce-aim" fill="none" points={path.map((p) => `${(p.x * U).toFixed(1)},${(p.y * U).toFixed(1)}`).join(' ')} />
          )}
          {game.balls.map((b, i) => (
            <circle key={i} className="bounce-ball" cx={b.x * U} cy={b.y * U} r={BALL_R * U} />
          ))}
          <g className="bounce-mic">
            <line x1={MIC.x * U} y1={MIC.y * U} x2={(MIC.x + Math.cos(aim) * 0.7) * U} y2={(MIC.y - Math.sin(aim) * 0.7) * U} />
            <circle cx={MIC.x * U} cy={MIC.y * U} r={26} />
            <text x={MIC.x * U} y={MIC.y * U + 2}>
              🎤
            </text>
          </g>
        </svg>
        {banner && (
          <div key={banner.id} className={`bounce-banner bounce-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>손가락을 움직여 음파를 쏠 방향을 정해요. 음파는 자동으로 나가요</small>
          </div>
        )}
        {picking && (
          <div className="bounce-pick" role="dialog" aria-label="이펙터 고르기">
            <h3>
              {SET_NAMES[wave]} 끝! 열기 목표 {Math.round(game.waveRatio(wave) * 100)}%
            </h3>
            <p className="muted">이펙터를 하나 골라요. 공연 시간은 멈춰 있어요.</p>
            <div className="bounce-offers">
              {game.offers.map((id, i) => (
                <button key={id} type="button" className="bounce-offer" onClick={() => onPick(i)} aria-label={`${BOUNCE_EFFECT_TEXT[id].name} 고르기`}>
                  <span className="bounce-offer-icon" aria-hidden>
                    {BOUNCE_EFFECT_TEXT[id].icon}
                  </span>
                  <strong>{BOUNCE_EFFECT_TEXT[id].name}</strong>
                  <small>{BOUNCE_EFFECT_TEXT[id].desc}</small>
                  {game.effects[id] > 0 && <small className="muted">지금 {game.effects[id]}겹</small>}
                </button>
              ))}
            </div>
          </div>
        )}
        {ended && (
          <div className={`run-end ${ended === 'cleared' ? 'run-end-win' : ''}`} role="status">
            {ended === 'cleared' ? '공연 성공!' : '공연 끝…'}
          </div>
        )}
        {paused && (
          <div className="pause-note" role="status">
            ⏸ 일시정지 — 돌아오면 이어서 진행돼요
          </div>
        )}
      </div>

      <div className="bounce-effects" aria-label="고른 이펙터">
        {have.length === 0 ? (
          <span className="muted">곡이 끝날 때마다 이펙터를 하나 골라요</span>
        ) : (
          have.map((id) => (
            <span key={id} className="bounce-effect" title={BOUNCE_EFFECT_TEXT[id].desc}>
              {BOUNCE_EFFECT_TEXT[id].icon} {BOUNCE_EFFECT_TEXT[id].name}
              {game.effects[id] > 1 ? ` ×${game.effects[id]}` : ''}
            </span>
          ))
        )}
      </div>

      <p className="muted bounce-hint">
        손가락(마우스)을 움직이면 점선 쪽으로 음파가 나가요. 벽에 튕기며 관객을 깨고, 뒷줄(3층) 관객일수록 응원이 커요. 💥 폭죽 관객이 깨지면 둘레가 같이 터져요.
        {dark && ' 🔇 방음벽은 부서지기 전까지 닿은 음파를 삼켜요.'}
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
