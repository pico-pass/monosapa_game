import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import {
  COLS,
  COUNTER_ROLE,
  DefenseGame,
  FIELD_H,
  GRID_Y,
  INCIDENT_IDS,
  LINE_Y,
  ROLE_IDS,
  ROWS,
  SLOTS,
  slotAt,
  slotX,
  slotY,
  type IncidentId,
  type RoleId,
} from '../game/defense';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.defense;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 900;
const BANNER_MS = 1500;
const SHOT_MS = 130;
const TAP_MS = 260;
const LEAK_MS = 450;
/** 그림 좌표: 엔진의 칸 단위에 곱해서 viewBox를 키운다(작은 글자 크기가 브라우저 최소 글자 크기에 걸리지 않게) */
const U = 100;

/** 직군 이름·설명. 수치는 balance.ts에서 읽는다. */
export const ROLE_TEXT: Record<RoleId, { icon: string; name: string; desc: string }> = {
  sound: { icon: '🎧', name: '음향팀', desc: '빠르게 쏴요' },
  stage: { icon: '🧰', name: '무대팀', desc: `느리지만 세고, 둘레 사고도 ${Math.round(B.roles.stage.splashRate * 100)}% 맞아요` },
  light: { icon: '💡', name: '조명팀', desc: '맞은 사고가 느려져요' },
  safety: { icon: '🦺', name: '안전팀', desc: '맞은 사고를 뒤로 밀어내요(낙하 소품은 못 밀어요)' },
};

export const INCIDENT_TEXT: Record<IncidentId, { icon: string; name: string }> = {
  howl: { icon: '🔊', name: '하울링' },
  prop: { icon: '📦', name: '낙하 소품' },
  spark: { icon: '⚡', name: '합선' },
  crasher: { icon: '🏃', name: '난입 관객' },
  blackout: { icon: '🌑', name: '정전' },
};

export const RANK_NAME = ['', '신입', '주임', '팀장', '감독'];

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

interface Shot {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: RoleId;
  t: number;
}

