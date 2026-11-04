import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { COLS, StonesGame, type BeatGrade, type Cell } from '../game/stones';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.stones;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 1000;
const BANNER_MS = 1200;
const FLASH_MS = 600;
/** 그림 좌표 */
const CW = 120;
const W = CW * COLS;
const ROW_H = 76;
const H = 608;
/** 내 줄이 화면에서 놓이는 높이(아래에서 두 줄 위) */
const PLAYER_Y = H - 2 * ROW_H + ROW_H / 2;
const BELOW = 3;
const ABOVE = 7;

const GRADE_TEXT: Record<BeatGrade, string> = { perfect: 'PERFECT', good: 'GOOD', off: '삐끗' };

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

interface Flash {
  id: number;
  text: string;
  grade: BeatGrade;
  at: number;
}

const cx = (col: number): number => col * CW + CW / 2;
const worldY = (row: number): number => -row * ROW_H;

function CellView({ cell, col, row }: { cell: Cell; col: number; row: number }) {
  if (cell === 'water') return null;
  const x = cx(col);
  const y = worldY(row);
  return (
    <g>
      <ellipse cx={x} cy={y} rx={46} ry={26} fill={cell === 'lotus' ? '#3f8f6a' : '#7d7a8a'} stroke="#2a2438" strokeWidth={4} />
      {cell === 'lotus' && (
        <text x={x} y={y + 12} textAnchor="middle" fontSize={34}>
          🪷
        </text>
      )}
      {cell === 'fire' && (
        <text x={x} y={y + 12} textAnchor="middle" fontSize={34}>
          🔥
        </text>
      )}
    </g>
  );
}

