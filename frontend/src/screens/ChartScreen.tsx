import { useCallback, useEffect, useState } from 'react';
import { PERSONA_TEXT } from '../game/content';
import type { Persona } from '../game/types';
import { api, errorText } from '../platform/api';
import { doClaimChart, useUi } from '../store/gameStore';

interface Row {
  rank: number;
  change: number | null;
  title: string;
  artist: string;
  mine: boolean;
  revival: boolean;
}
interface List {
  total: number;
  entries: Row[];
}
interface Chart {
  hourAt: number;
  normal: List;
  dark: List;
  claim: { available: boolean; bestRank: number | null; bestPersona: Persona | null; bestTitle: string | null; diamonds: number; claimedToday: boolean };
}

const REFRESH_MS = 60_000;
const PAGE = 50;

function Change({ change }: { change: number | null }) {
  if (change === null) return <small className="chart-new">NEW</small>;
  if (change === 0) return <small className="muted">－</small>;
  return <small className={change > 0 ? 'chart-up' : 'chart-down'}>{change > 0 ? `▲${change}` : `▼${-change}`}</small>;
}

/** 실시간 음원 차트: 일반속성 곡 전체와 어둠속성 곡 전체가 각각 순위를 겨뤄요. */
export function ChartScreen() {
  const { game: g } = useUi();
  const [data, setData] = useState<Chart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [persona, setPersona] = useState<Persona>(g.activePersona);
  const [shown, setShown] = useState(PAGE);

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
  const list = data?.[persona] ?? null;
  return (
    <section className="screen" aria-label="음원 차트">
      <h2 className="section-title">실시간 음원 차트</h2>
      <p className="muted">
        {data ? `${hour}시 차트` : '불러오는 중…'} · 일반속성 곡 전체와 어둠속성 곡 전체가 각각 순위를 겨뤄요. 팬이 많을수록, 새 곡일수록 유리하고 가끔 옛 곡이 역주행해요. 내 곡이 10위 안이면 하루 한 번 보상을 받아요.
      </p>
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
                {data.claim.bestPersona ? PERSONA_TEXT[data.claim.bestPersona].short : ''} {data.claim.bestRank}위 · 「{data.claim.bestTitle}」
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
          <div className="seg" role="group" aria-label="차트 속성">
            {(['normal', 'dark'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={persona === p}
                onClick={() => {
                  setPersona(p);
                  setShown(PAGE);
                }}
              >
                {PERSONA_TEXT[p].short} ({data[p].total}곡)
              </button>
            ))}
          </div>
          {list && list.entries.length === 0 && <p className="empty">아직 {PERSONA_TEXT[persona].short}속성으로 발매된 곡이 없어요.</p>}
          {list && (
            <>
              <ol className="chart-list" aria-label={`${PERSONA_TEXT[persona].short}속성 차트`}>
                {list.entries.slice(0, shown).map((e) => (
                  <li key={e.rank} className={`chart-row${e.mine ? ' chart-mine' : ''}`} value={e.rank}>
                    <span className={`chart-rank${e.rank <= 3 ? ' chart-top' : ''}`}>{e.rank}</span>
                    <div className="chart-main">
                      <strong>
                        {e.title} {e.revival && <small className="chart-rev">역주행</small>}
                      </strong>
                      <small className="muted">{e.artist}</small>
                    </div>
                    <Change change={e.change} />
                  </li>
                ))}
              </ol>
              {shown < list.entries.length && (
                <button type="button" className="btn btn-ghost btn-wide" onClick={() => setShown(shown + PAGE)}>
                  더 보기 ({shown}/{list.entries.length})
                </button>
              )}
              {list.total > list.entries.length && <p className="fineprint">곡이 너무 많아 위쪽 {list.entries.length}곡만 보여 줘요.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
