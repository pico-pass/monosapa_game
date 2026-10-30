import { useEffect, useState } from 'react';
import { fmt } from '../components/format';
import { playerLevel } from '../game/selectors';
import { useUi } from '../store/gameStore';

interface Entry {
  rank: number;
  name: string;
  picture: string | null;
  level: number;
  fans: number;
  me: boolean;
}
interface TowerEntry {
  rank: number;
  name: string;
  picture: string | null;
  floor: number;
  level: number;
  me: boolean;
}
interface Board<E> {
  entries: E[];
  mine: E | null;
  total: number;
}

const REFRESH_MS = 30_000;

/** 서버 랭킹 한 판을 주기적으로 불러온다. */
function useBoard<E>(path: string): { data: Board<E> | null; error: boolean } {
  const [data, setData] = useState<Board<E> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    const load = async () => {
      try {
        const res = await fetch(`/api/${path}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Board<E>;
        if (alive) {
          setData(body);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path]);

  return { data, error };
}

type Kind = 'level' | 'tower';

/** 랭킹. 서버에 저장된 진행 데이터 기준이라 내 기록은 저장이 올라간 뒤(최대 10초) 반영돼요. */
export function RankingScreen() {
  const { game: g } = useUi();
  const [kind, setKind] = useState<Kind>('level');
  return (
    <section className="screen" aria-label="랭킹">
      <h2 className="section-title">랭킹</h2>
      <div className="seg" role="group" aria-label="랭킹 종류">
        <button type="button" aria-pressed={kind === 'level'} onClick={() => setKind('level')}>
          레벨
        </button>
        <button type="button" aria-pressed={kind === 'tower'} onClick={() => setKind('tower')}>
          무한의 계단
        </button>
      </div>
      {kind === 'level' ? <LevelBoard level={playerLevel(g.fans)} /> : <TowerBoard best={g.arcade.tower.best} />}
    </section>
  );
}

function Status({ data, error }: { data: unknown; error: boolean }) {
  return (
    <>
      {error && !data && (
        <p className="muted" role="alert">
          랭킹을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.
        </p>
      )}
      {!data && !error && <p className="muted">불러오는 중…</p>}
    </>
  );
}

export function LevelBoard({ level }: { level: number }) {
  const { data, error } = useBoard<Entry>('ranking');
  const inList = data?.entries.some((e) => e.me) ?? false;
  return (
    <>
      <p className="muted">계정 레벨 순위예요. 레벨이 같으면 팬이 많은 쪽이 앞서요. 지금 내 레벨은 Lv.{level}이에요.</p>
      <Status data={data} error={error} />
      {data && (
        <>
          {data.entries.length === 0 ? (
            <p className="muted">아직 랭킹에 오른 계정이 없어요.</p>
          ) : (
            <ol className="rank-list" aria-label={`레벨 상위 ${data.entries.length}명`}>
              {data.entries.map((e) => (
                <RankRow key={e.rank} e={e} main={<b>Lv.{e.level}</b>} sub={`팬 ${fmt(Math.floor(e.fans))}명`} />
              ))}
            </ol>
          )}
          {data.mine && !inList && (
            <>
              <p className="rank-gap" aria-hidden>
                ⋮
              </p>
              <ol className="rank-list" start={data.mine.rank}>
                <RankRow e={data.mine} main={<b>Lv.{data.mine.level}</b>} sub={`팬 ${fmt(Math.floor(data.mine.fans))}명`} />
              </ol>
            </>
          )}
          <p className="fineprint">전체 {fmt(data.total)}명 · 30초마다 새로 불러와요</p>
        </>
      )}
    </>
  );
}

export function TowerBoard({ best }: { best: number }) {
  const { data, error } = useBoard<TowerEntry>('ranking/tower');
  const inList = data?.entries.some((e) => e.me) ?? false;
  return (
    <>
      <p className="muted">
        무한의 계단에서 가장 높이 깬 층 순위예요. 층이 같으면 먼저 가입한 쪽이 앞서요. {best > 0 ? `내 최고 기록은 ${best}층이에요.` : '한 층이라도 깨면 순위에 올라요.'}
      </p>
      <Status data={data} error={error} />
      {data && (
        <>
          {data.entries.length === 0 ? (
            <p className="muted">아직 계단을 오른 계정이 없어요.</p>
          ) : (
            <ol className="rank-list" aria-label={`계단 상위 ${data.entries.length}명`}>
              {data.entries.map((e) => (
                <RankRow key={e.rank} e={e} main={<b>{e.floor}층</b>} sub={`Lv.${e.level}`} />
              ))}
            </ol>
          )}
          {data.mine && !inList && (
            <>
              <p className="rank-gap" aria-hidden>
                ⋮
              </p>
              <ol className="rank-list" start={data.mine.rank}>
                <RankRow e={data.mine} main={<b>{data.mine.floor}층</b>} sub={`Lv.${data.mine.level}`} />
              </ol>
            </>
          )}
          <p className="fineprint">계단에 오른 {fmt(data.total)}명 · 역대 최고 기록 기준 · 30초마다 새로 불러와요</p>
        </>
      )}
    </>
  );
}

function RankRow({ e, main, sub }: { e: { rank: number; name: string; picture: string | null; me: boolean }; main: React.ReactNode; sub: string }) {
  return (
    <li className={`rank-row${e.me ? ' rank-me' : ''}${e.rank <= 3 ? ` rank-top rank-${e.rank}` : ''}`} value={e.rank}>
      <span className="rank-no">{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
      {e.picture ? (
        <img className="rank-avatar" src={e.picture} alt="" referrerPolicy="no-referrer" width={32} height={32} loading="lazy" />
      ) : (
        <span className="rank-avatar rank-avatar-none" aria-hidden>
          {[...e.name][0]}
        </span>
      )}
      <span className="rank-name">
        {e.name}
        {e.me && <em>나</em>}
      </span>
      <span className="rank-lv">
        {main}
        <small>{sub}</small>
      </span>
    </li>
  );
}
