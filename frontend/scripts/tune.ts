/**
 * 밸런스 상수 탐색(무작위 탐색). 실행: npx tsx scripts/tune.ts [샘플 수]
 * balance.ts의 값을 런타임에 덮어쓰며 방치·혼합 봇이 목표 시각에 가까운 조합을 찾는다. (파일은 수정하지 않는다)
 */
import { BALANCE } from '../src/game/balance';
import { run } from './bot';

type Mut = {
  single: Record<'normal' | 'dark', { rhymeGrowth: number; fanGrowth: number; coinGrowth: number; fanBase: number }>;
  equipment: Record<'mic' | 'studio' | 'promotion', { base: number; growth: number }>;
};
const B = BALANCE as unknown as Mut;
const orig = JSON.parse(JSON.stringify(B)) as Mut;

// 방치·혼합 봇 기준 목표(초): 첫 앨범 8분, 방구석 9분, 지하클럽 30분, 첫 투어 90분
const targets = { firstAlbum: 480, room: 540, club: 1800, tour: 5400 };

let seed = Number(process.argv[3] ?? 7);
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const uni = (a: number, b: number) => a + (b - a) * rnd();
const logUni = (a: number, b: number) => Math.exp(uni(Math.log(a), Math.log(b)));

const N = Number(process.argv[2] ?? 600);
const rows: { score: number; wall?: number; p: Record<string, number>; t: Record<string, number | undefined> }[] = [];
for (let i = 0; i < N; i++) {
  const p = {
    rhymeGrowth: uni(1.18, 1.34),
    fanGrowth: uni(1.03, 1.2),
    singleFanBase: logUni(4, 12),
    equipScale: logUni(1, 12),
    equipGrowth: uni(1.4, 1.9),
    coinGrowth: uni(1.08, 1.22),
  };
  for (const persona of ['normal', 'dark'] as const) {
    B.single[persona].rhymeGrowth = p.rhymeGrowth;
    B.single[persona].fanGrowth = p.fanGrowth;
    B.single[persona].fanBase = p.singleFanBase;
    B.single[persona].coinGrowth = p.coinGrowth;
  }
  for (const k of ['mic', 'studio', 'promotion'] as const) {
    B.equipment[k].base = orig.equipment[k].base * p.equipScale;
    B.equipment[k].growth = p.equipGrowth + (k === 'studio' ? 0.1 : 0);
  }
  const { m } = run({ label: 'x', strategy: 'mixed', clicksPerSec: 0 });
  const t: Record<string, number | undefined> = { firstAlbum: m.firstAlbum, room: m.roomClear, club: m.clubClear, tour: m.tourDone };
  let score = 0;
  for (const key of Object.keys(targets) as (keyof typeof targets)[]) {
    score += Math.log((t[key] ?? 43200) / targets[key]) ** 2;
  }
  const times = m.singleTimes;
  let wall = 0;
  for (let j = 1; j < times.length; j++) wall = Math.max(wall, times[j] - times[j - 1]);
  score += 0.5 * Math.max(0, Math.log(wall / 900)) ** 2;
  rows.push({ score, wall, p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(3)])), t });
}
rows.sort((a, b) => a.score - b.score);
for (const r of rows.slice(0, 10)) console.log(r.score.toFixed(3), JSON.stringify(r.p), JSON.stringify(r.t), "wall", r.wall);
