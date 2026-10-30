import { fmt } from '../components/format';
import { BALANCE } from '../game/balance';
import { ARCADE_TEXT, LYRIC_CARD_TEXT } from '../game/content';
import type { ArcadeRun } from '../game/arcade';
import { LyricCardFace, LyricPlay } from './arcade/LyricStage';
import { RhythmPlay } from './arcade/RhythmStage';
import { SurvivalPlay } from './arcade/SurvivalStage';
import { TicketPlay } from './arcade/TicketStage';
import { closeArcadeResult, doPickLyricCard, skipLyricDraft, useUi } from '../store/gameStore';

const TITLE = { rhythm: 'rhythm', survival: 'survival', lyric: 'lyric', ticketing: 'ticketing' } as const;

/** 아케이드 전체화면. 이 화면이 열려 있는 동안 다른 탭으로 나갈 수 없다. */
export function ArcadeStage({ run }: { run: ArcadeRun }) {
  const { arcadeResult: res } = useUi();
  const finished = run.status === 'finished' && res;
  return (
    <div className={`stage-overlay stage-${run.persona}`} role="dialog" aria-modal="true" aria-label={ARCADE_TEXT[TITLE[run.kind]].name}>
      {finished ? (
        <ResultPanel />
      ) : run.kind === 'rhythm' ? (
        <RhythmPlay key={run.id} run={run} />
      ) : run.kind === 'survival' ? (
        <SurvivalPlay key={run.id} run={run} />
      ) : run.kind === 'lyric' ? (
        <LyricPlay key={run.id} run={run} />
      ) : (
        <TicketPlay key={run.id} run={run} />
      )}
    </div>
  );
}

function ResultPanel() {
  const { arcadeResult: res, lyricDraft, game: g } = useUi();
  if (!res) return null;
  const { outcome: o, run } = res;
  const t = ARCADE_TEXT[TITLE[run.kind]];
  return (
    <div className="stage-result">
      <h2>
        {t.icon} {t.name} 결과
      </h2>
      <div className="big-score">
        {o.grade}
        <small> 등급 · {o.score}점</small>
      </div>
      {o.newBest && <p className="muted">🎉 이 대상의 새 기록이에요!</p>}
      <ul className="reward-list">
        {o.coins > 0 && (
          <li>
            🪙 코인 <b>+{fmt(o.coins)}</b>
          </li>
        )}
        {o.fans > 0 && (
          <li>
            👥 팬 <b>+{fmt(o.fans)}</b>
          </li>
        )}
        {o.diamonds > 0 && (
          <li>
            💎 다이아 <b>+{fmt(o.diamonds)}</b>
          </li>
        )}
        {o.boost !== null && (
          <li>
            🎟️ 다음 공연 코인 <b>×{o.boost.toFixed(2)}</b> <small>({BALANCE.ticketing.boostMs / 60_000}분 안에 한 번)</small>
          </li>
        )}
        {run.kind === 'ticketing' && o.boost === null && <li>🎟️ 매진됐어요… 보상이 없어요.</li>}
        {o.lyricBonus !== null && (
          <li>
            📝 다음 싱글 팬 <b>+{Math.round(o.lyricBonus * 100)}%</b>
          </li>
        )}
      </ul>
      {run.kind === 'lyric' && lyricDraft && (
        <div className="lyric-draft" role="group" aria-label="덱에 넣을 카드 고르기">
          <strong>덱에 넣을 카드를 하나 골라요</strong>
          {lyricDraft.map((id) => (
            <button key={id} type="button" className="lyric-card" disabled={Object.values(g.arcade.lyric.cards).reduce((a, b) => a + b, 0) >= BALANCE.lyric.maxDeck} onClick={() => doPickLyricCard(id)} aria-label={`${LYRIC_CARD_TEXT[id]} 덱에 넣기`}>
              <LyricCardFace id={id} />
            </button>
          ))}
          <button type="button" className="btn btn-ghost" onClick={skipLyricDraft}>
            고르지 않기
          </button>
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={closeArcadeResult}>
        확인
      </button>
    </div>
  );
}
