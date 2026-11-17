/**
 * 무대 디자인 빌더 점수 시뮬레이션. 실행: npm run sim:venue (ITER=40000 RESTARTS=6 으로 탐색량을 바꾼다)
 * 공연장을 클리어한 순서대로 장치가 해금될 때마다 「잘 짠 무대」(담금질로 찾은 최고 점수에 가까운 배치)의 점수와 등급을 보여 준다.
 * 같이 무작위로 아무렇게나 놓은 무대(보통 사람의 첫 시도에 가까운 쪽)의 점수 분포와 등급도 보여서 등급 경계(BALANCE.venue.gradeMin)를 맞출 때 쓴다.
 * 목표: 처음 장치만으로 C, 중반(단콘~대형 콘서트)에 B~A, 월클 이후 아주 잘 짠 무대만 S. 분위기 장치(어둠 무대)는 같은 칸 수로 더 높은 점수를 낼 수 있다.
 * (처음 제안값 경계 10·24·40·56·72는 처음 장치만으로 D까지만 닿고 대형 콘서트 이전에 S가 나와서 8·18·36·60·84로 올려 맞췄다.)
 */
import { BALANCE, STAGES, VENUE_DEVICES, type VenueDeviceDef } from '../src/game/balance';
import { GRADE_LETTERS, VENUE_CELLS, scoreVenue, type VenueCells } from '../src/game/venue';
import type { Persona, StageId } from '../src/game/types';

const ITER = Number(process.env.ITER ?? 40000);
const RESTARTS = Number(process.env.RESTARTS ?? 6);

/** 같은 결과가 나오게 하는 작은 난수(mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function counts(cells: VenueCells): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cells) if (c) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

function anneal(devices: readonly VenueDeviceDef[], theme: Persona, seed: number): { cells: VenueCells; total: number } {
  const rand = rng(seed);
  const cells: VenueCells = Array.from({ length: VENUE_CELLS }, () => null);
  const used = counts(cells);
  const canPlace = (d: VenueDeviceDef) => (used.get(d.id) ?? 0) < d.max;
  let best = { cells: cells.slice(), total: scoreVenue(cells, theme).total };
  let cur = best.total;
  for (let i = 0; i < ITER; i++) {
    const temp = 3 * (1 - i / ITER) + 0.05;
    const idx = Math.floor(rand() * VENUE_CELLS);
    const before = cells[idx];
    const pick = rand() < 0.2 ? null : devices[Math.floor(rand() * devices.length)];
    if (pick && pick.id !== before && !canPlace(pick)) continue;
    cells[idx] = pick ? pick.id : null;
    const total = scoreVenue(cells, theme).total;
    if (total >= cur || rand() < Math.exp((total - cur) / temp)) {
      cur = total;
      if (before) used.set(before, (used.get(before) ?? 1) - 1);
      if (pick) used.set(pick.id, (used.get(pick.id) ?? 0) + 1);
      if (total > best.total) best = { cells: cells.slice(), total };
    } else {
      cells[idx] = before;
    }
  }
  return best;
}

function randomVenue(devices: readonly VenueDeviceDef[], rand: () => number, fill: number): VenueCells {
  const cells: VenueCells = Array.from({ length: VENUE_CELLS }, () => null);
  const used = new Map<string, number>();
  for (let k = 0; k < Math.round(VENUE_CELLS * fill); k++) {
    const d = devices[Math.floor(rand() * devices.length)];
    const idx = Math.floor(rand() * VENUE_CELLS);
    if (cells[idx] || (used.get(d.id) ?? 0) >= d.max) continue;
    cells[idx] = d.id;
    used.set(d.id, (used.get(d.id) ?? 0) + 1);
  }
  return cells;
}

const letter = (grade: number) => GRADE_LETTERS[grade];
const stagesInOrder: StageId[] = STAGES.map((s) => s.id);

console.log(`등급 경계(gradeMin): ${BALANCE.venue.gradeMin.map((m, i) => `${letter(i)}≥${m}`).join(' ')}`);
console.log('');
console.log('해금 단계                장치 수 | 일반 무대: 최고 점수(등급) 무작위 평균(등급)   | 어둠 무대: 최고 점수(등급) 무작위 평균(등급)');

const tiers: { label: string; clear: StageId | null }[] = [{ label: '처음(조명·스피커·안전바)', clear: null }, ...stagesInOrder.map((id) => ({ label: `${id} 클리어`, clear: id }))];
const cleared = new Set<StageId>();
for (const t of tiers) {
  if (t.clear) cleared.add(t.clear);
  const devices = VENUE_DEVICES.filter((d) => d.unlock === null || cleared.has(d.unlock));
  const cols: string[] = [];
  for (const theme of ['normal', 'dark'] as const) {
    let best = 0;
    for (let r = 0; r < RESTARTS; r++) best = Math.max(best, anneal(devices, theme, 1000 + r * 17).total);
    const rand = rng(77);
    let sum = 0;
    const n = 400;
    for (let k = 0; k < n; k++) sum += scoreVenue(randomVenue(devices, rand, 0.5), theme).total;
    const avg = sum / n;
    cols.push(`${best.toFixed(1).padStart(6)} (${letter(gradeOf(best))}) ${avg.toFixed(1).padStart(6)} (${letter(gradeOf(avg))})`);
  }
  console.log(`${t.label.padEnd(24)} ${String(devices.length).padStart(3)}    | ${cols[0]} | ${cols[1]}`);
}

function gradeOf(total: number): number {
  let g = 0;
  BALANCE.venue.gradeMin.forEach((min, i) => {
    if (total >= min) g = i;
  });
  return g;
}
