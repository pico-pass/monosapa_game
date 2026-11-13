import { fmt } from '../../components/format';
import type { LyricRecord } from '../../platform/liveRecords';

/** 최근 판의 날짜: 「11/13」(이 기기 시간대) */
const dayText = (at: number): string => {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 한 줄 요약: 대기실과 라이브 대전 목록에 보인다. 한 판도 안 했으면 아무것도 그리지 않는다. */
export function RecordLine({ record }: { record: LyricRecord | null | undefined }) {
  if (!record || record.games <= 0) return null;
  return (
    <p className="live-record-line">
      🏆 내 기록 · {fmt(record.games)}판 · 1위 {fmt(record.wins)}번 · 최고 {fmt(record.bestScore)}점
    </p>
  );
}

/** 결과 화면의 내 기록: 방금 판이 쌓인 누적·최고(새 기록 표시)와 최근 판 */
export function RecordCard({ record, best }: { record: LyricRecord; best: { score: boolean; correct: boolean } }) {
  const fresh = best.score || best.correct;
  const recent = [...record.recent].reverse();
  return (
    <div className="live-record">
      <div className="card-row">
        <h4>🏆 내 기록</h4>
        {fresh && <strong className="live-record-new">🎉 새 기록!</strong>}
      </div>
      <dl className="live-record-grid">
        <div>
          <dt>끝까지 한 판</dt>
          <dd>{fmt(record.games)}판</dd>
        </div>
        <div>
          <dt>함께한 판 1위</dt>
          <dd>
            {fmt(record.wins)}번 <small>/ {fmt(record.multiGames)}판</small>
          </dd>
        </div>
        <div className={best.score ? 'live-record-best' : ''}>
          <dt>최고 점수</dt>
          <dd>{fmt(record.bestScore)}점{best.score && ' 🎉'}</dd>
        </div>
        <div className={best.correct ? 'live-record-best' : ''}>
          <dt>한 판 최다 정답</dt>
          <dd>{fmt(record.bestCorrect)}문제{best.correct && ' 🎉'}</dd>
        </div>
        <div>
          <dt>맞힌 문제 합계</dt>
          <dd>{fmt(record.totalCorrect)}문제</dd>
        </div>
      </dl>
      {recent.length > 0 && (
        <details className="live-record-recent">
          <summary>최근 {recent.length}판</summary>
          <ol className="live-board">
            {recent.map((g, i) => (
              <li key={`${g.at}-${i}`}>
                <small>{dayText(g.at)}</small>
                <span className="live-name">
                  {g.multi ? `${g.players}명 중 ${g.rank}위` : '혼자 연습'} · {g.correct}문제
                </span>
                <b>{fmt(g.score)}점</b>
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="fineprint">끝까지 남아 있던 판만 기록돼요. 도중에 나가면 그 판은 남지 않고, 혼자 한 판은 1위 횟수에 세지 않아요.</p>
    </div>
  );
}
