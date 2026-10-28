/**
 * 시뮬레이션 봇. 게임 엔진·명령을 그대로 호출하며 1초 단위로 플레이한다.
 * 정책: 발매 가능하면 즉시 발매, 앨범·장비 중 가장 싼 것부터 구매(어둠을 쓰는 전략은 어둠 장비도), 공연은 자동 공연.
 */
import { STAGES, TOUR_STAGE } from '../src/game/balance';
import {
  buyEquipment,
  releaseAlbum,
  releaseSingle,
  runAutoConcert,
  switchPersona,
  work,
} from '../src/game/commands';
import { createInitialState } from '../src/game/persistence';
import {
  equipmentCost,
  equipmentOf,
  previewSingle,
  previewAlbum,
  rhymesOf,
  stageStatus,
  switchStatus,
} from '../src/game/selectors';
import { advance } from '../src/game/simulation';
import type { EquipmentKind, GameState } from '../src/game/types';

export type Strategy = 'normal' | 'dark' | 'mixed';

export interface Scenario {
  label: string;
  strategy: Strategy;
  clicksPerSec: number;
}

export interface Milestones {
  firstSingle?: number;
  firstBuy?: number;
  firstAlbum?: number;
  fans100?: number;
  roomClear?: number;
  fans400?: number;
  clubClear?: number;
  fans1200?: number;
  tourDone?: number;
  switches: number;
  seizures: number;
  darkSeconds: number;
  buyGaps: number[];
  singleTimes: number[];
}

const T0 = 1_700_000_000_000;
const MAX_SEC = 6 * 3600;
const EQUIP: EquipmentKind[] = ['mic', 'studio', 'promotion'];

export function run(sc: Scenario): { m: Milestones; end: GameState } {
  let s = createInitialState(T0);
  const m: Milestones = { switches: 0, seizures: 0, darkSeconds: 0, buyGaps: [], singleTimes: [] };
  let clickAcc = 0;
  let lastBuyAt = 0;
  type TimeKey = Exclude<keyof Milestones, 'switches' | 'seizures' | 'darkSeconds' | 'buyGaps' | 'singleTimes'>;
  const mark = (key: TimeKey, t: number) => {
    if (m[key] === undefined) m[key] = t;
  };

  for (let t = 1; t <= MAX_SEC; t++) {
    const r = advance(s, 1000);
    s = r.state;
    m.seizures += r.events.filter((e) => e.type === 'micSeized').length;
    if (s.activePersona === 'dark') m.darkSeconds++;

    clickAcc += sc.clicksPerSec;
    while (clickAcc >= 1) {
      clickAcc -= 1;
      const w = work(s);
      if (w.ok) s = w.state;
    }

    // 자아 선택
    const trySwitch = (target: 'normal' | 'dark') => {
      const res = switchPersona(s, target);
      if (res.ok) {
        s = res.state;
        m.switches++;
      }
    };
    if (sc.strategy === 'dark' && s.activePersona === 'normal') trySwitch('dark');
    if (sc.strategy === 'mixed') {
      if (s.activePersona === 'normal' && s.heat <= 20) trySwitch('dark');
      else if (s.activePersona === 'dark' && s.heat >= 95) trySwitch('normal');
    }
    // 다른 자아 라임으로 발매 가능하면 넘어가 쓴다.
    if (sc.strategy !== 'normal') {
      const other = s.activePersona === 'normal' ? 'dark' : 'normal';
      const cur = previewSingle(s);
      if (!cur.affordable && rhymesOf(s, other) >= cur.needRhymes && switchStatus(s, other).allowed) trySwitch(other);
    }

    // 발매
    for (;;) {
      const rel = releaseSingle(s);
      if (!rel.ok) break;
      s = rel.state;
      mark('firstSingle', t);
      m.singleTimes.push(t);
    }

    // 구매: 앨범/장비 중 가장 싼 것부터
    for (;;) {
      type Option = { cost: number; buy: () => GameState | null };
      const options: Option[] = [];
      const album = previewAlbum(s);
      if (album) {
        options.push({
          cost: album.cost,
          buy: () => {
            const a = releaseAlbum(s);
            return a.ok ? a.state : null;
          },
        });
      }
      // 일반 장비는 항상, 어둠속성을 쓰는 전략이면 어둠 장비도 후보에 넣는다. (가장 싼 것부터 산다)
      for (const persona of sc.strategy === 'normal' ? (['normal'] as const) : (['normal', 'dark'] as const)) {
        const owned = equipmentOf(s, persona);
        for (const k of EQUIP) {
          if (owned[k] < 20) {
            options.push({
              cost: equipmentCost(k, owned[k], persona),
              buy: () => {
                const b = buyEquipment(s, k, persona);
                return b.ok ? b.state : null;
              },
            });
          }
        }
      }
      options.sort((a, b) => a.cost - b.cost);
      const pick = options.find((o) => o.cost <= s.coins);
      if (!pick) break;
      const before = s;
      const next = pick.buy();
      if (!next) break;
      s = next;
      if (next.albums.length > before.albums.length) mark('firstAlbum', t);
      else {
        mark('firstBuy', t);
      }
      m.buyGaps.push(t - lastBuyAt);
      lastBuyAt = t;
    }

    // 공연(자동)
    for (const def of STAGES) {
      if (stageStatus(s, def.id).canRun) {
        const c = runAutoConcert(s, def.id);
        if (c.ok) {
          s = c.state;
          if (def.id === 'room') mark('roomClear', t);
          if (def.id === 'club') mark('clubClear', t);
          if (def.id === TOUR_STAGE) mark('tourDone', t);
        }
      }
    }
    if (s.fans >= 100) mark('fans100', t);
    if (s.fans >= 400) mark('fans400', t);
    if (s.fans >= 1200) mark('fans1200', t);
    if (m.tourDone !== undefined) break;
  }
  return { m, end: s };
}

