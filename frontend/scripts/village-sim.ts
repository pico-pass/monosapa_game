/**
 * 팬 마을 성장 속도 시뮬레이션. 실행: npm run sim:village (DAYS=120 으로 일수를 바꾼다)
 * 팬은 6×6 땅이 열리는 100만 명으로 고정하고, 하루 N번 들러 ❤️를 수확하고 소식 카드(❤️ 쪽)를 고른 뒤
 * 가장 싼 건설·업그레이드부터 하는 단순한 봇이다. 건물은 정해진 순서로 가로줄부터 채운다(좋은 배치가 아니라 보통의 배치).
 * 건물 레벨 합계가 닿는 날과 그때의 시간당 ❤️·영구 보너스를 보여 준다. 전 건물 최대 레벨 합계는 210이다.
 */
import { BALANCE } from '../src/game/balance';
import { bonuses } from '../src/game/packdata';
import { createInitialState } from '../src/game/persistence';
import type { BuildingId, GameState } from '../src/game/types';
import { buildTile, chooseNews, harvestVillage, upgradeTile, villageView } from '../src/game/village';
import { heartCost, buildingMax, countOf, inWindow, totalLevels, villageEffects, villageSide } from '../src/game/villagedata';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = new Date(2026, 9, 28, 0, 0, 0).getTime();
const V = BALANCE.village;
const DAYS = Number(process.env.DAYS ?? 120);

const VISITS: Record<string, number[]> = {
  casual: [9, 15, 22],
  active: [8, 11, 14, 17, 20, 23],
  hardcore: Array.from({ length: 12 }, (_, i) => 7 + i * 1.5),
};

/** 짓는 순서(앞에서부터 가로줄로 채운다) */
const ORDER: BuildingId[] = ['cafe', 'goods', 'cafe', 'gallery', 'cafe', 'storage', 'cafe', 'park', 'practice', 'band', 'band', 'band', 'stall', 'stall', 'goods', 'gallery', 'practice', 'storage', 'park', 'park', 'plaza'];

function cellsOf(side: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) if (inWindow(i, side)) out.push(i);
  return out;
}

function run(who: string): void {
  let s: GameState = { ...createInitialState(T0), fans: 1_000_000, lastSettledAt: T0 };
  s = { ...s, village: { ...s.village, at: T0, hearts: V.startHearts } };
  const cells = cellsOf(villageSide(s.fans));
  const milestones = [25, 50, 100, 150, 200, 210];
  const reached: Record<number, number> = {};
  let spentTotal = 0;
  for (let day = 0; day < DAYS; day++) {
    for (const h of VISITS[who]) {
      s = { ...s, lastSettledAt: T0 + day * DAY + h * HOUR };
      for (const card of villageView(s).news) {
        const r = chooseNews(s, card.bucket, 'hearts');
        if (r.ok) s = r.state;
      }
      const hv = harvestVillage(s);
      if (hv.ok) s = hv.state;
      for (;;) {
        const v = villageView(s);
        // 다음에 지을 건물과 모든 업그레이드 중 가장 싼 것
        const placed = v.tiles.filter((t) => t).length;
        let best: { cost: number; act: () => GameState | null } | null = null;
        const next = ORDER[placed];
        if (next && countOf(v, next) < buildingMax(next)) {
          const idx = cells.find((i) => !v.tiles[i]);
          if (idx !== undefined) best = { cost: heartCost(next, 1), act: () => { const r = buildTile(s, idx, next); return r.ok ? r.state : null; } };
        }
        v.tiles.forEach((t, i) => {
          if (!t || t.lv >= V.maxLevel) return;
          const cost = heartCost(t.b, t.lv + 1);
          if (!best || cost < best.cost) best = { cost, act: () => { const r = upgradeTile(s, i); return r.ok ? r.state : null; } };
        });
        if (!best || v.hearts < best.cost) break;
        const nextState = (best as { act: () => GameState | null }).act();
        if (!nextState) break;
        spentTotal += (best as { cost: number }).cost;
        s = nextState;
      }
      const lv = totalLevels(s.village);
      for (const m of milestones) if (lv >= m && reached[m] === undefined) reached[m] = day + 1;
    }
  }
  const v = villageView(s);
  const fx = villageEffects(v);
  const b = bonuses(s);
  console.log(`\n[${who}] 하루 ${VISITS[who].length}번 방문, ${DAYS}일`);
  for (const m of milestones) console.log(`  건물 레벨 합계 ${m}: ${reached[m] === undefined ? '못 닿음' : `${reached[m]}일째`}`);
  console.log(`  최종: 합계 ${totalLevels(v)} · 시간당 ❤️ ${fx.perHour.toFixed(1)} · 쓴 ❤️ ${Math.round(spentTotal).toLocaleString()} · 다이아 ${s.diamonds}`);
  console.log(`  영구 보너스: 인세 +${(b.coin * 100).toFixed(1)}% · 팬 +${(b.fan * 100).toFixed(1)}% · 전투력 +${(b.power * 100).toFixed(1)}% · 라임 일반 +${(b.rhyme.normal * 100).toFixed(1)}% 어둠 +${(b.rhyme.dark * 100).toFixed(1)}% · 오프라인 +${Math.round(b.offlineMs / 60_000)}분`);
}

for (const who of Object.keys(VISITS)) run(who);
