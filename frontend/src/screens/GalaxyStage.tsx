import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { GalaxyGame, SHAPE_GLYPHS, type ConnectResult, type Line, type Station } from '../game/galaxy';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';
import { SET_NAMES } from './MergeStage';

const B = BALANCE.galaxy;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 1000;
const BANNER_MS = 1500;
/** 이 거리(그림 좌표) 안에서 누르면 정거장을 눌렀다고 본다 */
const HIT_R = 32;
const STATION_R = 15;
const QUEUE_R = 27;
const LINE_COLORS = ['#ff6fa5', '#5aa9ff', '#ffd24a', '#7be0a0'];
const LINE_NAMES = ['분홍', '파랑', '노랑', '초록'];
const SHAPE_COLORS = ['#ff9ec4', '#8ccbff', '#ffd98a', '#c7b0ff'];
const MAX_ICONS = 16;

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

/** 모양 하나 (0 ● 1 ▲ 2 ■ 3 ★) */
function Glyph({ shape, x, y, r, fill, stroke, width = 2 }: { shape: number; x: number; y: number; r: number; fill: string; stroke: string; width?: number }) {
  if (shape === 0) return <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={width} />;
  if (shape === 1) {
    const pts = [0, 1, 2].map((k) => {
      const a = (-90 + k * 120) * (Math.PI / 180);
      return `${(x + Math.cos(a) * r * 1.15).toFixed(1)},${(y + Math.sin(a) * r * 1.15 + r * 0.12).toFixed(1)}`;
    });
    return <polygon points={pts.join(' ')} fill={fill} stroke={stroke} strokeWidth={width} strokeLinejoin="round" />;
  }
  if (shape === 2) return <rect x={x - r * 0.88} y={y - r * 0.88} width={r * 1.76} height={r * 1.76} rx={r * 0.18} fill={fill} stroke={stroke} strokeWidth={width} strokeLinejoin="round" />;
  const pts = Array.from({ length: 10 }, (_, k) => {
    const a = (-90 + k * 36) * (Math.PI / 180);
    const rr = k % 2 === 0 ? r * 1.2 : r * 0.52;
    return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`;
  });
  return <polygon points={pts.join(' ')} fill={fill} stroke={stroke} strokeWidth={width} strokeLinejoin="round" />;
}

/** 배경 별가루: 번호로만 정해지는 고정 점들 */
const DUST = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 97 + 31) % B.width,
  y: (i * 193 + 17) % B.height,
  r: 0.6 + ((i * 7) % 5) * 0.3,
}));

const DENIED_TEXT: Partial<Record<Exclude<ConnectResult, { ok: true }>['reason'], string>> = {
  no_slot: '노선은 지금 한도까지 만들었어요. 곡이 바뀌면 늘어요',
  already: '이미 이 노선에 있는 정거장이에요',
  not_end: '노선의 끝 정거장에서 이어야 해요',
};

export function GalaxyPlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<GalaxyGame | null>(null);
  if (!gameRef.current) gameRef.current = new GalaxyGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const idRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastTickAt = useRef(0);
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [drag, setDrag] = useState<{ from: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);
  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림으로 옮긴다 */
  const handleEvents = useCallback(() => {
    const evs = game.events.splice(0);
    for (const e of evs) {
      if (e.type === 'deliver') {
        const now = performance.now();
        if (now - lastTickAt.current > 90) {
          sfx.tick();
          lastTickAt.current = now;
        }
      } else if (e.type === 'complaint') {
        sfx.fail();
        say('😤 불만 폭발! 너무 붐비는 정거장이 있어요', 'bad');
      } else if (e.type === 'station') {
        sfx.unlock();
        say('🪐 새 정거장이 생겼어요', 'info');
      } else if (e.type === 'grant' && game.waveIdx > 0) {
        say(`${SET_NAMES[game.waveIdx]}: 노선 ${e.maxLines}개까지 · 예비 셔틀 ${e.spare}대`, 'info');
      } else if (e.type === 'waveEnd') say(`${SET_NAMES[e.index]} 끝! 달성 ${Math.round(e.ratio * 100)}%`, e.ratio >= 0.6 ? 'good' : 'bad');
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
      finishManualConcertRun(run.id, game.score, { galaxy: game.summary });
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

  const canAct = !paused && game.status === 'running';

  const connect = useCallback(
    (a: number, b: number) => {
      const r = game.connect(a, b, { newLine: newMode });
      if (r.ok) {
        sfx.place();
        setNewMode(false);
      } else {
        const text = DENIED_TEXT[r.reason];
        if (text) say(text, 'bad');
      }
      setSelected(null);
      handleEvents();
      refresh();
    },
    [game, handleEvents, newMode, refresh, say],
  );

  /** 화면 좌표를 그림 좌표로. 그림이 칸에 어떻게 놓였든(여백·축소) 맞도록 SVG 자신의 변환을 쓴다. */
  const toSvg = (e: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (svg && ctm) {
      const p = svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      const q = p.matrixTransform(ctm.inverse());
      return { x: q.x, y: q.y };
    }
    const rect = svg?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: ((e.clientX - rect.left) * B.width) / rect.width, y: ((e.clientY - rect.top) * B.height) / rect.height };
  };
  const stationNear = (x: number, y: number): Station | null => {
    let best: Station | null = null;
    let bd = HIT_R;
    for (const s of game.shownStations) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!canAct) return;
    const p = toSvg(e);
    const s = stationNear(p.x, p.y);
    if (!s) {
      setSelected(null);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ from: s.id, x: p.x, y: p.y });
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toSvg(e);
    setDrag({ from: drag.from, x: p.x, y: p.y });
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toSvg(e);
    const target = stationNear(p.x, p.y);
    const from = drag.from;
    setDrag(null);
    if (!canAct || !target) return;
    if (target.id !== from) connect(from, target.id);
    else if (selected !== null && selected !== from) connect(selected, from);
    else setSelected(selected === from ? null : from);
  };

  const addShuttle = (lineId: number) => {
    if (!canAct) return;
    if (game.addShuttle(lineId)) sfx.place();
    handleEvents();
    refresh();
  };
  const removeLine = (lineId: number) => {
    if (!canAct) return;
    game.removeLine(lineId);
    handleEvents();
    refresh();
  };

  const wave = game.waveIdx;
  const ratio = game.waveRatio(wave);
  const started = countdown <= 0;
  const shown = game.shownStations;
  const complaints = game.complaintsByWave[wave];

  return (
    <div className="stage-play galaxy-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 은하 노선 잇기
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
        <span className="galaxy-complaints">불만 {complaints}</span>
      </div>
      <div className="galaxy-meter" aria-hidden>
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="galaxy-power muted" aria-hidden>
        이번 곡 열기 {game.heat} / 목표 {game.goal} · 도착 {game.delivered}명
      </div>

      <div className="galaxy-field" style={{ '--galaxy-ratio': B.width / B.height } as CSSProperties}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${B.width} ${B.height}`}
          className="galaxy-svg"
          role="img"
          aria-label="정거장과 노선이 있는 은하 지도"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
        >
          <rect x={0} y={0} width={B.width} height={B.height} fill="#090716" />
          {DUST.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#fff" opacity={0.25 + (i % 4) * 0.12} />
          ))}

          {game.lines.map((l: Line) => (
            <polyline
              key={l.id}
              points={l.stations.map((id) => `${game.stations[id].x},${game.stations[id].y}`).join(' ')}
              fill="none"
              stroke={LINE_COLORS[l.color]}
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.88}
              data-line={l.id}
            />
          ))}

          {drag && (
            <line x1={game.stations[drag.from].x} y1={game.stations[drag.from].y} x2={drag.x} y2={drag.y} stroke="#fff" strokeWidth={4} strokeDasharray="7 7" opacity={0.7} strokeLinecap="round" />
          )}

          {shown.map((s) => {
            const crowd = s.over / B.overMs;
            const full = s.queue.length > game.cap;
            return (
              <g key={s.id} className="galaxy-station" data-station={s.id} data-x={s.x} data-y={s.y}>
                {(drag?.from === s.id || selected === s.id) && <circle cx={s.x} cy={s.y} r={STATION_R + 9} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="4 4" />}
                {crowd > 0 && <circle cx={s.x} cy={s.y} r={STATION_R + 5} fill="none" stroke="#ff4d6d" strokeWidth={2 + crowd * 6} opacity={0.5 + crowd * 0.5} className={full ? 'galaxy-warn' : ''} />}
                <Glyph shape={s.shape} x={s.x} y={s.y} r={STATION_R} fill={SHAPE_COLORS[s.shape]} stroke="#fff" width={3} />
                {s.queue.slice(0, MAX_ICONS).map((dest, i) => {
                  const ring = i < 10 ? 0 : 1;
                  const k = ring === 0 ? i : i - 10;
                  const a = (-90 + k * (ring === 0 ? 36 : 60)) * (Math.PI / 180);
                  const rr = QUEUE_R + ring * 10;
                  return (
                    <Glyph
                      key={i}
                      shape={dest}
                      x={s.x + Math.cos(a) * rr}
                      y={s.y + Math.sin(a) * rr}
                      r={4.3}
                      fill={SHAPE_COLORS[dest]}
                      stroke={i >= game.cap ? '#ff4d6d' : '#1a1030'}
                      width={i >= game.cap ? 1.6 : 1}
                    />
                  );
                })}
                {s.queue.length > MAX_ICONS && (
                  <text x={s.x} y={s.y + STATION_R + 24} textAnchor="middle" className="galaxy-more">
                    +{s.queue.length - MAX_ICONS}
                  </text>
                )}
              </g>
            );
          })}

          {game.lines.map((l: Line) =>
            l.shuttles.map((sh) => {
              const p = game.shuttlePos(l, sh);
              const a = game.stations[l.stations[sh.i0]];
              const b = game.stations[l.stations[sh.i0 + sh.dir]];
              const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              return (
                <g key={`${l.id}-${sh.id}`} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${ang.toFixed(0)})`}>
                  <rect x={-11} y={-7} width={22} height={14} rx={6} fill={LINE_COLORS[l.color]} stroke="#fff" strokeWidth={2} />
                  {sh.load.length > 0 && (
                    <text x={0} y={4} textAnchor="middle" transform={`rotate(${(-ang).toFixed(0)})`} className="galaxy-load">
                      {sh.load.length}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>
        {banner && (
          <div key={banner.id} className={`galaxy-banner galaxy-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown galaxy-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>정거장을 끌어서 이어 노선을 만들어요. 지금부터 미리 이어 둘 수 있어요</small>
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

      <div className="galaxy-status muted" aria-live="off">
        노선 {game.lines.length}/{game.maxLines} · 예비 셔틀 {game.spare}대
        <button type="button" className={`btn galaxy-mode ${newMode ? 'galaxy-mode-on' : ''}`} disabled={!canAct} onClick={() => setNewMode((v) => !v)} aria-pressed={newMode}>
          ➕ 새 노선으로 잇기
        </button>
      </div>

      <div className="galaxy-lines">
        {game.lines.length === 0 && <p className="muted galaxy-empty">아직 노선이 없어요. 정거장에서 다른 정거장으로 손가락을 끌어 보세요.</p>}
        {game.lines.map((l) => (
          <div key={l.id} className="galaxy-line" style={{ borderColor: LINE_COLORS[l.color] }}>
            <i style={{ background: LINE_COLORS[l.color] }} aria-hidden />
            <span>
              {LINE_NAMES[l.color]} 노선 · {l.stations.map((id) => SHAPE_GLYPHS[game.stations[id].shape]).join('')} · 셔틀 {l.shuttles.length}대
            </span>
            <button type="button" className="btn" disabled={!canAct || game.spare <= 0 || l.shuttles.length >= B.maxShuttles} onClick={() => addShuttle(l.id)} aria-label={`${LINE_NAMES[l.color]} 노선에 셔틀 추가`}>
              ➕ 셔틀
            </button>
            <button type="button" className="btn btn-ghost" disabled={!canAct} onClick={() => removeLine(l.id)} aria-label={`${LINE_NAMES[l.color]} 노선 걷기`}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <p className="muted galaxy-hint">
        관객은 자기와 다른 모양의 정거장으로 가고 싶어 해요(●▲■★). 정거장을 끌어서(또는 차례로 눌러서) 이으면 노선과 셔틀이 생겨요. 노선 끝에서 이으면 노선이 늘어나요. 정거장이 정원을 넘은 채 오래 두면 불만이 터져 열기가 깎여요.
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
