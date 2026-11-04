import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { ChatSwipeGame, RULE_TEXT } from '../game/chatswipe';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.swipe;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 1000;
const BANNER_MS = 1100;
/** 이만큼(px) 넘기면 수락/차단으로 친다 */
const SWIPE_PX = 70;

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

export function SwipePlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<ChatSwipeGame | null>(null);
  if (!gameRef.current) gameRef.current = new ChatSwipeGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const idRef = useRef(0);
  const dragRef = useRef<{ id: number; x0: number } | null>(null);
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dx, setDx] = useState(0);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림으로 옮긴다 */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    for (const e of evs) {
      if (e.type === 'right') {
        sfx.judge('good');
        if (e.combo >= 5 && e.combo % 5 === 0) say(`🔥 ${e.combo}연속!`, 'good');
      } else if (e.type === 'wrong') {
        sfx.fail();
        say(e.why ? `✘ ${RULE_TEXT[e.why]}!` : '✘ 멀쩡한 글이었어요', 'bad');
      } else if (e.type === 'timeout') {
        sfx.fail();
        say('⏱ 놓쳤어요', 'bad');
      } else if (e.type === 'waveEnd') say(`${SET_NAMES[e.index]} 끝! 달성 ${Math.round(e.ratio * 100)}%`, e.ratio >= 0.6 ? 'good' : 'bad');
      else if (e.type === 'wave') say(`${SET_NAMES[e.index]}: 새 규칙!`, 'info');
    }
  }, [game, say]);

  // 공연 시계: 카운트다운 뒤 실제 경과 시간을 엔진에 넣는다
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

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner((b) => (b && b.id === banner.id ? null : b)), BANNER_MS);
    return () => window.clearTimeout(id);
  }, [banner]);

  // 끝나면 잠깐 보여준 뒤 결과를 확정한다. 그 사이 포기하면 이 타이머도 함께 사라진다.
  useEffect(() => {
    if (!ended) return;
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, { swipe: game.summary });
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

  const started = countdown <= 0;
  const playable = started && !paused && game.status === 'running';

  const answer = useCallback(
    (accept: boolean) => {
      if (!startedRef.current || pausedRef.current) return;
      if (game.answer(accept)) handleEvents();
      dragRef.current = null;
      setDx(0);
      refresh();
    },
    [game, handleEvents, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') {
        e.preventDefault();
        answer(false);
      } else if (k === 'arrowright' || k === 'd') {
        e.preventDefault();
        answer(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!playable || !game.msg) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { id: e.pointerId, x0: e.clientX };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setDx(e.clientX - d.x0);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const moved = e.clientX - d.x0;
    dragRef.current = null;
    if (Math.abs(moved) >= SWIPE_PX) answer(moved > 0);
    else setDx(0);
  };

  const wave = game.waveIdx;
  const ratio = game.waveRatio(wave);
  const msg = game.msg;
  const timeLeft = msg ? Math.max(0, game.leftMs / game.limitMs) : 0;
  const rules = game.rules;
  const lean = dx > 20 ? 'right' : dx < -20 ? 'left' : null;

  return (
    <div className="stage-play swipe-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 후원 채팅 스와이프
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
        <span className="swipe-combo">콤보 {game.combo}</span>
      </div>
      <div className="swipe-meter" aria-hidden>
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="swipe-power muted" aria-hidden>
        이번 곡 열기 {game.heat[wave].toFixed(1)} / 목표 {game.goal}
      </div>

      <ul className="swipe-rules" aria-label="이번 곡 검열 규칙">
        {rules.map((r, i) => (
          <li key={r} className={i === rules.length - 1 && wave > 0 ? 'swipe-rule-new' : ''}>
            🚫 {RULE_TEXT[r]}
          </li>
        ))}
      </ul>

      <div className="swipe-field">
        <div className="swipe-side swipe-side-left" aria-hidden>
          ◀ 차단
        </div>
        <div className="swipe-side swipe-side-right" aria-hidden>
          수락 ▶
        </div>
        {msg ? (
          <div
            key={msg.id}
            className={`swipe-card ${lean ? `swipe-card-${lean}` : ''}`}
            style={{ transform: `translateX(${dx}px) rotate(${dx / 18}deg)`, transition: dx === 0 ? 'transform 0.15s' : 'none' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="group"
            aria-label={`${msg.nick}: ${msg.text}`}
          >
            <div className="swipe-nick">
              {msg.nick}
              {msg.badge === 'fan' && <span className="swipe-badge swipe-badge-fan">💜 팬클럽</span>}
              {msg.badge === 'fake' && <span className="swipe-badge swipe-badge-fake">🎖 공식 · 미인증</span>}
            </div>
            <p className="swipe-text">{msg.text}</p>
            <div className="swipe-chips">
              {msg.link && <span className="swipe-chip">🔗 링크</span>}
              {msg.amount > 0 && <span className="swipe-chip">💰 {msg.amount.toLocaleString()}원</span>}
            </div>
            <div className="swipe-time" aria-hidden>
              <i style={{ width: `${timeLeft * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="swipe-card swipe-card-empty" aria-hidden>
            …
          </div>
        )}
        {banner && (
          <div key={banner.id} className={`swipe-banner swipe-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>규칙에 걸리는 글은 왼쪽(차단), 나머지는 오른쪽(수락)으로 넘겨요</small>
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

      <div className="swipe-buttons">
        <button type="button" className="btn swipe-btn swipe-btn-block" disabled={!playable || !msg} onClick={() => answer(false)} aria-label="차단 (←)">
          🚫 차단
        </button>
        <button type="button" className="btn swipe-btn swipe-btn-accept" disabled={!playable || !msg} onClick={() => answer(true)} aria-label="수락 (→)">
          ✅ 수락
        </button>
      </div>

      <p className="muted swipe-hint">
        글을 오른쪽으로 밀면 수락, 왼쪽으로 밀면 차단이에요(방향키도 돼요). 위 규칙에 걸리는 글만 막고, 규칙에 없는 특징은 그냥 받아요. 곡이 바뀔 때마다 규칙이 늘어나요.
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