export function DefensePlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<DefenseGame | null>(null);
  if (!gameRef.current) gameRef.current = new DefenseGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pausedRef = useRef(false);
  const idRef = useRef(0);
  const shotsRef = useRef<Shot[]>([]);
  const tapsRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const leakAtRef = useRef(0);
  const dragRef = useRef<number | null>(null);
  const sfxAtRef = useRef({ shot: 0, kill: 0, leak: 0, dark: 0 });
  const saidDarkRef = useRef(false);
  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState('');
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림·효과로 옮긴다. 소리는 겹치지 않게 간격을 둔다. */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    if (evs.length === 0) return;
    const now = performance.now();
    const at = sfxAtRef.current;
    let shots = 0;
    let kills = 0;
    let leaks = 0;
    let bigLeak = false;
    for (const e of evs) {
      if (e.type === 'shot') {
        shots += 1;
        shotsRef.current.push({ x1: slotX(e.slot) * U, y1: slotY(e.slot) * U, x2: e.tx * U, y2: e.ty * U, role: e.role, t: now });
      } else if (e.type === 'kill') {
        kills += 1;
      } else if (e.type === 'leak') {
        leaks += 1;
        if (B.incidents[e.kind].weight >= 2) bigLeak = true;
      } else if (e.type === 'tap') {
        tapsRef.current.push({ x: e.x * U, y: e.y * U, t: now });
      } else if (e.type === 'hire') {
        sfx.buy();
      } else if (e.type === 'move') {
        sfx.place();
      } else if (e.type === 'merge') {
        sfx.clear(e.rank);
        if (e.rank >= 3) say(`${ROLE_TEXT[e.role].name} ${RANK_NAME[e.rank]} 승급!`, 'good');
      } else if (e.type === 'blackout') {
        if (!saidDarkRef.current) {
          saidDarkRef.current = true;
          say('정전! 불이 나간 줄 스태프가 느려져요', 'bad');
        }
        if (now - at.dark > 600) {
          at.dark = now;
          sfx.fail();
        }
      } else if (e.type === 'waveEnd') {
        const pct = Math.round(e.ratio * 100);
        setReport(`${SET_NAMES[e.index]} 끝! 사고를 ${pct}% 막았어요.`);
        say(`${SET_NAMES[e.index]} 끝! ${pct}%`, pct >= 60 ? 'good' : 'bad');
      } else if (e.type === 'prep') {
        saidDarkRef.current = false;
        setSelected(null);
        if (e.stipend > 0) setReport((r) => `${r} 지원금 +${e.stipend}`);
      }
    }
    if (shots > 0 && now - at.shot > 70) {
      at.shot = now;
      sfx.tick();
    }
    if (kills > 0 && now - at.kill > 110) {
      at.kill = now;
      sfx.clear(1);
    }
    if (leaks > 0) {
      leakAtRef.current = now;
      if (now - at.leak > 300) {
        at.leak = now;
        sfx.hit();
      }
      if (bigLeak) say('큰 사고가 났어요!', 'bad');
    }
    const keep = shotsRef.current.filter((s) => now - s.t < SHOT_MS);
    shotsRef.current = keep.length > 60 ? keep.slice(-60) : keep;
    tapsRef.current = tapsRef.current.filter((t) => now - t.t < TAP_MS);
  }, [game, say]);

  // 공연 시계: 곡이 시작된 동안만 실제 경과 시간을 엔진에 넣는다(준비 중에는 엔진이 시간을 세지 않는다)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (!pausedRef.current && !game.over) {
        game.advance(dt);
        handleEvents();
        if (game.over) setEnded(game.cleared ? 'cleared' : 'failed');
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
      finishManualConcertRun(run.id, game.score, { defense: game.summary });
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

  const interactive = !paused && !ended && !game.over;

  const hire = useCallback(
    (role: RoleId) => {
      if (!pausedRef.current && game.hire(role)) {
        sfx.unlock();
        handleEvents();
        refresh();
      }
    },
    [game, handleEvents, refresh],
  );

  // 키보드: 1~4로 직군을 고용한다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < ROLE_IDS.length) hire(ROLE_IDS[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hire]);

  const startWave = () => {
    if (!game.start()) return;
    sfx.unlock();
    setReport('');
    setSelected(null);
    say(`${SET_NAMES[game.waveIdx]} 시작!`, 'info');
  };

  const pointOf = (e: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: ((e.clientX - rect.left) / rect.width) * COLS, y: ((e.clientY - rect.top) / rect.height) * FIELD_H };
  };

  const act = (from: number, to: number) => {
    if (game.move(from, to)) handleEvents();
    setSelected(null);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 포인터 캡처를 못 써도 누르기는 된다 */
    }
    const p = pointOf(e);
    if (!p) return;
    const slot = slotAt(p.x, p.y);
    if (slot >= 0) {
      dragRef.current = game.slots[slot] ? slot : null;
      return;
    }
    dragRef.current = null;
    if (game.tap(p.x, p.y)) {
      sfx.unlock();
      handleEvents();
    }
  };

  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const from = dragRef.current;
    dragRef.current = null;
    if (!interactive) return;
    const p = pointOf(e);
    if (!p) return;
    const slot = slotAt(p.x, p.y);
    if (slot < 0) return;
    if (from !== null && from !== slot) return act(from, slot);
    if (from === slot) {
      if (selected !== null && selected !== slot) return act(selected, slot);
      return setSelected(selected === slot ? null : slot);
    }
    if (selected !== null) act(selected, slot);
  };

  const wave = game.waveIdx;
  const prep = game.status === 'prep';
  const dark = run.persona === 'dark';
  const now = performance.now();
  const ratio = game.waveRatio(wave);
  const counts = prep ? game.forecast() : game.pending();
  const chosen = selected !== null ? game.slots[selected] : null;
  const roleCount = (r: RoleId) => game.slots.filter((s) => s && s.role === r).length;
  const canBuy = interactive && game.freeSlot() >= 0 && game.cash >= game.hireCost;
  const leaking = now - leakAtRef.current < LEAK_MS;

  return (
    <div className="stage-play defense-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 돌발 사고 막기
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
          {SET_NAMES[wave]} · {prep ? '준비 중' : `${Math.ceil(game.remainingMs / 1000)}초`}
        </span>
        <span className="defense-cash">💰 예산 {game.cash}</span>
      </div>
      <div className="defense-meter" aria-hidden>
        <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="defense-power muted" aria-hidden>
        막은 비율 {Math.round(ratio * 100)}%
      </div>

      <div className="defense-field">
        <svg
          ref={svgRef}
          className="defense-svg"
          viewBox={`0 0 ${COLS * U} ${FIELD_H * U}`}
          role="img"
          aria-label="위에서 사고가 내려오고 아래 자리에 스태프가 선다. 스태프를 끌어서 합치고, 사고를 눌러서 거든다"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          {Array.from({ length: COLS }, (_, c) => (
            <rect key={c} className={c % 2 === 0 ? 'defense-lane-a' : 'defense-lane-b'} x={c * U} y={0} width={U} height={LINE_Y * U} />
          ))}
          <rect className={`defense-line ${leaking ? 'defense-line-hit' : ''}`} x={0} y={LINE_Y * U} width={COLS * U} height={(GRID_Y - LINE_Y) * U} />
          <text className="defense-line-label" x={COLS * U / 2} y={(LINE_Y + (GRID_Y - LINE_Y) / 2) * U}>
            무대 앞 — 여기까지 오면 사고!
          </text>

          {chosen && selected !== null && (
            <circle className="defense-range" cx={slotX(selected) * U} cy={slotY(selected) * U} r={B.rankRange[chosen.rank] * U} />
          )}

          {Array.from({ length: SLOTS }, (_, i) => {
            const c = i % COLS;
            const r = Math.floor(i / COLS);
            const st = game.slots[i];
            const x = c * U + 5;
            const y = (GRID_Y + r) * U + 5;
            if (!st) return <rect key={i} className="ds ds-empty" data-slot={i} x={x} y={y} width={U - 10} height={U - 10} rx={14} />;
            const mergeable = chosen && selected !== i && chosen.role === st.role && chosen.rank === st.rank && st.rank < B.maxRank;
            const cls = ['ds', `ds-${st.role}`];
            if (selected === i) cls.push('ds-selected');
            if (mergeable) cls.push('ds-can');
            return (
              <g key={i} data-slot={i}>
                <rect className={cls.join(' ')} x={x} y={y} width={U - 10} height={U - 10} rx={14} />
                <text className="ds-icon" x={c * U + U / 2} y={(GRID_Y + r) * U + U / 2 - 12}>
                  {ROLE_TEXT[st.role].icon}
                </text>
                <text className="ds-rank" x={c * U + U / 2} y={(GRID_Y + r) * U + U - 20}>
                  {st.rank >= B.maxRank ? 'MAX' : `Lv.${st.rank}`}
                </text>
              </g>
            );
          })}

          {Array.from({ length: COLS }, (_, c) =>
            game.isDark(c) ? (
              <g key={c} className="defense-dark" pointerEvents="none">
                <rect x={c * U} y={0} width={U} height={FIELD_H * U} />
                <text x={c * U + U / 2} y={(GRID_Y + ROWS / 2) * U}>
                  🌑
                </text>
              </g>
            ) : null,
          )}

          {game.incidents.map((inc) => (
            <g
              key={inc.id}
              className={`di di-${inc.kind}${inc.slowMs > 0 ? ' di-slow' : ''}`}
              data-incident={inc.kind}
              transform={`translate(${(inc.x * U).toFixed(1)} ${(inc.y * U).toFixed(1)})`}
            >
              <circle r={34} />
              <text className="di-icon">{INCIDENT_TEXT[inc.kind].icon}</text>
              <text className="di-counter" x={28} y={34}>
                {ROLE_TEXT[COUNTER_ROLE[inc.kind]].icon}
              </text>
              <rect className="di-bar-bg" x={-30} y={-54} width={60} height={8} rx={4} />
              <rect className="di-bar" x={-30} y={-54} width={Math.max(0, (inc.hp / inc.maxHp) * 60)} height={8} rx={4} />
            </g>
          ))}

          {shotsRef.current
            .filter((s) => now - s.t < SHOT_MS)
            .map((s, i) => (
              <line key={i} className={`defense-shot defense-shot-${s.role}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
            ))}
          {tapsRef.current
            .filter((t) => now - t.t < TAP_MS)
            .map((t, i) => (
              <circle key={i} className="defense-tap" cx={t.x} cy={t.y} r={14 + ((now - t.t) / TAP_MS) * 30} />
            ))}
        </svg>
        {banner && (
          <div key={banner.id} className={`defense-banner defense-banner-${banner.tone}`} role="status">
            {banner.text}
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

      <div className="defense-hire" role="group" aria-label="직군 고용">
        {ROLE_IDS.map((r, i) => (
          <button
            key={r}
            type="button"
            className={`defense-hire-btn defense-hire-${r}`}
            disabled={!canBuy}
            onClick={() => hire(r)}
            aria-label={`${ROLE_TEXT[r].name} 고용 (${game.hireCost})`}
            title={`${ROLE_TEXT[r].desc} · 단축키 ${i + 1}`}
          >
            <span aria-hidden>{ROLE_TEXT[r].icon}</span>
            <strong>{ROLE_TEXT[r].name}</strong>
            <small>
              {INCIDENT_IDS.filter((k) => COUNTER_ROLE[k] === r && (dark || k !== 'blackout'))
                .map((k) => INCIDENT_TEXT[k].name)
                .join('·')}{' '}
              담당 · {roleCount(r)}명
            </small>
          </button>
        ))}
      </div>
      <div className="defense-cost muted" aria-hidden>
        {game.freeSlot() < 0 ? '빈 자리가 없어요. 같은 직군·직급끼리 합쳐요' : `다음 고용 비용 ${game.hireCost}`}
      </div>

      <div className="defense-board">
        <div className="defense-forecast-title">
          {prep ? `${SET_NAMES[wave]} 사고 예보` : '남은 사고'}
          <small className="muted"> (작은 아이콘 = 상대하기 좋은 직군)</small>
        </div>
        <div className="defense-forecast" aria-label={prep ? '이번 곡 사고 예보' : '남은 사고'}>
          {INCIDENT_IDS.filter((k) => counts[k] > 0).map((k) => (
            <span key={k} className="defense-chip">
              {INCIDENT_TEXT[k].icon} {INCIDENT_TEXT[k].name} ×{counts[k]} <i aria-hidden>{ROLE_TEXT[COUNTER_ROLE[k]].icon}</i>
            </span>
          ))}
        </div>
        {prep && !ended && (
          <>
            {report && <p className="defense-report">{report}</p>}
            <button type="button" className="btn btn-primary btn-wide defense-start" onClick={startWave} disabled={!interactive}>
              {SET_NAMES[wave]} 시작
            </button>
          </>
        )}
      </div>

      <p className="muted defense-hint">
        스태프를 고용해 빈 자리에 세워요. 같은 직군·같은 직급 둘을 끌어다 겹치면 승급해요(누른 뒤 다른 자리를 눌러도 돼요). 사고마다 상대하기 좋은 직군이 있고, 곡이 시작된 뒤에는 사고를 눌러서 거들 수 있어요.
        {dark && ' 🌑 정전이 살아 있는 줄 아래 스태프는 공격이 느려져요.'}
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
