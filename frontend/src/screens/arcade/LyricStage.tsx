import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import type { ArcadeRun } from '../../game/arcade';
import { BALANCE, lyricCardById } from '../../game/balance';
import { LYRIC_CARD_TEXT, LYRIC_EFFECT_TEXT, VOWEL_TEXT } from '../../game/content';
import { canPlay, endTurn, lyricScore, playCard, previewGain, startLyric, type LyricRun } from '../../game/lyricdeck';
import { Progress } from '../../components/parts';
import { abandonArcadeRun, finishArcadeRun, useUi } from '../../store/gameStore';

const L = BALANCE.lyric;

/** 가사 카드 한 장의 겉모습 (손패·보상 후보·덱 목록이 같이 쓴다) */
export function LyricCardFace({ id, gain }: { id: string; gain?: number }) {
  const def = lyricCardById(id);
  if (!def) return null;
  return (
    <>
      <span className={`lc-vowel lc-${def.vowel}`} aria-label={`모음 ${VOWEL_TEXT[def.vowel]}`}>
        {VOWEL_TEXT[def.vowel]}
      </span>
      <strong>{LYRIC_CARD_TEXT[id]}</strong>
      <small>
        ⚡{def.cost} · 위력 {gain !== undefined ? Math.round(gain * 10) / 10 : def.power}
        {def.effect ? ` · ${LYRIC_EFFECT_TEXT[def.effect]}` : ''}
      </small>
    </>
  );
}

export function LyricPlay({ run }: { run: ArcadeRun }) {
  const { game } = useUi();
  const [state, setState] = useState<LyricRun>(() => startLyric(game.arcade.lyric.cards, run.seed, run.power));
  const doneRef = useRef(false);

  // 곡이 완성되면 잠깐 보여 준 뒤 정산한다. 정산은 실행 ID로 한 번만 되므로 타이머는 지우지 않는다.
  useEffect(() => {
    if (state.status !== 'done' || doneRef.current) return;
    doneRef.current = true;
    const score = lyricScore(state);
    window.setTimeout(() => finishArcadeRun(run.id, score), 600);
  }, [state, run.id]);

  const play = (i: number) => {
    if (!canPlay(state, i)) return;
    sfx.tap(i);
    setState(playCard(state, i));
  };
  const score = lyricScore(state);
  return (
    <div className="stage-play">
      <div className="stage-head">
        <div>
          <strong>가사 덱</strong>
          <div className="muted">
            {Math.min(state.turn, L.turns)}/{L.turns}턴 · 에너지 ⚡ {state.energy}
          </div>
        </div>
        <div className="stage-score">
          <strong>{score}</strong>
          <small className="muted">완성도 {Math.round(state.total)}/{L.target}</small>
        </div>
      </div>
      <Progress value={state.total} max={L.target} label="곡 완성도" />
      <p className="lyric-chain" role="status">
        {state.status === 'done' ? '곡이 완성됐어요!' : state.chain > 0 ? `🔗 라임 체인 ×${state.chain + 1}${state.keepNext ? ' · 끊김 방지' : ''}${state.doubleNext ? ' · 다음 카드 2배' : ''}` : state.lastVowel ? `이어 갈 모음 ${VOWEL_TEXT[state.lastVowel]}` : '같은 모음을 이어 붙이면 체인이 쌓여요'}
      </p>
      <div className="lyric-hand">
        {state.hand.map((id, i) => {
          const def = lyricCardById(id);
          const ok = canPlay(state, i);
          return (
            <button key={`${id}-${i}`} type="button" className="lyric-card" disabled={!ok} onClick={() => play(i)}>
              <LyricCardFace id={id} gain={def ? previewGain(state, def).gain : undefined} />
            </button>
          );
        })}
        {state.hand.length === 0 && state.status === 'playing' && <p className="empty">손패가 없어요. 턴을 끝내요.</p>}
      </div>
      <small className="muted">
        뽑을 더미 {state.drawPile.length}장 · 버린 더미 {state.discard.length}장
      </small>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={state.status === 'done'} onClick={() => setState(endTurn(state))}>
          {state.turn >= L.turns ? '곡 완성하기' : '턴 끝내기'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={abandonArcadeRun}>
          나가기
        </button>
      </div>
    </div>
  );
}
