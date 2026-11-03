import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import {
  HEIGHT,
  PASSIVE_IDS,
  PLAYER_R,
  SurvivorGame,
  WEAPON_IDS,
  WIDTH,
  isWeapon,
  perkMax,
  type EnemyId,
  type PerkId,
} from '../game/survivor';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.survivor;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 1000;
const BANNER_MS = 1300;
const LASER_MS = 180;
const BOOM_MS = 320;
/** 그림 좌표: 엔진의 칸 단위에 곱해서 viewBox를 키운다(작은 글자 크기가 브라우저 최소 글자 크기에 걸리지 않게) */
const U = 100;
/** 손가락을 이만큼(칸) 끌면 최대 속도. 더 끌면 기준점이 따라 움직인다. */
const FULL_DRAG = 0.6;
const MAX_DRAG = 1.2;
const DEAD_ZONE = 0.08;

/** 퍼크 이름·설명. 수치는 balance.ts에서 읽는다. */
export const PERK_TEXT: Record<PerkId, { icon: string; name: string; desc: string }> = {
  spot: { icon: '🔦', name: '스포트라이트', desc: '가까운 드론에게 빔을 쏴요. 올릴수록 세지고 빨라지고 갈래가 늘어요' },
  orbit: { icon: '💡', name: '조명', desc: '내 둘레를 도는 조명이 부딪힌 드론을 때려요. 올릴수록 조명이 늘어요' },
  laser: { icon: '⚡', name: '레이저', desc: '가까운 드론 쪽으로 길게 뻗어 줄 선 드론을 모두 꿰뚫어요' },
  firework: { icon: '🎆', name: '폭죽', desc: '가까운 드론 위에서 터져 둘레 드론을 날려요' },
  speed: { icon: '👟', name: '발걸음', desc: `이동 속도 +${Math.round((B.speedStep / B.playerSpeed) * 100)}%` },
  magnet: { icon: '🧲', name: '자석', desc: '응원을 더 멀리서 끌어와요' },
  amp: { icon: '📣', name: '열기 증폭', desc: `주운 응원 +${Math.round(B.ampStep * 100)}%` },
  heart: { icon: '❤️', name: '하트', desc: '하트 최대치 +1, 하트 1개 회복' },
};

export const ENEMY_TEXT: Record<EnemyId, { icon: string; name: string }> = {
  drone: { icon: '📷', name: '파파라치 드론' },
  swift: { icon: '📸', name: '빠른 드론' },
  shield: { icon: '🛸', name: '방패 드론' },
  elite: { icon: '🚁', name: '엘리트 드론' },
};

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
}
interface Ring {
  x: number;
  y: number;
  r: number;
  t: number;
}

