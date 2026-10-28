/**
 * 성장 속도 시뮬레이션 (기획서 10장·14장 12번). 실행: npm run sim
 */
import { run, type Scenario } from './bot';

const fmt = (sec: number | undefined) => {
  if (sec === undefined) return '   -   ';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(3)}분${String(s).padStart(2, '0')}초`;
};

const scenarios: Scenario[] = [
  { label: '방치·일반만', strategy: 'normal', clicksPerSec: 0 },
  { label: '방치·어둠우선', strategy: 'dark', clicksPerSec: 0 },
  { label: '방치·혼합(과열회피)', strategy: 'mixed', clicksPerSec: 0 },
  { label: '클릭1/s·일반만', strategy: 'normal', clicksPerSec: 1 },
  { label: '클릭1/s·혼합', strategy: 'mixed', clicksPerSec: 1 },
  { label: '풀클릭2/s·혼합', strategy: 'mixed', clicksPerSec: 2 },
];

console.log('시나리오'.padEnd(22), '첫발매    첫구매    첫앨범    팬100     방구석    팬400     지하클럽  팬1200    첫투어');
for (const sc of scenarios) {
  const { m, end } = run(sc);
  console.log(
    sc.label.padEnd(22),
    [m.firstSingle, m.firstBuy, m.firstAlbum, m.fans100, m.roomClear, m.fans400, m.clubClear, m.fans1200, m.tourDone]
      .map(fmt)
      .join(' '),
  );
  const gaps = m.buyGaps.slice(0, 40);
  const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
  console.log(
    ' '.repeat(22),
    `전환 ${m.switches}회, 압수 ${m.seizures}회, 어둠 체류 ${Math.round((m.darkSeconds / Math.max(1, m.tourDone ?? 21600)) * 100)}%,`,
    `싱글 ${end.singles.length}곡, 앨범 ${end.albums.length}장, 장비 ${end.equipment.mic}/${end.equipment.studio}/${end.equipment.promotion},`,
    `구매 간격 평균(앞 40회) ${avgGap}초`,
  );
}
