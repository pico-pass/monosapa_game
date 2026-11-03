import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../audio/sfx';
import { PersonaBadge } from '../components/parts';
import { BALANCE } from '../game/balance';
import { BROKEN, BlocksGame, SIZE, fits, previewClears, type Piece } from '../game/blocks';
import { PERSONA_TEXT, STAGE_TEXT } from '../game/content';
import type { ConcertRun } from '../game/commands';
import { abandonManualConcert, finishManualConcertRun } from '../store/gameStore';

const B = BALANCE.blocks;
const COUNTDOWN_MS = 3000;
/** 끝난 순간을 잠깐 보여준 뒤 결과 화면으로 넘어간다 */
const END_HOLD_MS = 900;
const TICK_MS = 100;
const SET_NAMES = ['1곡', '2곡', '3곡', '앙코르'];
/** 손가락에 가려지지 않게 터치는 블록을 이만큼(칸) 위에 띄운다. 마우스는 그대로 따라간다. */
const TOUCH_LIFT = 1.8;
const HAND_CELL = 20;
const BROKEN_TEXT = { normal: '고장 난 장비', dark: '던져진 물건' } as const;
const BANNER_MS = 1300;

interface Drag {
  slot: number;
  x: number;
  y: number;
  lift: number;
}

interface Banner {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

interface Pop {
  id: number;
  text: string;
}

/** 손가락(마우스) 위치에서 블록 왼쪽 위 칸이 놓일 (행, 열)을 구한다. 블록의 중심이 위치(+띄운 만큼)에 오게 한다. */
export function anchorFor(px: number, py: number, rect: { left: number; top: number; width: number }, piece: Piece, lift: number): { row: number; col: number } {
  const cs = rect.width / SIZE;
  const x0 = px - (piece.w * cs) / 2;
  const y0 = py - lift * cs - (piece.h * cs) / 2;
  return { col: Math.round((x0 - rect.left) / cs), row: Math.round((y0 - rect.top) / cs) };
}

/** 블록 모양을 작은 격자로 그린다 */
function PieceView({ piece, cell, className }: { piece: Piece; cell: number; className?: string }) {
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${piece.w}, ${cell}px)`,
    gridTemplateRows: `repeat(${piece.h}, ${cell}px)`,
  };
  return (
    <div className={`block-piece ${className ?? ''}`} style={style} aria-hidden>
      {piece.cells.map(([r, c]) => (
        <i key={`${r}-${c}`} className={`bc bc-${piece.color}`} style={{ gridRow: r + 1, gridColumn: c + 1 }} />
      ))}
    </div>
  );
}

export function BlocksPlay({ run }: { run: ConcertRun }) {
  const gameRef = useRef<BlocksGame | null>(null);
  if (!gameRef.current) gameRef.current = new BlocksGame(run.persona, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const game = gameRef.current;

  const boardRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const countRef = useRef(COUNTDOWN_MS);
  const idRef = useRef(0);
  const [, setTick] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [paused, setPaused] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [ended, setEnded] = useState<'cleared' | 'failed' | null>(null);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const say = useCallback((text: string, tone: Banner['tone']) => setBanner({ id: ++idRef.current, text, tone }), []);

  /** 엔진이 쌓은 사건을 소리·알림으로 옮긴다 */
  const handleEvents = useCallback(() => {
    for (const e of game.events.splice(0)) {
      if (e.type === 'clear') {
        sfx.clear(e.rows.length + e.cols.length);
        setPop({ id: ++idRef.current, text: `+${Math.round(e.gained)}${e.combo >= 2 ? ` · 콤보 ${e.combo}` : ''}` });
        setFlashKey((k) => k + 1);
      } else if (e.type === 'perfect') {
        sfx.album();
        say(`퍼펙트 클리어! +${B.perfectBonus}`, 'good');
      } else if (e.type === 'set') {
        if (e.index > 0) say(`${SET_NAMES[e.index]} · 점수 ×${B.sets[e.index].mult}`, 'info');
      } else if (e.type === 'broken') {
        sfx.hit();
        say(`${BROKEN_TEXT[run.persona]} ${e.cells.length}칸`, 'bad');
      } else if (e.type === 'rescue') {
        sfx.unlock();
        say('스태프가 가장 찬 줄을 치워 줬어요', 'good');
      }
    }
  }, [game, run.persona, say]);

  // 공연 시계: 카운트다운 뒤 실제 경과 시간을 엔진에 넣는다
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

  // 끝나면 잠깐 보여준 뒤 결과를 확정한다. 그 사이 포기하면 이 타이머도 함께 사라진다.
  useEffect(() => {
    if (!ended) return;
    setDrag(null);
    const id = window.setTimeout(() => {
      finishManualConcertRun(run.id, game.score, { blocks: game.summary });
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
  const playable = started && !paused && !game.over;

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, slot: number) => {
    if (!playable || !game.hand[slot]) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ slot, x: e.clientX, y: e.clientY, lift: e.pointerType === 'touch' ? TOUCH_LIFT : 0 });
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag;
    setDrag(null);
    const rect = boardRef.current?.getBoundingClientRect();
    const piece = d ? game.hand[d.slot] : null;
    if (!d || !rect || !piece || !playable) return;
    const { row, col } = anchorFor(e.clientX, e.clientY, rect, piece, d.lift);
    if (!fits(game.board, piece, row, col)) return;
    game.place(d.slot, row, col);
    sfx.place();
    handleEvents();
    refresh();
    if (game.over) setEnded(game.cleared ? 'cleared' : 'failed');
  };

  // 끌고 있는 블록의 놓일 자리 미리보기
  const rect = drag && boardRef.current ? boardRef.current.getBoundingClientRect() : null;
  const dragPiece = drag ? game.hand[drag.slot] : null;
  const anchor = drag && rect && dragPiece ? anchorFor(drag.x, drag.y, rect, dragPiece, drag.lift) : null;
  const valid = !!(anchor && dragPiece && fits(game.board, dragPiece, anchor.row, anchor.col));
  const ghostCells = new Set<number>();
  const clearCells = new Set<number>();
  if (anchor && dragPiece) {
    for (const [dr, dc] of dragPiece.cells) {
      const r = anchor.row + dr;
      const c = anchor.col + dc;
      if (r >= 0 && c >= 0 && r < SIZE && c < SIZE) ghostCells.add(r * SIZE + c);
    }
    if (valid) {
      const { rows, cols } = previewClears(game.board, dragPiece, anchor.row, anchor.col);
      for (const r of rows) for (let c = 0; c < SIZE; c++) clearCells.add(r * SIZE + c);
      for (const c of cols) for (let r = 0; r < SIZE; r++) clearCells.add(r * SIZE + c);
    }
  }
  const cs = rect ? rect.width / SIZE : 0;

  const score = game.score;
  const setIdx = game.setIndex;
  const cells = Array.from(game.board);

  return (
    <div className="stage-play block-play">
      <header className="stage-head">
        <div>
          <strong>{STAGE_TEXT[run.stageId].name}</strong>
          <div className="muted">
            <PersonaBadge persona={run.persona} /> {PERSONA_TEXT[run.persona].name} · 무대 세팅 블록
          </div>
        </div>
        <div className="stage-score" aria-live="off">
          <span>열기 점수</span>
          <strong>{score}</strong>
          <small>곡 점수 ×{game.setMult}</small>
        </div>
      </header>

      <div className="run-hud" aria-hidden>
        <span>
          {SET_NAMES[setIdx]} · {Math.ceil(game.setRemainingMs / 1000)}초
        </span>
        <span className="block-combo">{game.combo >= 2 ? `콤보 ${game.combo}` : ''}</span>
      </div>
      <div className="block-meter" aria-hidden>
        <i style={{ width: `${score / 10}%` }} />
        <b style={{ left: `${BALANCE.concert.clearScore / 10}%` }} />
      </div>
      <div className="run-progress" aria-hidden>
        <i style={{ width: `${Math.round(game.progress * 100)}%` }} />
      </div>

      <div className="block-field">
        <div key={flashKey} className={`block-board ${flashKey > 0 ? 'block-flash' : ''}`} ref={boardRef} role="grid" aria-label="무대 바닥">
          {cells.map((v, i) => {
            const cls = ['bc'];
            if (v === BROKEN) cls.push('bc-x');
            else if (v > 0) cls.push(`bc-${v}`);
            if (ghostCells.has(i)) cls.push(valid ? 'gh-ok' : 'gh-bad');
            if (clearCells.has(i)) cls.push('will-clear');
            return (
              <i key={i} className={cls.join(' ')} role="gridcell" aria-label={v === BROKEN ? BROKEN_TEXT[run.persona] : undefined}>
                {v === BROKEN ? '✖' : ''}
              </i>
            );
          })}
        </div>
        {pop && (
          <div key={pop.id} className="block-pop" role="status">
            {pop.text}
          </div>
        )}
        {banner && (
          <div key={banner.id} className={`block-banner block-banner-${banner.tone}`} role="status">
            {banner.text}
          </div>
        )}
        {!started && (
          <div className="countdown run-countdown" role="status">
            {Math.max(1, Math.ceil(countdown / 1000))}
            <small>블록을 끌어다 무대에 놓아 줄을 채워요</small>
          </div>
        )}
        {ended && (
          <div className={`run-end ${ended === 'cleared' ? 'run-end-win' : ''}`} role="status">
            {ended === 'cleared' ? '공연 성공!' : game.stuck ? '놓을 곳이 없어요…' : '공연 끝…'}
          </div>
        )}
        {paused && (
          <div className="pause-note" role="status">
            ⏸ 일시정지 — 돌아오면 이어서 진행돼요
          </div>
        )}
      </div>

      <div className="block-hand">
        {game.hand.map((p, i) => (
          <button
            key={i}
            type="button"
            className={`block-slot ${drag?.slot === i ? 'is-dragging' : ''}`}
            disabled={!p}
            onPointerDown={(e) => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
            aria-label={p ? `블록 ${i + 1} 끌어서 놓기` : `블록 ${i + 1} 놓음`}
          >
            {p && <PieceView piece={p} cell={HAND_CELL} />}
          </button>
        ))}
      </div>

      {drag && dragPiece && cs > 0 && (
        <div className="block-drag" aria-hidden style={{ left: drag.x - (dragPiece.w * cs) / 2, top: drag.y - drag.lift * cs - (dragPiece.h * cs) / 2 }}>
          <PieceView piece={dragPiece} cell={cs} />
        </div>
      )}

      <p className="muted block-hint">
        블록을 끌어다 8×8 무대에 놓고, 가로·세로 한 줄을 채우면 합주가 터져요. 이어서 터뜨리면 콤보! 곡이 바뀔 때마다 {BROKEN_TEXT[run.persona]} 칸이 생기고, 놓을 곳이 없으면 공연이 끝나요.
      </p>
      <button type="button" className="btn btn-ghost" onClick={abandonManualConcert}>
        공연 포기 (보상 없음 · 쿨다운 유지)
      </button>
    </div>
  );
}
