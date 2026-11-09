import { useCallback, useEffect, useState } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { VillageGrid } from '../components/VillageGrid';
import { fmt, fmtCountdown, fmtStreams } from '../components/format';
import { BALANCE, BUILDING_IDS } from '../game/balance';
import { BUILDING_TEXT, NEWS_TEXT, ZONE_TEXT, residentName } from '../game/content';
import type { BuildingId, Village, VillageTile } from '../game/types';
import { festivalBlocked, festivalCost, villageView } from '../game/village';
import { VILLAGE_CELLS, buildingMax, countOf, heartCost, heartsSpent, liveRate, stockCap, tileMult, villageEffects, villageSide, villageUnlocked, zoneOf } from '../game/villagedata';
import { api, errorText } from '../platform/api';
import { doBuildTile, doChooseNews, doClaimFlags, doDemolishTile, doHarvestVillage, doMoveTile, doSendFlag, doStartFestival, doUpgradeTile, useUi } from '../store/gameStore';

const V = BALANCE.village;
const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;
const hours = (n: number): string => `${Math.round(n * 10) / 10}시간`;

/** 팬 마을: 건물을 지어 ❤️와 영구 보너스를 만들고, 소식 카드를 고르고, 친구 마을에 응원 깃발을 꽂아요. */
export function VillageScreen() {
  const { game: g } = useUi();
  const [mode, setMode] = useState<'mine' | 'friends'>('mine');
  if (!villageUnlocked(g.fans)) {
    return (
      <section className="screen" aria-label="팬 마을">
        <h2 className="section-title">팬 마을</h2>
        <p className="muted">
          팬이 {fmtStreams(V.unlockFans)}명이 되면 팬들이 모여 사는 마을이 열려요. (지금 {fmtStreams(g.fans)}명)
        </p>
      </section>
    );
  }
  return (
    <section className="screen" aria-label="팬 마을">
      <h2 className="section-title">팬 마을</h2>
      <div className="seg" role="group" aria-label="마을 보기">
        <button type="button" aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>
          내 마을
        </button>
        <button type="button" aria-pressed={mode === 'friends'} onClick={() => setMode('friends')}>
          친구 마을
        </button>
      </div>
      {mode === 'mine' ? <MyVillage /> : <FriendVillages />}
    </section>
  );
}

/** 건물 하나가 지금 주는 효과(이웃 배율 포함): 그 건물을 뺀 마을과의 차이 */
function marginalText(v: Village, idx: number): string {
  const without = v.tiles.map((t, i) => (i === idx ? null : t));
  const a = villageEffects(v);
  const b = villageEffects({ tiles: without });
  const parts: string[] = [];
  if (a.perHour - b.perHour > 0) parts.push(`시간당 ❤️ +${Math.round((a.perHour - b.perHour) * 10) / 10}`);
  if (a.coin - b.coin > 0) parts.push(`인세 +${pct(a.coin - b.coin)}`);
  if (a.fan - b.fan > 0) parts.push(`팬 획득 +${pct(a.fan - b.fan)}`);
  if (a.power - b.power > 0) parts.push(`전투력 +${pct(a.power - b.power)}`);
  if (a.rhyme.normal - b.rhyme.normal > 0) parts.push(`일반 라임 +${pct(a.rhyme.normal - b.rhyme.normal)}`);
  if (a.rhyme.dark - b.rhyme.dark > 0) parts.push(`어둠 라임 +${pct(a.rhyme.dark - b.rhyme.dark)}`);
  if (a.offlineMs - b.offlineMs > 0) parts.push(`오프라인 +${Math.round((a.offlineMs - b.offlineMs) / 60_000)}분`);
  if (a.capHours - b.capHours > 0) parts.push(`저장 한도 +${hours(a.capHours - b.capHours)}`);
  return parts.length > 0 ? parts.join(' · ') : '이웃 건물을 키워 줘요';
}

