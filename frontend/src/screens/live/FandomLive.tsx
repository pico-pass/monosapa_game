import { useEffect, useReducer, useRef } from 'react';
import { fmt } from '../../components/format';
import { toField, useFrameLoop } from '../arcade/useFrameLoop';
import { fandomReduce, initialFandom, type FandomState } from './fandomState';
import { toView, viewAt, type FandomViewData, type TimedSnap } from './fandomView';
import { ConnectionNote } from './LyricLive';
import { FANDOM_REWARD_TEXT } from './text';
import { useLive } from './useLive';

const W = 360;
const H = 500;
/** 화면 가로에 보이는 칸 수 → 한 칸이 몇 픽셀인지 */
const VIEW_UNITS = 60;
const SCALE = W / VIEW_UNITS;
/** 서버 스냅샷은 초당 10번이라, 조금 지난 시각(이만큼 전)을 그려서 앞뒤를 이어 부드럽게 한다 */
const INTERP_MS = 120;
const COLORS = ['#ff6b8f', '#7fb0ff', '#ffd24a', '#6be3b0', '#c08bff', '#ff9d4a', '#5bd6e0', '#f08bd0'];
const STEER_MIN_DELTA = 0.06;
const STEER_REPEAT_MS = 250;

export interface DrawInfo {
  w: number;
  h: number;
  myId: number;
  names: Record<number, string>;
  /** 반짝임용 시각(ms) */
  time: number;
}

/** 팬덤 모으기 판 그리기: 내 머리를 화면 한가운데에 두고 세계를 옮겨 그린다. */
export function drawFandom(ctx: CanvasRenderingContext2D, v: FandomViewData, info: DrawInfo): void {
  const cx = v.me.x;
  const cy = v.me.y;
  const sx = (x: number): number => W / 2 + (x - cx) * SCALE;
  const sy = (y: number): number => H / 2 + (y - cy) * SCALE;

  ctx.fillStyle = '#08060f';
  ctx.fillRect(0, 0, W, H);
  // 세계 바닥과 격자, 벽
  ctx.fillStyle = '#1b1a3f';
  ctx.fillRect(sx(0), sy(0), info.w * SCALE, info.h * SCALE);
  ctx.strokeStyle = 'rgba(160,150,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let g = 0; g <= info.w; g += 10) {
    ctx.moveTo(sx(g), sy(0));
    ctx.lineTo(sx(g), sy(info.h));
  }
  for (let g = 0; g <= info.h; g += 10) {
    ctx.moveTo(sx(0), sy(g));
    ctx.lineTo(sx(info.w), sy(g));
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,90,140,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(sx(0), sy(0), info.w * SCALE, info.h * SCALE);

  // 팬 점
  for (const [x, y, val] of v.dots) {
    ctx.fillStyle = val >= 2 ? '#ff8ad0' : '#ffe27a';
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), (val >= 2 ? 0.75 : 0.45) * SCALE, 0, Math.PI * 2);
    ctx.fill();
  }

  // 뱀: 꼬리부터 그려서 머리가 위에 오게
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '11px system-ui, sans-serif';
  for (const s of v.snakes) {
    const mine = s.id === info.myId;
    const blink = s.shield && Math.floor(info.time / 120) % 2 === 0;
    ctx.globalAlpha = blink ? 0.45 : 1;
    ctx.fillStyle = COLORS[s.id % COLORS.length];
    for (let i = s.pts.length - 1; i >= 0; i--) {
      ctx.beginPath();
      ctx.arc(sx(s.pts[i][0]), sy(s.pts[i][1]), (i === 0 ? 1 : 0.8) * SCALE, 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.pts.length > 0) {
      const [hx, hy] = s.pts[0];
      if (mine) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx(hx), sy(hy), 1.1 * SCALE, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.fillText(`${mine ? '나' : (info.names[s.id] ?? '')} ${s.fans}`.trim(), sx(hx), sy(hy) - 1.6 * SCALE);
    }
    ctx.globalAlpha = 1;
  }
}