export function StonesPlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<StonesGame | null>(null);
  if (!gameRef.current) gameRef.current = new StonesGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const lastRef = useRef(performance.now());
  const idRef = useRef(0);
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·표시로 옮긴다 */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    for (const e of evs) {
      if (e.type === 'beat') sfx.beat(e.strong);
      else if (e.type === 'hop') {
        sfx.judge(e.grade === 'off' ? 'miss' : e.grade);
        if (e.lotus) sfx.jelly();
        setFlash({ id: ++idRef.current, text: `${GRADE_TEXT[e.grade]}${e.points > 0 ? ` +${e.points}` : ''}`, grade: e.grade, at: performance.now() });
      } else if (e.type === 'splash') {
        sfx.fail();
        say('💦 풍덩!', 'bad');
      } else if (e.type === 'burn') {
        sfx.fail();
        say('🔥 도깨비불!', 'bad');
      } else if (e.type === 'swept') {
        sfx.fail();
        say('🌊 물살에 쓸렸어요!', 'bad');
      } else if (e.type === 'waveEnd') say(`${SET_NAMES[e.index]} 끝! 달성 ${Math.round(e.ratio * 100)}%`, e.ratio >= 0.6 ? 'good' : 'bad');
      else if (e.type === 'wave') say(`${SET_NAMES[e.index]} 시작! 박자가 빨라져요`, 'info');
    }
  }, [game, say]);

  // 공연 시계: 카운트다운 뒤 실제 경과 시간을 엔진에 넣는다
  useEffect(() => {
    let raf = 0;
    lastRef.current = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - lastRef.current, 100);
      lastRef.current = now;
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

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner((b) => (b && b.id === banner.id ? null : b)), BANNER_MS);
    return () => window.clearTimeout(id);
  }, [banner]);

  // 끝나면 잠깐 보여준 뒤 결과를 확정한다. 그 사이 포기하면 이 타이머도 함께 사라진다.
  useEffect(() => {
    if (!ended) return;
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, { stones: game.summary });
    }, END_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [ended, game, run.id]);

  // 탭 숨김: 공연을 멈추고 복귀하면 이어서 한다.
  useEffect(() => {
    const onVis = () => {
      pausedRef.current = document.hidden;
      setPaused(document.hidden);
      lastRef.current = performance.now();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const started = countdown <= 0;

  /** 뛰기: 누른 순간까지 시계를 먼저 맞춘 뒤 박자를 판정한다 */
  const hop = useCallback(
    (col: number) => {
      if (!startedRef.current || pausedRef.current || game.over) return;
      const now = performance.now();
      game.advance(Math.min(now - lastRef.current, 100));
      lastRef.current = now;
      game.hop(col);
      handleEvents();
      if (game.over) setEnded(game.cleared ? 'cleared' : 'failed');
      refresh();
    },
    [game, handleEvents, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') hop(game.col - 1);
      else if (k === 'arrowright' || k === 'd') hop(game.col + 1);
      else if (k === 'arrowup' || k === 'w' || k === ' ') hop(game.col);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, hop]);

  const onFieldDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.max(0, Math.min(COLS - 1, Math.floor(((e.clientX - rect.left) / rect.width) * COLS)));
    hop(col);
  };

  const wave = game.waveIdx;
  const ratio = game.waveRatio(wave);
  const now = performance.now();
  const flashOn = flash && now - flash.at < FLASH_MS ? flash : null;
  const beat = game.beatMs;
  const phase = game.waveMs % beat;
  const toNext = (beat - phase) / beat;
  const grade = game.grade;

  const offset = PLAYER_Y + game.row * ROW_H;
  const rowsShown: number[] = [];
  for (let r = Math.max(0, game.row - BELOW); r <= game.row + ABOVE && r < game.rows.length; r++) rowsShown.push(r);

  return (
    <div className="stage-play stones-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 삼도천 징검다리
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
          {SET_NAMES[wave]} · {Math.ceil(game.remainingMs / 1000)}초 · {B.bpm[wave]}bpm
        </span>
        <span className="stones-hearts">
          {'❤️'.repeat(Math.max(0, game.hearts))}
          {'🖤'.repeat(Math.max(0, B.hearts - game.hearts))}
        </span>
      </div>
      <div className="stones-meter" aria-hidden>
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="stones-power muted" aria-hidden>
        이번 곡 점수 {game.points[wave]} / 목표 {game.goal} · 물살 {Math.max(0, Math.floor(game.gap))}칸 뒤 · 박자 연속 {game.streak}
      </div>

      <div className="stones-field" onPointerDown={onFieldDown} role="group" aria-label="삼도천 징검다리 (칸을 눌러 뛰기)">
        <svg viewBox={`0 0 ${W} ${H}`} className="stones-svg" aria-hidden>
          <rect x={0} y={0} width={W} height={H} fill="#12203f" />
          <g style={{ transform: `translateY(${offset}px)`, transition: 'transform 0.12s ease-out' }}>
            {rowsShown.map((r) => (
              <g key={r}>
                <rect x={0} y={worldY(r) - ROW_H / 2} width={W} height={ROW_H} fill={r % 2 === 0 ? 'rgba(80,120,200,0.10)' : 'rgba(80,120,200,0.04)'} />
                {game.rows[r].map((cell, c) => (
                  <CellView key={c} cell={cell} col={c} row={r} />
                ))}
              </g>
            ))}
            {/* 쫓아오는 삼도천 물 */}
            <rect x={0} y={worldY(game.waterRow)} width={W} height={ROW_H * 12} fill="rgba(10,16,48,0.88)" />
            <rect x={0} y={worldY(game.waterRow) - 6} width={W} height={10} fill="rgba(120,170,255,0.5)" />
            <g style={{ transform: `translate(${cx(game.col)}px, ${worldY(game.row)}px)`, transition: 'transform 0.1s ease-out' }}>
              <text x={0} y={14} textAnchor="middle" fontSize={44} opacity={game.stunned ? 0.55 : 1}>
                🎤
              </text>
            </g>
          </g>
          {flashOn && (
            <text key={flashOn.id} x={W / 2} y={PLAYER_Y - 56} textAnchor="middle" className={`stones-flash stones-flash-${flashOn.grade}`}>
              {flashOn.text}
            </text>
          )}
        </svg>
        <div
          className={`stones-beat ${grade === 'perfect' ? 'stones-beat-perfect' : grade === 'good' ? 'stones-beat-good' : ''}`}
          style={{ ['--ring' as string]: String(1 + toNext * 1.1) }}
          aria-hidden
        >
          <b />
        </div>
        {banner && (
          <div key={banner.id} className={`stones-banner stones-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>박자에 맞춰 돌을 눌러 앞으로 건너요</small>
          </div>
        )}
        {ended && (
          <div className={`run-end ${ended === 'cleared' ? 'run-end-win' : ''}`} role="status">
            {ended === 'cleared' ? '공연 성공!' : game.died ? '물에 잠겼어요…' : '공연 끝…'}
          </div>
        )}
        {paused && (
          <div className="pause-note" role="status">
            ⏸ 일시정지 — 돌아오면 이어서 진행돼요
          </div>
        )}
      </div>

      <p className="muted stones-hint">
        앞 줄의 돌(🪨)을 눌러 한 줄씩 건너요. 한 번에 옆 칸까지만 갈 수 있고, 물은 풍덩, 도깨비불은 따끔해요. 오른쪽 위 링이 가운데 점에 닿는 순간 누르면 PERFECT! 박자를 놓치면 점수가 깎여요. 🪷 연꽃은 보너스예요. (키보드: ← ↑ →)
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
