import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { HECKLER, MergeGame, SIZE, colorOf, levelOf, type EffectId } from '../game/merge';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import type { Persona } from '../game/types';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';

const M = BALANCE.merge;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 900;
const TICK_MS = 100;
const BANNER_MS = 1300;
export const SET_NAMES = ['1곡', '2곡', '3곡', '앙코르'];
const COLOR_NAMES: Record<Persona, string[]> = { normal: ['분홍', '파랑', '노랑'], dark: ['자홍', '보라', '주황'] };

/** 이펙터 이름·설명. 수치는 balance.ts에서 읽는다. */
export const EFFECT_TEXT: Record<EffectId, { icon: string; name: string; desc: string }> = {
  amp: { icon: '🔊', name: '앰프', desc: `합칠 때 응원 파워 +${Math.round(M.effects.ampStep * 100)}%` },
  light: { icon: '💡', name: '조명', desc: `이후 곡마다 시간 +${M.effects.lightMs / 1000}초` },
  chorus: { icon: '🎶', name: '코러스', desc: `새로 채워지는 응원봉이 ${Math.round(M.effects.chorusStep * 100)}% 확률로 2단계로 나와요` },
  chain: { icon: '⛓️', name: '체인 증폭기', desc: `연쇄 보너스가 +${M.effects.chainBoost}씩 커져요` },
  pair: { icon: '🤝', name: '작은 합창', desc: `2개만 붙어도 합칠 수 있어요(파워 ×${M.effects.pairPower})` },
};

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

interface Pop {
  id: number;
  text: string;
  cell: number;
}

const tokenLabel = (v: number, persona: Persona): string =>
  v === HECKLER ? '야유꾼' : `${COLOR_NAMES[persona][colorOf(v) - 1]} ${levelOf(v)}단계 응원봉`;

