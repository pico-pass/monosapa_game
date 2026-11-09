import { useCallback, useEffect, useState } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { fmt, fmtCountdown } from '../components/format';
import { api, errorText } from '../platform/api';
import { doClaimBoss } from '../store/gameStore';
import { refreshSummary } from '../store/socialStore';

type BossKind = 'concert' | 'manual' | 'rhythm' | 'survival' | 'lyric';

interface BossInfo {
  id: string;
  name: string;
  icon: string;
  line: string;
  weak: BossKind;
}
interface Contributor {
  rank: number;
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  damage: number;
  me: boolean;
}
interface FeedItem {
  name: string;
  kind: BossKind;
  damage: number;
  at: number;
}
interface LastWeek {
  boss: BossInfo;
  target: number;
  total: number;
  cleared: boolean;
  myDamage: number;
  myRank: number | null;
  /** 받을 수 있는 순위 보상(다이아). 없거나 받았으면 null */
  reward: number | null;
  claimed: boolean;
}
interface BossOverview {
  week: number;
  endsAt: number;
  boss: BossInfo;
  target: number;
  total: number;
  /** 지금 닿은 단계 0~5 */
  tier: number;
  tierRewards: number[];
  /** 받은 단계 수 */
  claimedTiers: number;
  /** 지금 받을 수 있는 단계 보상 합(다이아) */
  claimable: number;
  myDamage: number;
  myHits: number;
  todayHits: number;
  dailyCap: number;
  players: number;
  top: Contributor[];
  mine: Contributor | null;
  feed: FeedItem[];
  last: LastWeek | null;
}

const KIND_TEXT: Record<BossKind, string> = { concert: '일반 공연', manual: '직접 공연', rhythm: '리듬', survival: '생존', lyric: '가사 덱' };
const REFRESH_MS = 20_000;

/** 월드 보스: 한 주 동안 모두의 공연·아케이드 점수가 데미지로 쌓여요. 닿은 단계마다 전원이 보상을 받아요. */
export function BossScreen() {
  const [data, setData] = useState<BossOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await api<BossOverview>('boss'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const a = setInterval(() => void load(), REFRESH_MS);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [load]);

  const claim = async (last: boolean) => {
    setBusy(true);
    await doClaimBoss(last);
    await load();
    void refreshSummary();
    setBusy(false);
  };

  return (
    <section className="screen" aria-label="월드 보스">
      <h2 className="section-title">월드 보스</h2>
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">불러오는 중…</p>}
      {data && (
        <>
          <div className="card boss-card">
            <div className="card-row">
              <h3>
                <span aria-hidden>{data.boss.icon}</span> {data.boss.name}
              </h3>
              <small className="muted">마감까지 {fmtCountdown(Math.max(0, data.endsAt - now))}</small>
            </div>
            <p className="muted">{data.boss.line}</p>
            <div className="boss-bar" role="progressbar" aria-label="보스 체력" aria-valuemin={0} aria-valuemax={data.target} aria-valuenow={Math.min(data.total, data.target)}>
              <div className="boss-bar-fill" style={{ width: `${Math.max(0, 100 - Math.min(100, (data.total / data.target) * 100))}%` }} />
              {data.tierRewards.map((_, i) => (
                <span key={i} className={`boss-tick${data.tier > i ? ' boss-tick-hit' : ''}`} style={{ left: `${100 - ((i + 1) / data.tierRewards.length) * 100}%` }} aria-hidden />
              ))}
            </div>
            <p className="fineprint">
              모두가 모은 데미지 {fmt(data.total)} / 목표 {fmt(data.target)} · {data.players}명 참여 · 단계 {data.tier}/{data.tierRewards.length}
            </p>
            <p>
              ⚔️ 약점은 <b>{KIND_TEXT[data.boss.weak]}</b>! 이 게임의 점수는 데미지가 2배예요.
            </p>
            <p className="muted">
              오늘 {data.todayHits}/{data.dailyCap}타 · 이번 주 내 데미지 <b>{fmt(data.myDamage)}</b> ({data.myHits}타)
            </p>
            <p className="fineprint">공연이나 아케이드(리듬·생존·가사 덱)를 끝내면 점수가 자동으로 보스에게 들어가요. 점수가 높을수록, S등급일수록 아파요.</p>
          </div>

          <div className="card">
            <div className="card-row">
              <h3>🎁 단계 보상</h3>
              <small className="muted">전원 💎</small>
            </div>
            <ol className="boss-tiers">
              {data.tierRewards.map((d, i) => (
                <li key={i} className={data.tier > i ? 'boss-tier-hit' : ''}>
                  <span>{(i + 1) * (100 / data.tierRewards.length)}%</span>
                  <b>💎 {d}</b>
                  <small>{data.claimedTiers > i ? '받음' : data.tier > i ? '받을 수 있어요' : '—'}</small>
                </li>
              ))}
            </ol>
            <button type="button" className="btn btn-primary btn-wide" disabled={busy || data.claimable < 1} onClick={() => void claim(false)}>
              {data.claimable < 1 ? (data.myHits < 1 ? '한 번이라도 때려야 받을 수 있어요' : '받을 보상이 없어요') : `💎 ${data.claimable} 받기`}
            </button>
          </div>

          {data.last && (
            <div className="card">
              <div className="card-row">
                <h3>
                  지난주 {data.last.boss.icon} {data.last.boss.name}
                </h3>
                <strong>{data.last.cleared ? '격퇴!' : '놓쳤어요'}</strong>
              </div>
              <p className="muted">
                모은 데미지 {fmt(data.last.total)} / 목표 {fmt(data.last.target)} · 내 데미지 {fmt(data.last.myDamage)}
                {data.last.myRank ? ` · ${data.last.myRank}위` : ''}
              </p>
              {data.last.reward !== null && (
                <button type="button" className="btn btn-accent btn-wide" disabled={busy} onClick={() => void claim(true)}>
                  순위 보상 💎 {data.last.reward} 받기
                </button>
              )}
              {data.last.reward === null && data.last.claimed && <small className="muted">순위 보상을 받았어요.</small>}
            </div>
          )}

          <div className="card">
            <div className="card-row">
              <h3>🏅 이번 주 기여 순위</h3>
            </div>
            {data.top.length === 0 ? (
              <p className="muted">아직 아무도 때리지 않았어요. 첫 타격의 주인공이 되어 보세요!</p>
            ) : (
              <ol className="boss-top">
                {data.top.map((c) => (
                  <li key={c.uid} className={c.me ? 'rank-me' : ''}>
                    <span className="rank-no">{c.rank <= 3 ? ['🥇', '🥈', '🥉'][c.rank - 1] : c.rank}</span>
                    <Avatar name={c.name} picture={c.picture} avatar={c.avatar} />
                    <span className="boss-name">{c.name}</span>
                    <b>{fmt(c.damage)}</b>
                  </li>
                ))}
              </ol>
            )}
            {data.mine && !data.top.some((c) => c.me) && (
              <p className="muted">
                내 순위 {data.mine.rank}위 · {fmt(data.mine.damage)}
              </p>
            )}
          </div>

          {data.feed.length > 0 && (
            <div className="card">
              <div className="card-row">
                <h3>💥 최근 타격</h3>
              </div>
              <ul className="boss-feed">
                {data.feed.map((f, i) => (
                  <li key={i}>
                    <span>{f.name}</span>
                    <small className="muted">{KIND_TEXT[f.kind]}</small>
                    <b>+{fmt(f.damage)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
