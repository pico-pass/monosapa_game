/**
 * 순회공연 시뮬레이션. 실행: npm run sim:tour
 * 진행도(팬·장비·클릭 레벨)가 다른 계정이 도시 12곳을 자아별로 공연했을 때의 비율(전투력 배율 × 궁합 ÷ 도시 난이도)과 등급, 그리고 대표 노선의 보상을 보여 준다.
 * 장비·클릭이 다 차기 전에는 4~5단계 도시가 B~C, 끝판에야 뉴욕이 A가 되게 난이도를 맞췄다(전투력 배율은 레벨에 따른 기본 전투력을 뺀 값이라 후반에도 투자·노선이 등급을 가른다).
 * 한 투어(약 2~3시간)의 보상은 인세 약 20~50분 분량·팬 0.2~0.8% 안팎.
 */
import { TOUR_CITIES, tourCityById } from '../src/game/balance';
import { createInitialState } from '../src/game/persistence';
import { gradeOf, routeSynergy, tourPlan, TOUR_GRADES, cityDifficulty, powerMult } from '../src/game/tour';
import type { GameState, TourCityId } from '../src/game/types';

const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime();

/**
 * 진행도 단계: 장비는 종류마다 최대 20레벨(합계 60), 클릭 업그레이드는 전투력에 100레벨까지, 전투력 보너스(레벨 스킬 「전투력」·수집품)는 skillPower로 흉내 낸다.
 * 장비·클릭이 거의 다 찬 뒤에는 보너스가 배율을 더 올린다.
 */
const STAGES: { name: string; fans: number; gear: number; click: number; skillPower: number }[] = [
  { name: '월클 직후', fans: 150_000, gear: 36, click: 30, skillPower: 0 },
  { name: '중반', fans: 2_000_000, gear: 54, click: 80, skillPower: 20 },
  { name: '후반', fans: 50_000_000, gear: 60, click: 100, skillPower: 60 },
  { name: '끝판', fans: 2_000_000_000, gear: 60, click: 100, skillPower: 150 },
];

function stateOf(fans: number, gear: number, click: number, skillPower: number): GameState {
  const s = createInitialState(T0);
  const per = Math.ceil(gear / 3);
  const concerts = { ...s.concerts, world: { ...s.concerts.world, cleared: true } };
  return {
    ...s,
    fans,
    lastSettledAt: T0,
    concerts,
    equipment: { mic: per, studio: per, promotion: per },
    darkEquipment: { mic: per, studio: per, promotion: per },
    musicPower: click,
    dripPower: click,
    skills: { ...s.skills, power: skillPower },
  };
}

for (const st of STAGES) {
  const s = stateOf(st.fans, st.gear, st.click, st.skillPower);
  const pn = powerMult(s, 'normal');
  const pd = powerMult(s, 'dark');
  console.log(`\n[${st.name}] 팬 ${st.fans.toLocaleString('ko-KR')} · 전투력 배율 일반 ×${pn.toFixed(2)} / 어둠 ×${pd.toFixed(2)}`);
  console.log('  도시(단계)        난이도   일반 비율/등급   어둠 비율/등급');
  for (const c of TOUR_CITIES) {
    const d = cityDifficulty(c.id);
    const rn = (pn * c.affinity.normal) / d;
    const rd = (pd * c.affinity.dark) / d;
    console.log(`  ${c.id.padEnd(10)}(${c.tier}) ${d.toFixed(1).padStart(8)}   ${rn.toFixed(2).padStart(6)} ${TOUR_GRADES[gradeOf(rn)]}        ${rd.toFixed(2).padStart(6)} ${TOUR_GRADES[gradeOf(rd)]}`);
  }
  const routes: [string, TourCityId[]][] = [
    ['유럽 순회(서울→두바이→이스탄불→런던→파리)', ['dubai', 'istanbul', 'london', 'paris']],
    ['아시아 순회(서울→도쿄→방콕→싱가포르)', ['tokyo', 'bangkok', 'singapore']],
    ['대륙 횡단(서울→도쿄→LA→뉴욕)', ['tokyo', 'la', 'newyork']],
  ];
  for (const [name, route] of routes) {
    const personas = route.map((id) => {
      const def = tourCityById(id)!;
      return pd * def.affinity.dark > pn * def.affinity.normal ? ('dark' as const) : ('normal' as const);
    });
    const plan = tourPlan(s, route, personas);
    const grades = plan.legs.map((l) => TOUR_GRADES[l.grade]).join('');
    const syn = route.map((_, i) => routeSynergy(route, i).toFixed(2)).join(',');
    console.log(`  ${name}: ${plan.totalMs / 3600_000 >= 1 ? (plan.totalMs / 3600_000).toFixed(1) + '시간' : Math.round(plan.totalMs / 60_000) + '분'} · 등급 ${grades} · 시너지 ${syn} · 인세 ${Math.round(plan.legs.reduce((a, l) => a + l.coinSecs, 0) / 60)}분 분량 · 팬 +${((plan.fans / s.fans) * 100).toFixed(2)}%`);
  }
}
