import { useCallback, useEffect, useState } from 'react';
import { PersonaBadge } from '../components/parts';
import { api, errorText } from '../platform/api';
import type { Persona } from '../game/types';
import { doClaimChart, useUi } from '../store/gameStore';

interface Row {
  rank: number;
  change: number | null;
  title: string;
  artist: string;
  persona: Persona;
  mine: boolean;
  revival: boolean;
}
interface Chart {
  hourAt: number;
  entries: Row[];
  claim: { available: boolean; bestRank: number | null; bestTitle: string | null; diamonds: number; claimedToday: boolean };
}

const REFRESH_MS = 60_000;

function Change({ change }: { change: number | null }) {
  if (change === null) return <small className="chart-new">NEW</small>;
  if (change === 0) return <small className="muted">－</small>;
  return <small className={change > 0 ? 'chart-up' : 'chart-down'}>{change > 0 ? `▲${change}` : `▼${-change}`}</small>;
}

/** 실시간 음원 차트: 모든 계정의 싱글과 NPC 곡이 시간대별로 순위를 겨뤄요. */
export function ChartScreen() {
  const { game: g } = useUi();
  const [data, setData] = useState<Chart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Chart>('chart'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const hour = data ? new Date(data.hourAt).getHours() : 0;
  return (
    <section className="screen" aria-label="음원 차트">
      <h2 className="section-title">실시간 음원 차트</h2>
      <p className="muted">
        {data ? `${hour}시 차트` : '불러오는 중…'} · 사람마다 상위 3곡이 올라가요. 팬이 많을수록, 새 곡일수록 유리하고 가끔 옛 곡이 역주행해요. 내 곡이 10위 안이면 하루 한 번 보상을 받아요.
      </p>
      {g.singles.length === 0 && <p className="empty">싱글을 발매하면 내 곡이 차트에 올라가요.</p>}
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          {data.claim.bestRank !== null && (
            <div className="card">
              <small className="muted">내 최고 순위</small>
              <strong>
                {data.claim.bestRank}위 · 「{data.claim.bestTitle}」
              </strong>
              {data.claim.available ? (
                <button
                  type="button"
                  className="btn btn-accent btn-wide"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await doClaimChart();
                    await load();
                    setBusy(false);
                  }}
                >
                  📈 순위 보상 받기 💎 {data.claim.diamonds}
                </button>
              ) : (
                <small className="muted">{data.claim.claimedToday ? '오늘 보상은 이미 받았어요.' : '10위 안에 들면 보상을 받을 수 있어요.'}</small>
              )}
            </div>
          )}
          <ol className="chart-list">
            {data.entries.map((e) => (
              <li key={e.rank} className={`chart-row${e.mine ? ' chart-mine' : ''}`}>
                <span className={`chart-rank${e.rank <= 3 ? ' chart-top' : ''}`}>{e.rank}</span>
                <div className="chart-main">
                  <strong>
                    {e.title} {e.revival && <small className="chart-rev">역주행</small>}
                  </strong>
                  <small className="muted">
                    {e.artist} <PersonaBadge persona={e.persona} />
                  </small>
                </div>
                <Change change={e.change} />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
