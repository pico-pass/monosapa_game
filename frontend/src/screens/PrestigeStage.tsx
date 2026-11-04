import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { fmt } from '../components/format';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { GEN_COUNT, PERK_IDS, PrestigeGame, UPGRADE_IDS, type PerkId, type UpgradeId } from '../game/prestige';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.prestige;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 1000;
const BANNER_MS = 1300;

/** 대륙 응원단 이름 */
export const GEN_TEXT = [
  { icon: '🏯', name: '아시아 응원단' },
  { icon: '🏰', name: '유럽 응원단' },
  { icon: '🗽', name: '아메리카 응원단' },
  { icon: '🦁', name: '아프리카 응원단' },
  { icon: '🦘', name: '오세아니아 응원단' },
] as const;

export const UPGRADE_TEXT: Record<UpgradeId, { icon: string; name: string; desc: string }> = {
  tap: { icon: '🎤', name: '탭 강화', desc: `탭 ×${B.upgrades.tap.mult}` },
  choir: { icon: '📣', name: '합창', desc: `자동 생산 ×${B.upgrades.choir.mult}` },
};

/** 영구 퍼크 이름·설명. 수치는 balance.ts에서 읽는다. */
export const PRESTIGE_PERK_TEXT: Record<PerkId, { icon: string; name: string; desc: string }> = {
  tapx: { icon: '🎤', name: '팬서비스', desc: `탭 한 번의 팬 ×${B.perks.tapx.mult}` },
  autox: { icon: '🌍', name: '월드 응원단', desc: `자동으로 느는 팬 ×${B.perks.autox.mult}` },
  seed: { icon: '💰', name: '후원금', desc: `곡을 시작할 때 팬 ${B.perks.seed.fans.join(' / ')}명으로 시작(겹칠 때마다 한 단계)` },
  discount: { icon: '🏷️', name: '할인', desc: `응원단·강화 비용 ×${B.perks.discount.mult}` },
  luck: { icon: '🌟', name: '단골 스포트라이트', desc: `월드 스포트라이트가 더 자주·${B.perks.luck.lifeMs / 1000}초 더 오래 뜨고 보상 +${Math.round(B.perks.luck.reward * 100)}%` },
  star: { icon: '✨', name: '별빛 증폭', desc: `곡이 끝날 때 얻는 별빛 +${Math.round(B.perks.star.amp * 100)}%` },
};

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