export function MergePlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<MergeGame | null>(null);
  if (!gameRef.current) gameRef.current = new MergeGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const idRef = useRef(0);
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [miss, setMiss] = useState<{ id: number; cell: number } | null>(null);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림으로 옮긴다 */
  const handleEvents = useCallback(() => {
    for (const e of game.events.splice(0)) {
      if (e.type === 'merge') {
        if (e.level > M.maxLevel) sfx.album();
        else sfx.clear(e.level - 1);
        if (e.chain > 0) say(`연쇄 ×${e.chain + 1}!`, 'good');
      } else if (e.type === 'heckle') {
        sfx.buy();
        say(`야유꾼 ${e.cells.length}명 퇴치!`, 'good');
      } else if (e.type === 'miss') {
        sfx.fail();
        setMiss({ id: ++idRef.current, cell: e.cell });
      } else if (e.type === 'reshuffle') {
        say('조명이 바뀌었어요! 응원봉이 섞였어요', 'info');
      } else if (e.type === 'pick') {
        sfx.unlock();
      } else if (e.type === 'wave') {
        say(`${SET_NAMES[e.index]} 시작!`, 'info');
      }
    }
  }, [game, say]);

  // 공연 시계: 카운트다운 뒤 실제 경과 시간을 엔진에 넣는다(이펙터를 고르는 동안은 엔진이 시간을 세지 않는다)
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(now - last, 250);
      last = now;
      if (pausedRef.current || game.over) return;
      if (!startedRef.current) {
        countRef.current -= dt;
        setCountdown(countRef.current);
        if (countRef.current <= 0) startedRef.current = true;
        return;
      }
      game.advance(dt);
      handleEvents();
      refresh();
      if (game.over) setEnded(game.cleared ? 'cleared' : 'failed');
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [game, handleEvents, refresh]);

  // 알림·점수 글자는 잠깐 보여준 뒤 지운다
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner((b) => (b && b.id === banner.id ? null : b)), BANNER_MS);
    return () => window.clearTimeout(id);
  }, [banner]);
  useEffect(() => {
    if (!pop) return;
    const id = window.setTimeout(() => setPop((p) => (p && p.id === pop.id ? null : p)), 900);
    return () => window.clearTimeout(id);
  }, [pop]);
  useEffect(() => {
    if (!miss) return;
    const id = window.setTimeout(() => setMiss((m) => (m && m.id === miss.id ? null : m)), 350);
    return () => window.clearTimeout(id);
  }, [miss]);

  // 끝나면 잠깐 보여준 뒤 결과를 확정한다. 그 사이 포기하면 이 타이머도 함께 사라진다.
  useEffect(() => {
    if (!ended) return;
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, { merge: game.summary });
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

  const onTap = (cell: number) => {
    if (!playable) return;
    const res = game.tap(Math.floor(cell / SIZE), cell % SIZE);
    if (res.ok) {
      setPop({ id: ++idRef.current, cell, text: `+${Math.round(res.gained)}${res.combo >= 2 ? ` · 콤보 ${res.combo}` : ''}` });
    }
    handleEvents();
    refresh();
  };

  const onPick = (i: number) => {
    if (!game.pick(i)) return;
    sfx.buy();
    handleEvents();
    refresh();
  };

  const mergeable = game.mergeable;
  const picking = game.picking;
  const wave = game.waveIdx;
  const power = game.wavePower[wave];
  const goal = game.goal;
  const have = (Object.keys(game.effects) as EffectId[]).filter((id) => game.effects[id] > 0);

  return (
    <div className="stage-play merge-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 응원봉 머지 웨이브
          </div>
        </div>
        <div className="stage-score" aria-live="off">
          <span>열기 점수</span>
          <strong>{game.score}</strong>
          <small>
            {SET_NAMES[wave]} {wave + 1}/{M.waves.length}
          </small>
        </div>
      </header>

      <div className="run-hud" aria-hidden>
        <span>
          {SET_NAMES[wave]} · {Math.ceil(game.remainingMs / 1000)}초
        </span>
        <span className="merge-combo">{game.combo >= 2 ? `콤보 ${game.combo}` : ''}</span>
      </div>
      <div className="merge-meter" aria-hidden>
        <i style={{ width: `${Math.min(100, (power / goal) * 100)}%` }} />
      </div>
      <div className="merge-power muted" aria-hidden>
        응원 파워 {Math.round(power)} / {goal}
      </div>

      <div className="merge-field">
        <div className="merge-board" role="grid" aria-label="무대 응원봉">
          {Array.from(game.board).map((v, i) => {
            const cls = ['mc'];
            if (v === HECKLER) cls.push('mc-heckler');
            else cls.push(`mc-c${colorOf(v)}`, `mc-l${levelOf(v)}`);
            if (mergeable.has(i)) cls.push('can');
            if (miss?.cell === i) cls.push('mc-miss');
            return (
              <button key={i} type="button" className={cls.join(' ')} role="gridcell" onClick={() => onTap(i)} disabled={!playable} aria-label={tokenLabel(v, run.persona)}>
                {v === HECKLER ? '🗯' : <b>{levelOf(v)}</b>}
              </button>
            );
          })}
        </div>
        {pop && (
          <div key={pop.id} className="merge-pop" role="status" style={{ left: `${((pop.cell % SIZE) + 0.5) * (100 / SIZE)}%`, top: `${(Math.floor(pop.cell / SIZE) + 0.5) * (100 / SIZE)}%` }}>
            {pop.text}
          </div>
        )}
        {banner && (
          <div key={banner.id} className={`merge-banner merge-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>같은 색·같은 단계 3개 이상이 붙은 응원봉을 눌러 합쳐요</small>
          </div>
        )}
        {picking && (
          <div className="merge-pick" role="dialog" aria-label="이펙터 고르기">
            <h3>
              {SET_NAMES[wave]} 끝! 열기 목표 {Math.round(game.waveRatio(wave) * 100)}%
            </h3>
            <p className="muted">이펙터를 하나 골라요. 공연 시간은 멈춰 있어요.</p>
            <div className="merge-offers">
              {game.offers.map((id, i) => (
                <button key={id} type="button" className="merge-offer" onClick={() => onPick(i)} aria-label={`${EFFECT_TEXT[id].name} 고르기`}>
                  <span className="merge-offer-icon" aria-hidden>
                    {EFFECT_TEXT[id].icon}
                  </span>
                  <strong>{EFFECT_TEXT[id].name}</strong>
                  <small>{EFFECT_TEXT[id].desc}</small>
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

      <div className="merge-effects" aria-label="고른 이펙터">
        {have.length === 0 ? (
          <span className="muted">곡이 끝날 때마다 이펙터를 하나 골라요</span>
        ) : (
          have.map((id) => (
            <span key={id} className="merge-effect" title={EFFECT_TEXT[id].desc}>
              {EFFECT_TEXT[id].icon} {EFFECT_TEXT[id].name}
              {game.effects[id] > 1 ? ` ×${game.effects[id]}` : ''}
            </span>
          ))
        )}
      </div>

      <p className="muted merge-hint">
        같은 색·같은 단계가 {game.minGroup}개 이상 붙어 있으면(깜박이는 응원봉) 눌러서 한 단계 위로 합쳐요. 5개 이상이면 두 단계를 뛰어올라요. 합친 응원봉이 같은 단계와 붙으면 연쇄!
        {run.persona === 'dark' && ' 🗯 야유꾼은 합칠 수 없고, 판에 있는 동안 응원이 묻혀요. 합친 응원봉 옆에 있으면 사라져요.'}
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