function MyVillage() {
  const { game: g } = useUi();
  const v = villageView(g);
  const now = g.lastSettledAt;
  const side = villageSide(g.fans);
  const fx = villageEffects(v);
  const cap = stockCap(v);
  const [sel, setSel] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);

  const pick = (i: number) => {
    if (moving !== null) {
      if (i === moving) setMoving(null);
      else if (!v.tiles[i]) {
        doMoveTile(moving, i);
        setMoving(null);
        setSel(i);
      } else setSel(i);
      return;
    }
    setSel(i === sel ? null : i);
  };

  const t: VillageTile | null = sel !== null ? (v.tiles[sel] ?? null) : null;
  const stock = Math.floor(v.stock);
  const bonusLines: string[] = [];
  if (fx.rhyme.normal > 0) bonusLines.push(`일반 라임 +${pct(fx.rhyme.normal)}`);
  if (fx.rhyme.dark > 0) bonusLines.push(`어둠 라임 +${pct(fx.rhyme.dark)}`);
  if (fx.coin > 0) bonusLines.push(`인세 +${pct(fx.coin)}`);
  if (fx.fan > 0) bonusLines.push(`팬 획득 +${pct(fx.fan)}`);
  if (fx.power > 0) bonusLines.push(`전투력 +${pct(fx.power)}`);
  if (fx.offlineMs > 0) bonusLines.push(`오프라인 +${Math.round(fx.offlineMs / 60_000)}분`);

  return (
    <>
      <p className="muted">
        건물을 지으면 팬들이 모여들어요. ❤️는 팬카페가 만들고, 나머지 건물은 두 자아 모두에게 영구 보너스를 줘요. 땅은 팬이 늘수록 바깥으로 넓어져요.
      </p>

      <div className="stat-grid stat-grid-3">
        <div>
          <strong>❤️ {fmt(Math.floor(v.hearts))}</strong>
          <span>가진 하트</span>
        </div>
        <div>
          <strong>
            {fmt(stock)}/{fmt(Math.floor(cap))}
          </strong>
          <span>수확 대기</span>
        </div>
        <div>
          <strong>{Math.round(liveRate(v, now) * 10) / 10}</strong>
          <span>시간당 ❤️</span>
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-wide" disabled={stock < 1} onClick={doHarvestVillage}>
        {stock < 1 ? (cap > 0 ? '아직 쌓이는 중이에요' : '팬카페를 지으면 ❤️가 쌓여요') : `❤️ ${fmt(stock)} 수확하기`}
      </button>
      {(v.boostUntil > now || v.festivalUntil > now) && (
        <p className="fineprint">
          {v.boostUntil > now && `📣 응원 부스트 ×${V.boost.mult} · ${fmtCountdown(v.boostUntil - now)} `}
          {v.festivalUntil > now && `🎪 축제 ×${V.festival.mult} · ${fmtCountdown(v.festivalUntil - now)}`}
        </p>
      )}

      <div className="card">
        <div className="card-row">
          <h3>🏘️ 마을 효과</h3>
          <small className="muted">건물 레벨 합계 {v.tiles.reduce((s, x) => s + (x?.lv ?? 0), 0)}</small>
        </div>
        <p className="muted">{bonusLines.length > 0 ? bonusLines.join(' · ') : '아직 효과가 없어요. 건물을 지어 보세요.'}</p>
        <p className="fineprint">
          {ZONE_TEXT.normal.name}(왼쪽) · {ZONE_TEXT.twilight.name}(가운데) · {ZONE_TEXT.dark.name}(오른쪽). 합주실은 놓은 구역의 자아 라임을 올려요.
        </p>
      </div>

      <VillageGrid tiles={v.tiles} side={side} selected={sel} moving={moving !== null} onPick={pick} />

      {moving !== null && (
        <div className="card">
          <p>
            이사할 빈 칸을 눌러 주세요. (❤️ {V.moveCost}){' '}
            <button type="button" className="btn btn-ghost" onClick={() => setMoving(null)}>
              취소
            </button>
          </p>
        </div>
      )}

      {moving === null && sel !== null && !t && (
        <div className="card">
          <div className="card-row">
            <h3>건물 짓기</h3>
            <small className="muted">{ZONE_TEXT[zoneOf(sel)].name}</small>
          </div>
          <ul className="village-palette">
            {BUILDING_IDS.map((b) => {
              const text = BUILDING_TEXT[b];
              const cost = heartCost(b, 1);
              const full = countOf(v, b) >= buildingMax(b);
              return (
                <li key={b}>
                  <div>
                    <strong>
                      {text.icon} {text.name}
                    </strong>{' '}
                    <small className="muted">
                      {countOf(v, b)}/{buildingMax(b)}
                    </small>
                    <p className="muted">{text.effect}</p>
                  </div>
                  <button type="button" className="btn btn-primary" disabled={full || v.hearts < cost} onClick={() => doBuildTile(sel, b as BuildingId)}>
                    {full ? '다 지었어요' : `❤️ ${fmt(cost)}`}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {moving === null && sel !== null && t && (
        <div className="card">
          <div className="card-row">
            <h3>
              {BUILDING_TEXT[t.b].icon} {BUILDING_TEXT[t.b].name} <small>{t.lv}레벨</small>
            </h3>
            <small className="muted">이웃 효과 ×{Math.round(tileMult(v.tiles, sel) * 100) / 100}</small>
          </div>
          <p className="muted">{BUILDING_TEXT[t.b].effect}</p>
          <p>{marginalText(v, sel)}</p>
          <div className="village-actions">
            <button type="button" className="btn btn-primary" disabled={t.lv >= V.maxLevel || v.hearts < heartCost(t.b, t.lv + 1)} onClick={() => doUpgradeTile(sel)}>
              {t.lv >= V.maxLevel ? '최대 레벨' : `레벨 ${t.lv + 1} · ❤️ ${fmt(heartCost(t.b, t.lv + 1))}`}
            </button>
            <button type="button" className="btn btn-accent" disabled={v.hearts < V.moveCost} onClick={() => setMoving(sel)}>
              이사 · ❤️ {V.moveCost}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                doDemolishTile(sel);
                setSel(null);
              }}
            >
              철거 (+❤️ {fmt(Math.floor(heartsSpent(t.b, t.lv) * V.refundRate))})
            </button>
          </div>
        </div>
      )}

      <NewsCards v={v} />
      <Festival v={v} now={now} />
      <Dex v={v} />
      <p className="fineprint">
        땅 {side}×{side} ({VILLAGE_CELLS}칸 중 열린 칸) · ❤️는 접속하지 않아도 저장 한도까지 쌓여요.
      </p>
    </>
  );
}

function NewsCards({ v }: { v: Village }) {
  const perHour = villageEffects(v).perHour;
  const hearts = Math.max(V.news.minHearts, Math.ceil(perHour * V.news.heartsHours));
  return (
    <div className="card">
      <div className="card-row">
        <h3>📰 마을 소식</h3>
        <small className="muted">{hours(V.news.bucketMs / 3600_000)}마다 한 장 · 최대 {V.news.keep}장</small>
      </div>
      {v.news.length === 0 ? (
        <p className="muted">새 소식이 오면 여기에 떠요.</p>
      ) : (
        <ul className="village-news">
          {v.news.map((n) => (
            <li key={n.bucket}>
              <p>{NEWS_TEXT[n.kind % NEWS_TEXT.length].replace('{name}', residentName(n.resident))}</p>
              <div className="village-actions">
                <button type="button" className="btn btn-primary" onClick={() => doChooseNews(n.bucket, 'hearts')}>
                  ❤️ +{fmt(hearts)} 받기
                </button>
                <button type="button" className="btn btn-accent" onClick={() => doChooseNews(n.bucket, 'boost')}>
                  📣 부스트 {V.boost.ms / 3600_000}시간 ×{V.boost.mult}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Festival({ v, now }: { v: Village; now: number }) {
  const blocked = festivalBlocked(v, now);
  const cost = festivalCost(v);
  return (
    <div className="card">
      <div className="card-row">
        <h3>🎪 마을 축제</h3>
        <small className="muted">주 1회</small>
      </div>
      <p className="muted">
        광장이 있으면 축제를 열 수 있어요. {V.festival.ms / 3600_000}시간 동안 ❤️ 생산이 {V.festival.mult}배가 돼요. 비용은 시간당 생산의 {V.festival.costHours}시간치예요.
      </p>
      <button type="button" className="btn btn-primary btn-wide" disabled={blocked !== null || v.hearts < cost} onClick={doStartFestival}>
        {blocked === 'need_plaza' ? '광장을 먼저 지어 주세요' : blocked === 'festival_used' ? (v.festivalUntil > now ? `축제 중 · ${fmtCountdown(v.festivalUntil - now)}` : '이번 주에는 이미 열었어요') : `축제 열기 · ❤️ ${fmt(cost)}`}
      </button>
    </div>
  );
}

function Dex({ v }: { v: Village }) {
  const next = V.dex.find((d) => v.dex.length < d.count);
  return (
    <div className="card">
      <div className="card-row">
        <h3>📖 주민 도감</h3>
        <strong>
          {v.dex.length}/{V.news.residents}
        </strong>
      </div>
      <div className="progress" aria-hidden>
        <div className="progress-fill" style={{ width: `${(v.dex.length / V.news.residents) * 100}%` }} />
      </div>
      <p className="muted">
        소식 카드를 고르면 그 주민을 만나요. {next ? `${next.count}명을 만나면 💎 ${next.diamonds}!` : '주민을 모두 만났어요!'}
      </p>
      {v.dex.length > 0 && (
        <p className="fineprint">{v.dex.map((n) => residentName(n)).join(' · ')}</p>
      )}
    </div>
  );
}

/* ---------- 친구 마을 ---------- */

interface FriendRow {
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
}
interface FriendVillageView {
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  side: number;
  fame: number;
  tiles: (VillageTile | null)[];
  flaggedToday: boolean;
}

function FriendVillages() {
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [view, setView] = useState<FriendVillageView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([api<{ friends: FriendRow[] }>('friends'), api<{ pending: number }>('village/flags')]);
      setFriends(f.friends);
      setPending(p.pending);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const open = async (uid: string) => {
    try {
      setView(await api<FriendVillageView>(`village/${uid}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const flag = async (uid: string) => {
    if (await doSendFlag(uid)) await open(uid);
  };
  const claim = async () => {
    if (await doClaimFlags()) await load();
  };

  return (
    <>
      <p className="muted">친구 마을에 하루 한 번 응원 깃발을 꽂으면 나도 친구도 ❤️를 받아요.</p>
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
      <div className="card">
        <div className="card-row">
          <h3>🚩 받은 깃발</h3>
          <strong>{pending}개</strong>
        </div>
        <button type="button" className="btn btn-primary btn-wide" disabled={pending < 1} onClick={() => void claim()}>
          {pending < 1 ? '받을 깃발이 없어요' : `깃발 ${pending}개 ❤️로 받기`}
        </button>
      </div>

      {view && (
        <div className="card">
          <div className="card-row">
            <h3>
              <Avatar name={view.name} picture={view.picture} avatar={view.avatar} /> {view.name}의 마을
            </h3>
            <small className="muted">명성 {view.fame}</small>
          </div>
          <VillageGrid tiles={view.tiles} side={view.side} />
          <div className="village-actions">
            <button type="button" className="btn btn-primary" disabled={view.flaggedToday} onClick={() => void flag(view.uid)}>
              {view.flaggedToday ? '오늘은 이미 꽂았어요' : '🚩 응원 깃발 꽂기'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setView(null)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {!friends && !error && <p className="muted">불러오는 중…</p>}
      {friends && friends.length === 0 && <p className="muted">아직 친구가 없어요. 더보기의 「친구」에서 친구를 추가해 보세요.</p>}
      {friends && friends.length > 0 && (
        <ul className="village-friends">
          {friends.map((f) => (
            <li key={f.uid}>
              <Avatar name={f.name} picture={f.picture} avatar={f.avatar} />
              <span>{f.name}</span>
              <button type="button" className="btn btn-accent" onClick={() => void open(f.uid)}>
                놀러 가기
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