function Hud({ state }: { state: FandomState }) {
  const { hud, names, myId } = state;
  return (
    <div className="live-hud" aria-live="off">
      <div>
        <strong>팬 {fmt(hud.fans)}</strong>
        <small>
          {hud.rank}/{hud.alive}위 · {Math.ceil(hud.leftMs / 1000)}초
        </small>
      </div>
      <ol className="live-lb" aria-label="순위">
        {hud.lb.map(([id, fans]) => (
          <li key={id} className={id === myId ? 'live-me' : ''}>
            {id === myId ? '나' : (names[id] ?? '…')} <b>{fans}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Over({ state, onAgain, onExit }: { state: FandomState; onAgain: () => void; onExit: () => void }) {
  const o = state.over;
  if (!o) return null;
  return (
    <div className="live-over">
      <h3>{o.why === 'dead' ? `${o.by ?? '누군가'}에게 쓰러졌어요` : o.why === 'time' ? '공연 끝!' : '나왔어요'}</h3>
      <p>
        가장 많았을 때 팬 <b>{fmt(o.peak)}</b>명 · 마지막 팬 {fmt(o.fans)}명 · 쓰러뜨린 행렬 {o.kills}
      </p>
      {o.reward <= 0 ? (
        <p className="fineprint">팬 {FANDOM_FIRST_TIER}명을 넘기면 보상이 나가요.</p>
      ) : !state.reward ? (
        <p className="fineprint">보상 💎{o.reward}을 우편함으로 보내는 중이에요…</p>
      ) : state.reward.diamonds <= 0 ? (
        <p className="fineprint">오늘 라이브 보상 한도에 닿아서 이번 보상은 없어요.</p>
      ) : (
        <p className="live-reward">
          📬 보상 💎{state.reward.diamonds}을 우편함으로 보냈어요!{state.reward.capped ? ' (오늘 한도까지만 나갔어요)' : ''}
        </p>
      )}
      <div className="btn-col">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          다시 하기
        </button>
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          나가기
        </button>
      </div>
    </div>
  );
}

/** 첫 보상이 나가는 팬 수(안내 문구용. 서버 `FANDOM.rewardTiers`의 첫 값과 같다) */
export const FANDOM_FIRST_TIER = 30;

const wrapDiff = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** 팬덤 모으기: 화면을 끌어(마우스는 움직여서) 가고 싶은 방향을 정하고, 팬 점을 먹어 행렬을 키운다. 남의 행렬 몸에 머리를 박으면 쓰러져요. */
export function FandomLive({ onExit }: { onExit: () => void }) {
  const [state, dispatch] = useReducer(fandomReduce, initialFandom);
  const snaps = useRef<TimedSnap[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const canvas = useRef<HTMLCanvasElement>(null);
  const aim = useRef({ a: 0, boost: false, sentA: 0, sentBoost: false, sentAt: 0 });

  const { status, send, retry } = useLive('fandom', (m) => {
    if (m.t === 'f.go') snaps.current = [];
    if (m.t === 'f.s') snaps.current = [...snaps.current.slice(-3), { at: performance.now(), view: toView(m) }];
    dispatch(m);
  });

  /** 방향·부스트가 바뀌었거나 한참 안 보냈으면 서버에 알린다 */
  const steer = (force = false): void => {
    const t = performance.now();
    const s = aim.current;
    if (!force && Math.abs(wrapDiff(s.a, s.sentA)) < STEER_MIN_DELTA && s.boost === s.sentBoost && t - s.sentAt < STEER_REPEAT_MS) return;
    s.sentA = s.a;
    s.sentBoost = s.boost;
    s.sentAt = t;
    send({ t: 'steer', a: s.a, b: s.boost ? 1 : 0 });
  };

  useFrameLoop(`${status}`, (_dt, now) => {
    const st = stateRef.current;
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || st.phase === 'wait') return;
    const view = viewAt(snaps.current, now - INTERP_MS);
    if (view) drawFandom(ctx, view, { w: st.w, h: st.h, myId: st.myId, names: st.names, time: now });
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ' && !aim.current.boost) {
        aim.current.boost = true;
        steer(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' && aim.current.boost) {
        aim.current.boost = false;
        steer(true);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLElement>): void => {
    if (e.pointerType !== 'mouse' && e.buttons === 0 && e.type === 'pointermove') return;
    const p = toField(e, W, H);
    aim.current.a = Math.atan2(p.y - H / 2, p.x - W / 2);
    steer();
  };

  const playing = state.phase === 'play';
  return (
    <>
      <ConnectionNote status={status} onRetry={retry} />
      {status === 'open' && (
        <>
          {state.error && (
            <p className="muted" role="alert">
              {state.error}
            </p>
          )}
          <div className="run-field arc-field live-field" onPointerDown={point} onPointerMove={point}>
            <canvas ref={canvas} width={W} height={H} className="run-canvas" aria-label="팬덤 모으기 판" />
            {state.phase !== 'wait' && <Hud state={state} />}
            {state.phase === 'wait' && !state.error && <div className="run-end">들어가는 중…</div>}
            {state.phase === 'over' && <Over state={state} onAgain={() => send({ t: 'join', game: 'fandom' })} onExit={onExit} />}
          </div>
          {playing && (
            <button
              type="button"
              className="btn btn-accent btn-wide live-boost"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                aim.current.boost = true;
                steer(true);
              }}
              onPointerUp={() => {
                aim.current.boost = false;
                steer(true);
              }}
              onPointerCancel={() => {
                aim.current.boost = false;
                steer(true);
              }}
            >
              🚀 부스트 (누르고 있는 동안 · 팬이 조금씩 흘러요)
            </button>
          )}
        </>
      )}
      {status !== 'open' && status !== 'connecting' && (
        <button type="button" className="btn btn-ghost" onClick={onExit}>
          나가기
        </button>
      )}
      {status === 'open' && playing && (
        <button type="button" className="btn btn-ghost" onClick={() => send({ t: 'leave' })}>
          그만하기 (지금까지 기록으로 끝내요)
        </button>
      )}
      <p className="fineprint">화면을 누르고 끌면(마우스는 움직이면) 그쪽으로 가요. 노란 점을 먹으면 행렬이 길어져요. 남의 몸에 머리를 박으면 쓰러지고, 쓰러진 행렬은 큰 점이 돼요. {FANDOM_REWARD_TEXT}</p>
    </>
  );
}