export function SurvivorPlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<SurvivorGame | null>(null);
  if (!gameRef.current) gameRef.current = new SurvivorGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const idRef = useRef(0);
  const beamsRef = useRef<Beam[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const sfxAtRef = useRef({ kill: 0, gem: 0, boom: 0 });
  const dragRef = useRef<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const keysRef = useRef(new Set<string>());
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림·효과로 옮긴다. 소리는 겹치지 않게 간격을 둔다. */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    if (evs.length === 0) return;
    const now = performance.now();
    const at = sfxAtRef.current;
    let kills = 0;
    let gems = 0;
    let booms = 0;
    for (const e of evs) {
      if (e.type === 'kill') kills += 1;
      else if (e.type === 'gem') gems += 1;
      else if (e.type === 'laser') beamsRef.current.push({ x1: e.x1 * U, y1: e.y1 * U, x2: e.x2 * U, y2: e.y2 * U, t: now });
      else if (e.type === 'boom') {
        booms += 1;
        ringsRef.current.push({ x: e.x * U, y: e.y * U, r: e.r * U, t: now });
      } else if (e.type === 'burst') booms += 1;
      else if (e.type === 'hurt') sfx.hit();
      else if (e.type === 'heal') sfx.buy();
      else if (e.type === 'pick') sfx.unlock();
      else if (e.type === 'level') say(`레벨 ${e.level}!`, 'good');
      else if (e.type === 'waveEnd') say(`${SET_NAMES[e.index]} 끝! 열기 목표 ${Math.round(e.ratio * 100)}%`, e.ratio >= 0.6 ? 'good' : 'bad');
      else if (e.type === 'wave') say(`${SET_NAMES[e.index]} 시작!`, 'info');
    }
    beamsRef.current = beamsRef.current.filter((b) => now - b.t < LASER_MS);
    ringsRef.current = ringsRef.current.filter((r) => now - r.t < BOOM_MS);
    if (kills > 0 && now - at.kill > 90) {
      at.kill = now;
      sfx.tick();
    }
    if (gems > 0 && now - at.gem > 120) {
      at.gem = now;
      sfx.jelly();
    }
    if (booms > 0 && now - at.boom > 250) {
      at.boom = now;
      sfx.boom();
    }
  }, [game, say]);

  // 공연 시계: 카운트다운 뒤 실제 경과 시간을 엔진에 넣는다(퍼크를 고르는 동안은 엔진이 시간을 세지 않는다)
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
    game.setMove(0, 0);
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, { survivor: game.summary });
    }, END_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [ended, game, run.id]);

  // 탭 숨김: 공연을 멈추고 복귀하면 이어서 한다.
  useEffect(() => {
    const onVis = () => {
      pausedRef.current = document.hidden;
      setPaused(document.hidden);
      if (document.hidden) {
        dragRef.current = null;
        keysRef.current.clear();
        game.setMove(0, 0);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [game]);

  // 키보드: 방향키·WASD로 움직인다
  useEffect(() => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      a: [-1, 0],
      d: [1, 0],
      w: [0, -1],
      s: [0, 1],
    };
    const apply = () => {
      if (dragRef.current) return;
      let x = 0;
      let y = 0;
      for (const k of keysRef.current) {
        x += dirs[k][0];
        y += dirs[k][1];
      }
      game.setMove(x, y);
    };
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!dirs[k]) return;
      e.preventDefault();
      keysRef.current.add(k);
      apply();
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!dirs[k]) return;
      keysRef.current.delete(k);
      apply();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [game]);

  const started = countdown <= 0;
  const playable = started && !paused && game.status === 'running';

  /** 끌고 있는 손가락 위치를 칸 단위로 바꿔 이동 방향을 정한다(떠 있는 조이스틱) */
  const steer = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width <= 0) return;
    const k = WIDTH / rect.width;
    d.x = e.clientX;
    d.y = e.clientY;
    let vx = (d.x - d.ox) * k;
    let vy = (d.y - d.oy) * k;
    const len = Math.hypot(vx, vy);
    if (len > MAX_DRAG) {
      // 기준점을 끌려가게 해서 손가락이 멀리 가도 바로 반대로 꺾을 수 있게 한다
      const over = (len - MAX_DRAG) / len;
      d.ox += (vx * over) / k;
      d.oy += (vy * over) / k;
      vx = (d.x - d.ox) * k;
      vy = (d.y - d.oy) * k;
    }
    if (Math.hypot(vx, vy) < DEAD_ZONE) game.setMove(0, 0);
    else game.setMove(vx / FULL_DRAG, vy / FULL_DRAG);
  };

  const onPick = (i: number) => {
    if (!game.pick(i)) return;
    sfx.buy();
    handleEvents();
    refresh();
  };

  const wave = game.waveIdx;
  const power = game.collected[wave];
  const goal = game.goal;
  const now = performance.now();
  const dark = run.persona === 'dark';
  const drag = dragRef.current;
  const rect = svgRef.current?.getBoundingClientRect();
  const kPx = rect && rect.width > 0 ? WIDTH / rect.width : 0;
  const owned = [...WEAPON_IDS, ...PASSIVE_IDS].filter((id) => (isWeapon(id) ? game.weapons[id] : game.passives[id]) > 0);
  const level = (id: PerkId) => (isWeapon(id) ? game.weapons[id] : game.passives[id]);
  const blink = game.invulnMs > 0 && Math.floor(game.invulnMs / 100) % 2 === 0;

  return (
    <div className="stage-play survivor-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 무대 서바이버
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
        <span className="survivor-hearts">
          {Array.from({ length: game.maxHearts }, (_, i) => (i < game.hearts ? '❤️' : '🖤')).join('')}
        </span>
      </div>
      <div className="survivor-meter" aria-hidden>
        <i style={{ width: `${Math.min(100, (power / goal) * 100)}%` }} />
      </div>
      <div className="survivor-power muted" aria-hidden>
        응원 {Math.round(power)} / {goal}
      </div>
      <div className="survivor-xp" aria-hidden>
        <b>Lv.{game.level}</b>
        <span>
          <i style={{ width: `${Math.min(100, (game.xp / game.xpNeed) * 100)}%` }} />
        </span>
      </div>

      <div className="survivor-field">
        <svg
          ref={svgRef}
          className="survivor-svg"
          viewBox={`0 0 ${WIDTH * U} ${HEIGHT * U}`}
          role="img"
          aria-label="무대. 손가락을 끌어서 움직이면 조명과 빔이 자동으로 드론을 쓰러뜨려요"
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 포인터 캡처를 못 써도 조작은 된다 */
            }
            if (!playable) return;
            dragRef.current = { ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            if (dragRef.current && playable) steer(e);
          }}
          onPointerUp={() => {
            dragRef.current = null;
            game.setMove(0, 0);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            game.setMove(0, 0);
          }}
        >
          <rect className="survivor-floor" x={0} y={0} width={WIDTH * U} height={HEIGHT * U} />
          {Array.from({ length: WIDTH - 1 }, (_, i) => (
            <line key={`v${i}`} className="survivor-grid" x1={(i + 1) * U} y1={0} x2={(i + 1) * U} y2={HEIGHT * U} />
          ))}
          {Array.from({ length: Math.floor(HEIGHT) }, (_, i) => (
            <line key={`h${i}`} className="survivor-grid" x1={0} y1={(i + 1) * U} x2={WIDTH * U} y2={(i + 1) * U} />
          ))}

          {game.gems.map((g, i) =>
            g.heart ? (
              <text key={i} className="sv-heart" x={g.x * U} y={g.y * U}>
                ❤️
              </text>
            ) : (
              <rect key={i} className={`sv-gem${g.value >= 4 ? ' sv-gem-big' : ''}`} x={g.x * U - 9} y={g.y * U - 9} width={18} height={18} transform={`rotate(45 ${g.x * U} ${g.y * U})`} />
            ),
          )}

          {game.enemies.map((e) => (
            <g key={e.id} className={`sv-enemy sv-${e.kind}${e.flashMs > 0 ? ' sv-hit' : ''}`} data-enemy={e.kind} transform={`translate(${(e.x * U).toFixed(1)} ${(e.y * U).toFixed(1)})`}>
              <circle r={e.radius * U} />
              <text className="sv-icon" style={{ fontSize: e.radius * U * 1.35 }}>
                {ENEMY_TEXT[e.kind].icon}
              </text>
              {e.maxHp >= 40 && e.hp < e.maxHp && <rect className="sv-bar" x={-e.radius * U} y={-e.radius * U - 12} width={Math.max(0, (e.hp / e.maxHp) * e.radius * U * 2)} height={6} rx={3} />}
            </g>
          ))}

          {game.shots.map((s, i) => (
            <circle key={i} className="sv-shot" cx={s.x * U} cy={s.y * U} r={B.enemies.elite.shotRadius * U} />
          ))}
          {game.bolts.map((b, i) => (
            <circle key={i} className="sv-bolt" cx={b.x * U} cy={b.y * U} r={B.weapons.spot.radius * U} />
          ))}
          {game.weapons.orbit > 0 &&
            Array.from({ length: B.weapons.orbit.count[game.weapons.orbit - 1] }, (_, i) => {
              const n = B.weapons.orbit.count[game.weapons.orbit - 1];
              const a = game.orbitAngle + (i / n) * Math.PI * 2;
              const r = B.weapons.orbit.radius[game.weapons.orbit - 1];
              return <circle key={i} className="sv-orbit" cx={(game.px + Math.cos(a) * r) * U} cy={(game.py + Math.sin(a) * r) * U} r={B.weapons.orbit.lightRadius * U} />;
            })}
          {beamsRef.current
            .filter((b) => now - b.t < LASER_MS)
            .map((b, i) => (
              <line key={i} className="sv-laser" x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} style={{ strokeWidth: B.weapons.laser.width * U, opacity: 1 - (now - b.t) / LASER_MS }} />
            ))}
          {ringsRef.current
            .filter((r) => now - r.t < BOOM_MS)
            .map((r, i) => (
              <circle key={i} className="sv-boom" cx={r.x} cy={r.y} r={r.r * (0.5 + (0.5 * (now - r.t)) / BOOM_MS)} style={{ opacity: 1 - (now - r.t) / BOOM_MS }} />
            ))}

          <g className={`sv-player${blink ? ' sv-blink' : ''}`} transform={`translate(${(game.px * U).toFixed(1)} ${(game.py * U).toFixed(1)})`}>
            <circle className="sv-magnet" r={game.magnetRadius * U} />
            <circle className="sv-body" r={PLAYER_R * U + 6} />
            <text className="sv-icon" style={{ fontSize: PLAYER_R * U * 1.6 }}>
              🎤
            </text>
          </g>

          {drag && kPx > 0 && (
            <g className="sv-stick" pointerEvents="none">
              <circle className="sv-stick-ring" cx={WIDTH * U - 90} cy={HEIGHT * U - 90} r={MAX_DRAG * U * 0.5} />
              <circle
                className="sv-stick-knob"
                cx={WIDTH * U - 90 + Math.max(-1, Math.min(1, ((drag.x - drag.ox) * kPx) / MAX_DRAG)) * MAX_DRAG * U * 0.5}
                cy={HEIGHT * U - 90 + Math.max(-1, Math.min(1, ((drag.y - drag.oy) * kPx) / MAX_DRAG)) * MAX_DRAG * U * 0.5}
                r={22}
              />
            </g>
          )}
        </svg>
        {banner && (
          <div key={banner.id} className={`survivor-banner survivor-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>손가락(마우스)을 끌어서 움직여요. 조명과 빔은 자동으로 나가요</small>
          </div>
        )}
        {game.picking && (
          <div className="survivor-pick" role="dialog" aria-label="퍼크 고르기">
            <h3>퍼크를 하나 골라요</h3>
            <p className="muted">공연 시간은 멈춰 있어요.</p>
            <div className="survivor-offers">
              {game.offers.map((id, i) => (
                <button key={id} type="button" className="survivor-offer" onClick={() => onPick(i)} aria-label={`${PERK_TEXT[id].name} 고르기`}>
                  <span className="survivor-offer-icon" aria-hidden>
                    {PERK_TEXT[id].icon}
                  </span>
                  <strong>{PERK_TEXT[id].name}</strong>
                  <small>{PERK_TEXT[id].desc}</small>
                  <small className="muted">{level(id) === 0 ? '새로 얻어요' : `Lv.${level(id)} → Lv.${level(id) + 1}${level(id) + 1 >= perkMax(id) ? ' (최대)' : ''}`}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {ended && (
          <div className={`run-end ${ended === 'cleared' ? 'run-end-win' : ''}`} role="status">
            {ended === 'cleared' ? '공연 성공!' : game.died ? '무대에서 쓰러졌어요…' : '공연 끝…'}
          </div>
        )}
        {paused && (
          <div className="pause-note" role="status">
            ⏸ 일시정지 — 돌아오면 이어서 진행돼요
          </div>
        )}
      </div>

      <div className="survivor-perks" aria-label="가진 퍼크">
        {owned.length === 0 ? (
          <span className="muted">레벨이 오르거나 곡이 끝날 때마다 퍼크를 하나 골라요</span>
        ) : (
          owned.map((id) => (
            <span key={id} className="survivor-perk" title={PERK_TEXT[id].desc}>
              {PERK_TEXT[id].icon} {PERK_TEXT[id].name} {level(id)}
            </span>
          ))
        )}
      </div>

      <p className="muted survivor-hint">
        손가락(마우스)을 끌면 그 방향으로 움직여요(키보드는 방향키·WASD). 드론에 닿으면 하트가 줄어요. 쓰러진 드론이 떨어뜨린 💎 응원을 주워서 곡마다 열기 목표를 채워요. 응원이 쌓이면 레벨이 오르고, 곡이 끝나도 퍼크를 골라요.
        {dark && ' 🚁 엘리트 드론은 멀리서 폭죽 탄막을 쏴요.'}
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
