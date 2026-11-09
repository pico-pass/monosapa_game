import { useEffect, useState } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { fmt } from '../components/format';
import { Presence } from '../components/parts';
import { nurtureLevel } from '../game/nurturedata';
import { playerLevel } from '../game/selectors';
import { useUi } from '../store/gameStore';
import { openProfile } from '../store/socialStore';

interface Entry {
  rank: number;
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  level: number;
  fans: number;
  seenAgoMs: number | null;
  me: boolean;
}
interface NurtureEntry {
  rank: number;
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  normal: number;
  dark: number;
  total: number;
  seenAgoMs: number | null;
  me: boolean;
}
interface TowerEntry {
  rank: number;
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  floor: number;
  level: number;
  seenAgoMs: number | null;
  me: boolean;
}
interface VillageEntry {
  rank: number;
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  fame: number;
  level: number;
  seenAgoMs: number | null;
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

type Kind = 'level' | 'tower' | 'nurture' | 'village';

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
        <button type="button" aria-pressed={kind === 'nurture'} onClick={() => setKind('nurture')}>
          육성
        </button>
        <button type="button" aria-pressed={kind === 'village'} onClick={() => setKind('village')}>
          마을
        </button>
      </div>
      {kind === 'level' && <LevelBoard level={playerLevel(g.fans)} />}
      {kind === 'tower' && <TowerBoard best={g.arcade.tower.best} />}
      {kind === 'village' && <VillageBoard fame={g.village.tiles.reduce((sum, t) => sum + (t?.lv ?? 0), 0)} />}
      {kind === 'nurture' && <NurtureBoard normal={nurtureLevel(g.nurture.normal.xp)} dark={nurtureLevel(g.nurture.dark.xp)} trained={g.nurture.normal.xp + g.nurture.dark.xp > 0} />}
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

export function NurtureBoard({ normal, dark, trained }: { normal: number; dark: number; trained: boolean }) {
  const { data, error } = useBoard<NurtureEntry>('ranking/nurture');
  const inList = data?.entries.some((e) => e.me) ?? false;
  const row = (e: NurtureEntry) => <RankRow key={e.rank} e={e} main={<b>합계 Lv.{e.total}</b>} sub={`일반 Lv.${e.normal} · 어둠 Lv.${e.dark}`} />;
  return (
    <>
      <p className="muted">
        모노사파 육성 순위예요. 일반과 어둠 육성 레벨을 더한 값이 높은 순이고, 같으면 성장도가 많은 쪽이 앞서요.{' '}
        {trained ? `지금 내 육성은 일반 Lv.${normal} · 어둠 Lv.${dark}이에요.` : '한 번이라도 돌보면 순위에 올라요.'}
      </p>
      <Status data={data} error={error} />
      {data && (
        <>
          {data.entries.length === 0 ? (
            <p className="muted">아직 육성을 시작한 계정이 없어요.</p>
          ) : (
            <ol className="rank-list" aria-label={`육성 상위 ${data.entries.length}명`}>
              {data.entries.map(row)}
            </ol>
          )}
          {data.mine && !inList && (
            <>
              <p className="rank-gap" aria-hidden>
                ⋮
              </p>
              <ol className="rank-list" start={data.mine.rank}>
                {row(data.mine)}
              </ol>
            </>
          )}
          <p className="fineprint">육성을 시작한 {fmt(data.total)}명 · 30초마다 새로 불러와요</p>
        </>
      )}
    </>
  );
}

export function VillageBoard({ fame }: { fame: number }) {
  const { data, error } = useBoard<VillageEntry>('ranking/village');
  const inList = data?.entries.some((e) => e.me) ?? false;
  const row = (e: VillageEntry) => <RankRow key={e.rank} e={e} main={<b>명성 {e.fame}</b>} sub={`Lv.${e.level}`} />;
  return (
    <>
      <p className="muted">
        팬 마을 명성 순위예요. 건물 레벨을 모두 더한 값이 높은 순이고, 같으면 먼저 가입한 쪽이 앞서요. {fame > 0 ? `지금 내 마을 명성은 ${fame}이에요.` : '건물을 하나라도 지으면 순위에 올라요.'}
      </p>
      <Status data={data} error={error} />
      {data && (
        <>
          {data.entries.length === 0 ? (
            <p className="muted">아직 마을을 지은 계정이 없어요.</p>
          ) : (
            <ol className="rank-list" aria-label={`마을 상위 ${data.entries.length}명`}>
              {data.entries.map(row)}
            </ol>
          )}
          {data.mine && !inList && (
            <>
              <p className="rank-gap" aria-hidden>
                ⋮
              </p>
              <ol className="rank-list" start={data.mine.rank}>
                {row(data.mine)}
              </ol>
            </>
          )}
          <p className="fineprint">마을을 지은 {fmt(data.total)}명 · 저장이 올라간 뒤 반영돼요 · 30초마다 새로 불러와요</p>
        </>
      )}
    </>
  );
}

/** 랭킹 한 줄. 누르면 그 사람의 프로필 창이 열려요(친구 추가·신고도 거기서 해요). */
function RankRow({ e, main, sub }: { e: { rank: number; uid: string; name: string; picture: string | null; avatar: AvatarKind; seenAgoMs: number | null; me: boolean }; main: React.ReactNode; sub: string }) {
  const open = () => openProfile(e.uid);
  return (
    <li
      className={`rank-row rank-clickable${e.me ? ' rank-me' : ''}${e.rank <= 3 ? ` rank-top rank-${e.rank}` : ''}`}
      value={e.rank}
      role="button"
      tabIndex={0}
      aria-label={`${e.name} 프로필 보기`}
      onClick={open}
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), open())}
    >
      <span className="rank-no">{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
      <Avatar name={e.name} picture={e.picture} avatar={e.avatar} />
      <span className="rank-name">
        <span className="rank-name-line">
          {e.name}
          {e.me && <em>나</em>}
        </span>
        <Presence agoMs={e.me ? 0 : e.seenAgoMs} />
      </span>
      <span className="rank-lv">
        {main}
        <small>{sub}</small>
      </span>
    </li>
  );
}
