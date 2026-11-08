import { fmt, fmtCountdown, fmtStreamRate, fmtStreams } from '../components/format';
import { Progress } from '../components/parts';
import { BALANCE, STREAM_CERT_VIBE, STREAM_PLATFORMS } from '../game/balance';
import { CERT_TIER_COUNT, certStatus } from '../game/certs';
import { CERT_TIER_TEXT, DISTRIBUTOR_TEXT, STREAM_PLATFORM_TEXT, VIBE_TEXT } from '../game/content';
import { previewDistributor, streamClaimStatus, streamRate, streamRevenueMult, streamTotal } from '../game/selectors';
import { doBuyDistributor, doClaimCert, doClaimStreaming, useUi } from '../store/gameStore';

/** 배율 표시: 1.05처럼 필요한 만큼만 소수점을 보인다. */
const fmtMult = (m: number) => String(Math.round(m * 100) / 100);

/** 통계. 지금은 음원 플랫폼별 스트리밍 기록과 코인 정산이 들어 있다. */
export function StatsScreen() {
  const { game: g } = useUi();
  const st = g.streaming;
  const total = streamTotal(st);
  const claim = streamClaimStatus(g);
  const rate = streamRate(g);
  const perCoin = BALANCE.streaming.streamsPerCoin;
  const revenue = streamRevenueMult(g);
  const dist = previewDistributor(g);
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

      <h3 className="sub-title">스트리밍 인증</h3>
      <p className="muted">
        플랫폼마다 누적 스트리밍이 기준을 넘으면 인증을 받아요. 받으면 💎를 받고, 받은 단계마다 그 플랫폼의 보너스가 영구히 +{Math.round(BALANCE.certs.bonusPerTier * 100)}%씩 붙어요.
      </p>
      <ul className="platforms">
        {STREAM_PLATFORMS.map((p) => {
          const t = STREAM_PLATFORM_TEXT[p];
          const c = certStatus(g, p);
          const vibe = VIBE_TEXT[STREAM_CERT_VIBE[p]];
          const tier = c.claimed > 0 ? CERT_TIER_TEXT[c.claimed - 1] : null;
          return (
            <li key={p} className="platform" style={{ ['--plat' as string]: t.color }}>
              <div className="platform-head">
                <strong>
                  <span aria-hidden>{t.icon}</span> {t.name} · {tier ? `${tier.icon} ${tier.name}` : '인증 전'}
                </strong>
                <span>
                  <small>
                    {vibe.icon} {vibe.name} +{Math.round(c.bonus * 100)}%
                  </small>
                </span>
              </div>
              {c.next !== null ? (
                <>
                  <Progress value={c.total} max={c.next} label={`${t.name} 다음 인증까지`} />
                  <small className="muted">
                    다음 {CERT_TIER_TEXT[c.reached].icon} {CERT_TIER_TEXT[c.reached].name}: {fmtStreams(c.total)} / {fmtStreams(c.next)}
                  </small>
                </>
              ) : (
                <small className="muted">모든 인증을 받을 수 있어요 ({CERT_TIER_COUNT}/{CERT_TIER_COUNT}) ✨</small>
              )}
              {c.reached > c.claimed && (
                <button type="button" className="btn btn-accent btn-wide" onClick={() => doClaimCert(p)}>
                  인증 받기 {CERT_TIER_TEXT[c.reached - 1].icon} {CERT_TIER_TEXT[c.reached - 1].name} 💎 +{c.diamonds}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="card">
        <div className="card-row">
          <h3>🎧 스트리밍 정산</h3>
          <small className="muted">
            {perCoin}스트리밍 = 🪙 {fmtMult(revenue)} · {intervalMin >= 60 ? `${intervalMin / 60}시간` : `${intervalMin}분`}마다
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
        <p className="fineprint">정산하지 않은 스트리밍은 사라지지 않고 계속 쌓여요. 코인으로 바꾸고 남은 스트리밍은 다음 정산으로 넘어가요.</p>
      </div>

      <div className="card equip-card">
        <div className="card-row">
          <h3>
            <span aria-hidden>{DISTRIBUTOR_TEXT.icon}</span> {DISTRIBUTOR_TEXT.name} <small>Lv.{dist.level}</small>
          </h3>
          <small className="muted">최대 레벨 없음</small>
        </div>
        <p className="muted">{DISTRIBUTOR_TEXT.effect}</p>
        <dl className="before-after">
          <div>
            <dt>스트리밍 수익</dt>
            <dd>
              ×{fmtMult(dist.multBefore)} → <b>×{fmtMult(dist.multAfter)}</b>
            </dd>
          </div>
        </dl>
        <button type="button" className="btn btn-primary btn-wide" disabled={!dist.affordable} onClick={doBuyDistributor}>
          {dist.affordable ? `올리기 🪙 ${fmt(dist.cost)}` : `🪙 ${fmt(dist.cost)} 필요 (보유 ${fmt(Math.floor(g.coins))})`}
        </button>
      </div>
    </section>
  );
}
