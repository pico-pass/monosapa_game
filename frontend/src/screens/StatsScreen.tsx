import { fmt, fmtCountdown, fmtStreamRate, fmtStreams } from '../components/format';
import { BALANCE, STREAM_PLATFORMS } from '../game/balance';
import { STREAM_PLATFORM_TEXT } from '../game/content';
import { streamClaimStatus, streamRate, streamTotal } from '../game/selectors';
import { doClaimStreaming, useUi } from '../store/gameStore';

/** 통계. 지금은 음원 플랫폼별 스트리밍 기록과 코인 정산이 들어 있다. */
export function StatsScreen() {
  const { game: g } = useUi();
  const st = g.streaming;
  const total = streamTotal(st);
  const claim = streamClaimStatus(g);
  const rate = streamRate(g);
  const perCoin = BALANCE.streaming.streamsPerCoin;
  const intervalMin = BALANCE.streaming.claimIntervalMs / 60000;

  return (
    <section className="screen" aria-label="통계">
      <h2 className="section-title">통계</h2>
      <p className="muted">
        팬 1명당 초당 {BALANCE.streaming.perFanPerSec} 스트리밍이 쌓이고, 플랫폼마다 무작위로 나뉘어 기록돼요.
      </p>

      <div className="stat-grid stat-grid-3">
        <div>
          <strong>{fmtStreams(total)}</strong>
          <span>누적 스트리밍</span>
        </div>
        <div>
          <strong>{fmtStreamRate(rate)}</strong>
          <span>초당 스트리밍</span>
        </div>
        <div>
          <strong>{fmtStreams(claim.pending)}</strong>
          <span>정산 대기</span>
        </div>
      </div>

      <h3 className="sub-title">플랫폼별 스트리밍</h3>
      {total <= 0 ? (
        <p className="empty">아직 스트리밍이 없어요 — 싱글을 발매해 팬이 생기면 쌓이기 시작해요.</p>
      ) : (
        <ul className="platforms">
          {STREAM_PLATFORMS.map((p) => {
            const t = STREAM_PLATFORM_TEXT[p];
            const pct = (st.totals[p] / total) * 100;
            return (
              <li key={p} className="platform" style={{ ['--plat' as string]: t.color }}>
                <div className="platform-head">
                  <strong>
                    <span aria-hidden>{t.icon}</span> {t.name}
                  </strong>
                  <span>
                    <b>{fmtStreams(st.totals[p])}</b> <small>({pct.toFixed(1)}%)</small>
                  </span>
                </div>
                <div className="platform-bar" role="progressbar" aria-label={`${t.name} 비율`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                  <div className="platform-fill" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="card">
        <div className="card-row">
          <h3>🎧 스트리밍 정산</h3>
          <small className="muted">
            {perCoin}스트리밍 = 🪙 1 · {intervalMin >= 60 ? `${intervalMin / 60}시간` : `${intervalMin}분`}마다
          </small>
        </div>
        <dl className="before-after">
          <div>
            <dt>지금 정산하면</dt>
            <dd>
              {fmtStreams(claim.pending)}스트리밍 → <b>🪙 {fmt(claim.coins)}</b>
            </dd>
          </div>
        </dl>
        <button type="button" className="btn btn-primary btn-wide" disabled={!claim.ready} onClick={doClaimStreaming}>
          {claim.waitMs > 0
            ? `⏳ ${fmtCountdown(claim.waitMs)} 뒤에 정산할 수 있어요`
            : claim.coins > 0
              ? `정산하기 🪙 ${fmt(claim.coins)}`
              : '정산할 스트리밍이 없어요'}
        </button>
        <p className="fineprint">정산하지 않은 스트리밍은 사라지지 않고 계속 쌓여요. {perCoin}으로 나누고 남은 스트리밍은 다음 정산으로 넘어가요.</p>
      </div>
    </section>
  );
}
