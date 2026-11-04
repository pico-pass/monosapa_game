import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { BlackoutGame, LANES } from '../game/blackout';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.blackout;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 1000;
const BANNER_MS = 1300;
const FLASH_MS = 450;
/** 그림 좌표: 레인 하나의 폭 */
const LW = 100;
const W = LW * LANES;
const H = 600;
const HIT_Y = 500;
const TOP_Y = 20;
const NOTE_H = 26;
const LANE_KEYS = ['d', 'f', 'j', 'k'];
const LANE_COLORS = ['#ff6fa5', '#5aa9ff', '#ffd24a', '#7be0a0'];
const JUDGE_TEXT = { perfect: 'PERFECT', good: 'GOOD' } as const;

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

interface Flash {
  id: number;
  lane: number;
  text: string;
  kind: 'perfect' | 'good' | 'miss' | 'stray';
  at: number;
}

export function BlackoutPlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<BlackoutGame | null>(null);
  if (!gameRef.current) gameRef.current = new BlackoutGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
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
  const [pressed, setPressed] = useState<number | null>(null);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·표시로 옮긴다 */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    for (const e of evs) {
      if (e.type === 'beat') sfx.beat(e.strong);
      else if (e.type === 'hit') {
        sfx.judge(e.judge);
        setFlash({ id: ++idRef.current, lane: e.lane, text: JUDGE_TEXT[e.judge], kind: e.judge, at: performance.now() });
      } else if (e.type === 'miss') setFlash({ id: ++idRef.current, lane: e.lane, text: 'MISS', kind: 'miss', at: performance.now() });
      else if (e.type === 'stray') setFlash({ id: ++idRef.current, lane: e.lane, text: '헛손질', kind: 'stray', at: performance.now() });
      else if (e.type === 'waveEnd') say(`${SET_NAMES[e.index]} 끝! 달성 ${Math.round(e.ratio * 100)}%`, e.ratio >= 0.6 ? 'good' : 'bad');
      else if (e.type === 'wave') say(`${SET_NAMES[e.index]} 시작!`, 'info');
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
      finishManualConcertRun(run.id, game.score, { blackout: game.summary });
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
  const playable = started && !paused && game.status === 'running';

  /** 레인 입력: 누른 순간까지 시계를 먼저 맞춘 뒤 판정한다 */
  const press = useCallback(
    (lane: number) => {
      if (!startedRef.current || pausedRef.current || game.over) return;
      const now = performance.now();
      game.advance(Math.min(now - lastRef.current, 100));
      lastRef.current = now;
      game.tap(lane);
      handleEvents();
      setPressed(lane);
      window.setTimeout(() => setPressed((p) => (p === lane ? null : p)), 90);
      refresh();
    },
    [game, handleEvents, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const i = LANE_KEYS.indexOf(e.key.toLowerCase());
      const n = ['1', '2', '3', '4'].indexOf(e.key);
      const lane = i >= 0 ? i : n;
      if (lane >= 0) {
        e.preventDefault();
        press(lane);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const wave = game.waveIdx;
  const ratio = game.waveRatio(wave);
  const look = game.lookAheadMs;
  const lookPx = Math.min(1, look / B.travelMs) * (HIT_Y - TOP_Y);
  const now = performance.now();
  const flashOn = flash && now - flash.at < FLASH_MS ? flash : null;

  // 어둠 속에서 보이는 노트: 판정선까지 look(ms) 안으로 들어온 것만
  const visible = game.notes.filter((n) => {
    const d = n.t - game.waveMs;
    return n.result === null && d <= look && d > -B.goodMs;
  });

  return (
    <div className="stage-play blackout-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 정전 속 박자
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
        <span className="blackout-combo">콤보 {game.combo} · 시야 {(look / 1000).toFixed(2)}초</span>
      </div>
      <div className="blackout-meter" aria-hidden>
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="blackout-power muted" aria-hidden>
        이번 곡 달성 {Math.round(ratio * 100)}% · 박자 {B.bpm[wave]}
      </div>

      <div className="blackout-field">
        <svg viewBox={`0 0 ${W} ${H}`} className="blackout-svg" role="img" aria-label="정전된 무대 위로 내려오는 노트">
          <defs>
            <radialGradient id="bo-light" cx="50%" cy="100%" r="100%">
              <stop offset="0%" stopColor="#ffe9a8" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#ffe9a8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={W} height={H} fill="#07050f" />
          {/* 시야: 판정선에서 위로 퍼지는 불빛 */}
          <rect x={0} y={HIT_Y - lookPx} width={W} height={lookPx + 60} fill="url(#bo-light)" />
          {Array.from({ length: LANES }, (_, l) => (
            <g key={l}>
              <rect x={l * LW + 4} y={TOP_Y} width={LW - 8} height={HIT_Y - TOP_Y + 50} fill="rgba(255,255,255,0.025)" rx={10} />
              <rect x={l * LW + 6} y={HIT_Y - NOTE_H / 2 - 3} width={LW - 12} height={NOTE_H + 6} rx={9} fill="none" stroke={LANE_COLORS[l]} strokeOpacity={pressed === l ? 1 : 0.4} strokeWidth={pressed === l ? 5 : 3} />
            </g>
          ))}
          {visible.map((n) => {
            const d = n.t - game.waveMs;
            const y = HIT_Y - (d / B.travelMs) * (HIT_Y - TOP_Y);
            const a = Math.max(0, Math.min(1, (look - d) / 180));
            return <rect key={`${wave}-${n.t}-${n.lane}`} x={n.lane * LW + 10} y={y - NOTE_H / 2} width={LW - 20} height={NOTE_H} rx={9} fill={LANE_COLORS[n.lane]} opacity={a} />;
          })}
          {flashOn && (
            <text key={flashOn.id} x={flashOn.lane * LW + LW / 2} y={HIT_Y - 40} textAnchor="middle" className={`blackout-flash blackout-flash-${flashOn.kind}`}>
              {flashOn.text}
            </text>
          )}
        </svg>
        {banner && (
          <div key={banner.id} className={`blackout-banner blackout-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>정전! 박자음을 듣고 판정선 가까이 온 노트를 쳐요</small>
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

      <div className="blackout-pads" role="group" aria-label="레인">
        {Array.from({ length: LANES }, (_, l) => (
          <button
            key={l}
            type="button"
            className={`blackout-pad ${pressed === l ? 'blackout-pad-on' : ''}`}
            style={{ borderColor: LANE_COLORS[l] }}
            disabled={!playable}
            onPointerDown={(e) => {
              e.preventDefault();
              press(l);
            }}
            aria-label={`${l + 1}번 레인 (${LANE_KEYS[l].toUpperCase()})`}
          >
            {LANE_KEYS[l].toUpperCase()}
          </button>
        ))}
      </div>

      <p className="muted blackout-hint">
        불이 나가서 노트가 안 보여요. 박자음에 맞춰 판정선에 가까이 온 노트를 레인 버튼(키보드 D F J K)으로 쳐요. 콤보가 쌓일수록 멀리까지 보이고, 헛손질하면 콤보가 끊겨요.
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
