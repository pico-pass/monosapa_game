/*
 * 팬덤 모으기 화면용 변환(순수): 서버 스냅샷(좌표 10배 정수, 초당 10번)을 칸 단위 좌표로 바꾸고,
 * 그리는 시각의 앞뒤 스냅샷 사이를 이어서(보간) 부드럽게 만든다.
 */
import type { FandomSnapshot } from '../../../../realtime/src/protocol';

export interface ViewSnake {
  id: number;
  fans: number;
  shield: boolean;
  /** 머리가 먼저인 마디 좌표 */
  pts: [number, number][];
}

export interface FandomViewData {
  me: { x: number; y: number; fans: number; boost: boolean; shield: boolean };
  snakes: ViewSnake[];
  dots: [number, number, number][];
}

export interface TimedSnap {
  /** 받은 시각(performance.now() ms) */
  at: number;
  view: FandomViewData;
}

export function toView(s: FandomSnapshot): FandomViewData {
  return {
    me: { x: s.me.x / 10, y: s.me.y / 10, fans: s.me.fans, boost: s.me.boost === 1, shield: s.me.shield === 1 },
    snakes: s.sn.map((row) => {
      const pts: [number, number][] = [];
      for (let i = 3; i + 1 < row.length; i += 2) pts.push([row[i] / 10, row[i + 1] / 10]);
      return { id: row[0], fans: row[1], shield: row[2] === 1, pts };
    }),
    dots: Array.from({ length: Math.floor(s.dots.length / 3) }, (_, i): [number, number, number] => [s.dots[i * 3] / 10, s.dots[i * 3 + 1] / 10, s.dots[i * 3 + 2]]),
  };
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** a에서 b로 k(0~1)만큼 간 모습. 두 쪽에 다 있는 뱀의 마디를 이어 주고, 새로 보이는 뱀·점은 b 그대로 쓴다. */
export function lerpView(a: FandomViewData, b: FandomViewData, k: number): FandomViewData {
  const before = new Map(a.snakes.map((s) => [s.id, s]));
  return {
    me: { ...b.me, x: lerp(a.me.x, b.me.x, k), y: lerp(a.me.y, b.me.y, k) },
    snakes: b.snakes.map((s) => {
      const p = before.get(s.id);
      if (!p) return s;
      return { ...s, pts: s.pts.map((q, i): [number, number] => (i < p.pts.length ? [lerp(p.pts[i][0], q[0], k), lerp(p.pts[i][1], q[1], k)] : q)) };
    }),
    dots: b.dots,
  };
}

/** 시각 rt(받은 시각과 같은 시계)에 보일 모습. 스냅샷이 없으면 null, 하나뿐이거나 범위 밖이면 가까운 쪽을 그대로 쓴다. */
export function viewAt(snaps: readonly TimedSnap[], rt: number): FandomViewData | null {
  if (snaps.length === 0) return null;
  if (rt <= snaps[0].at) return snaps[0].view;
  for (let i = 1; i < snaps.length; i++) {
    if (rt <= snaps[i].at) {
      const a = snaps[i - 1];
      const b = snaps[i];
      return lerpView(a.view, b.view, (rt - a.at) / Math.max(1, b.at - a.at));
    }
  }
  return snaps[snaps.length - 1].view;
}
