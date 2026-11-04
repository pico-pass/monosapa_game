/**
 * 모노사파 육성 성장 속도 시뮬레이션. 실행: npm run sim:nurture (DAYS=120 으로 일수를 바꾼다)
 * 하루 N번 들러 허용되는 행동 중 성장도가 가장 큰 것부터 반복한다. 코인은 넉넉하다고 보고 쓴 인세 분량만 센다.
 */
import { nurtureActionsOf } from '../src/game/balance';
import { createInitialState } from '../src/game/persistence';
import { nurtureAct, nurtureView, previewNurture } from '../src/game/nurture';
import type { GameState, Persona } from '../src/game/types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = new Date(2026, 9, 28, 0, 0, 0).getTime();

const VISITS: Record<string, number[]> = {
  casual: [9, 15, 22], // 하루 3번
  active: [8, 11, 14, 17, 20, 23], // 하루 6번
  hardcore: Array.from({ length: 12 }, (_, i) => 7 + i * 1.5), // 90분마다
};

interface Out {
  days: Record<number, number>;
  spendSecsPerDay: number;
  actionsPerDay: number;
  final: number;
}

function run(persona: Persona, who: string, totalDays: number): Out {
  let s: GameState = { ...createInitialState(T0), fans: 80_000, coins: 1e13, lastSettledAt: T0 };
  const hours = VISITS[who];
  const days: Record<number, number> = {};
  let spent = 0;
  let acts = 0;
  const defs = nurtureActionsOf(persona);
  const level = () => nurtureView(s, persona).progress.level;
  for (let d = 0; d < totalDays; d++) {
    for (const h of hours) {
      s = { ...s, lastSettledAt: T0 + d * DAY + h * HOUR };
      for (let guard = 0; guard < 60; guard++) {
        const cand = defs
          .map((def) => previewNurture(s, persona, def))
          .filter((p) => p.blocked === null && p.def.kind !== 'sleep')
          .sort((a, b) => b.xp - a.xp);
        const v = nurtureView(s, persona);
        let pick = cand[0]?.def.id;
        // 많이 지쳤으면 먼저 잔다 (자는 동안은 다른 행동을 못 한다)
        const sleepDef = defs.find((x) => x.kind === 'sleep')!;
        const canSleep = previewNurture(s, persona, sleepDef).blocked === null;
        if (canSleep && (v.gauges.tired >= 60 || !pick)) pick = sleepDef.id;
        if (!pick) break;
        const def = defs.find((x) => x.id === pick)!;
        const r = nurtureAct(s, persona, pick);
        if (!r.ok) break;
        s = r.state;
        spent += def.costSecs;
        acts++;
        if (def.kind === 'sleep') break;
      }
      const L = level();
      for (const t of [5, 10, 15, 20, 25, 30, 35, 40]) if (L >= t && days[t] === undefined) days[t] = d + h / 24;
    }
  }
  return { days, spendSecsPerDay: spent / totalDays, actionsPerDay: acts / totalDays, final: level() };
}

const totalDays = Number(process.env.DAYS ?? 120);
for (const who of Object.keys(VISITS)) {
  for (const persona of ['normal', 'dark'] as const) {
    const o = run(persona, who, totalDays);
    const fmt = Object.entries(o.days)
      .map(([l, d]) => `L${l}:${d.toFixed(1)}d`)
      .join(' ');
    console.log(`${who.padEnd(8)} ${persona.padEnd(6)} final L${o.final} | ${fmt} | act/day ${o.actionsPerDay.toFixed(1)} spend ${(o.spendSecsPerDay / 60).toFixed(0)}분치/일`);
  }
}