export function PrestigePlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<PrestigeGame | null>(null);
  if (!gameRef.current) gameRef.current = new PrestigeGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const idRef = useRef(0);
  const sfxAtRef = useRef({ tap: 0 });
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림으로 옮긴다 */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    for (const e of evs) {
      if (e.type === 'tap') {
        const now = performance.now();
        if (now - sfxAtRef.current.tap > 60) {
          sfxAtRef.current.tap = now;
          sfx.tick();
        }
      } else if (e.type === 'buy') sfx.buy();
      else if (e.type === 'goldenOn') say('🌟 월드 스포트라이트!', 'good');
      else if (e.type === 'goldenCatch') {
        sfx.clear(3);
        say(`🌟 +${fmt(e.reward)}명!`, 'good');
      } else if (e.type === 'pick') sfx.unlock();
      else if (e.type === 'waveEnd') say(`${SET_NAMES[e.index]} 끝! 팬 ${fmt(e.produced)}명`, e.ratio >= 0.6 ? 'good' : 'bad');
      else if (e.type === 'wave') say(`${SET_NAMES[e.index]} 시작!`, 'info');
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
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, { prestige: game.summary });
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

  const tap = () => {
    if (!playable || !game.tap()) return;
    handleEvents();
  };
  const buyGen = (i: number) => {
    if (playable && game.buyGen(i)) handleEvents();
  };
  const buyUp = (id: UpgradeId) => {
    if (playable && game.buyUpgrade(id)) handleEvents();
  };
  const catchGolden = () => {
    if (playable && game.catchGolden()) handleEvents();
  };
  const onPick = (i: number) => {
    if (!game.pick(i)) return;
    sfx.buy();
    handleEvents();
    refresh();
  };

  const wave = game.waveIdx;
  const dark = run.persona === 'dark';
  const ratio = game.waveRatio(wave);
  const golden = game.golden;
  const have = PERK_IDS.filter((id) => game.perks[id] > 0);
  const maxLife = B.golden.lifeMs + B.perks.luck.lifeMs * game.perks.luck;

  return (
    <div className="stage-play prestige-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 월드투어 인크리멘탈
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
        <span className="prestige-star">
          🌠 별빛 {game.stars} · 영구 배율 ×{game.mult.toFixed(2)}
        </span>
      </div>
      <div className="prestige-meter" aria-hidden>
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="prestige-power muted" aria-hidden>
        이번 곡 팬 {fmt(game.producedWave[wave])} / 목표 {fmt(game.goal)}
      </div>

      <div className="prestige-fans" aria-live="off">
        <strong>👥 {fmt(Math.floor(game.fans))}</strong>
        <small>초당 +{fmt(game.rate)}</small>
      </div>

      <div className="prestige-field">
        <button
          type="button"
          className="prestige-tap"
          onPointerDown={(e) => {
            e.preventDefault();
            tap();
          }}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              tap();
            }
          }}
          aria-label={`무대 누르기 (한 번에 팬 ${fmt(game.tapValue)}명)`}
        >
          <span className="prestige-globe" aria-hidden>
            🌍
          </span>
          <small>누를 때마다 +{fmt(game.tapValue)}명</small>
        </button>
        {golden && (
          <button
            type="button"
            className="prestige-golden"
            style={{ left: `clamp(34px, ${golden.x * 100}%, calc(100% - 34px))`, top: `clamp(34px, ${golden.y * 100}%, calc(100% - 34px))` }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              catchGolden();
            }}
            aria-label="월드 스포트라이트 잡기"
          >
            🌟
            <i style={{ width: `${Math.max(0, (golden.leftMs / maxLife) * 100)}%` }} />
          </button>
        )}
        {banner && (
          <div key={banner.id} className={`prestige-banner prestige-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>무대를 눌러 팬을 모으고, 응원단을 사서 자동으로 늘려요</small>
          </div>
        )}
        {game.picking && (
          <div className="prestige-pick" role="dialog" aria-label="영구 퍼크 고르기">
            <h3>
              {SET_NAMES[wave]} 끝! 팬 {fmt(game.lastProduced)}명
            </h3>
            <p className="muted">
              🌠 별빛 +{game.lastGain} → 영구 배율 ×{game.mult.toFixed(2)}. 팬과 응원단은 리셋돼요. 영구 퍼크를 하나 골라요.
            </p>
            <div className="prestige-offers">
              {game.offers.map((id, i) => (
                <button key={id} type="button" className="prestige-offer" onClick={() => onPick(i)} aria-label={`${PRESTIGE_PERK_TEXT[id].name} 고르기`}>
                  <span className="prestige-offer-icon" aria-hidden>
                    {PRESTIGE_PERK_TEXT[id].icon}
                  </span>
                  <strong>{PRESTIGE_PERK_TEXT[id].name}</strong>
                  <small>{PRESTIGE_PERK_TEXT[id].desc}</small>
                  {game.perks[id] > 0 && <small className="muted">지금 {game.perks[id]}겹</small>}
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

      <div className="prestige-shop" role="group" aria-label="응원단과 강화">
        {Array.from({ length: GEN_COUNT }, (_, i) => (
          <button
            key={i}
            type="button"
            className="prestige-item"
            disabled={!playable || !game.canBuyGen(i)}
            onClick={(e) => {
              buyGen(i);
              e.currentTarget.blur();
            }}
            aria-label={`${GEN_TEXT[i].name} 고용 (${fmt(game.genCost(i))})`}
          >
            <span aria-hidden>{GEN_TEXT[i].icon}</span>
            <strong>{GEN_TEXT[i].name}</strong>
            <small>
              {game.gens[i]}팀 · +{fmt(B.gens[i].out * game.autoMult)}/초
            </small>
            <b>{game.gens[i] >= B.genMax ? '최대' : fmt(game.genCost(i))}</b>
          </button>
        ))}
        {UPGRADE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="prestige-item prestige-item-up"
            disabled={!playable || !game.canBuyUpgrade(id)}
            onClick={(e) => {
              buyUp(id);
              e.currentTarget.blur();
            }}
            aria-label={`${UPGRADE_TEXT[id].name} (${fmt(game.upgradeCost(id))})`}
          >
            <span aria-hidden>{UPGRADE_TEXT[id].icon}</span>
            <strong>{UPGRADE_TEXT[id].name}</strong>
            <small>
              {game.ups[id]}/{B.upgrades[id].max} · {UPGRADE_TEXT[id].desc}
            </small>
            <b>{game.ups[id] >= B.upgrades[id].max ? '최대' : fmt(game.upgradeCost(id))}</b>
          </button>
        ))}
      </div>

      <div className="prestige-perks" aria-label="영구 퍼크">
        {have.length === 0 ? (
          <span className="muted">곡이 끝날 때마다 영구 퍼크를 하나 골라요</span>
        ) : (
          have.map((id) => (
            <span key={id} className="prestige-perk" title={PRESTIGE_PERK_TEXT[id].desc}>
              {PRESTIGE_PERK_TEXT[id].icon} {PRESTIGE_PERK_TEXT[id].name}
              {game.perks[id] > 1 ? ` ×${game.perks[id]}` : ''}
            </span>
          ))
        )}
      </div>

      <p className="muted prestige-hint">
        무대를 눌러 팬을 모으고, 팬으로 대륙 응원단을 사서 자동으로 늘려요. 🌟 월드 스포트라이트는 뜰 때 바로 눌러야 해요. 곡이 끝나면 팬과 응원단이 리셋되지만 만든 팬만큼 별빛(영구 배율)을 얻어요. 끝이자 시작.
        {dark && ' 어둠은 비용이 비싸고 별빛 하나의 효과가 약해요.'}
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
