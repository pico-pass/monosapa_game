import { dayOf } from '../common/week.js';

/*
 * 시상식(모노사파 어워즈) 집계의 순수 규칙. 차트가 시간 시드와 "지금의" 팬 수로 계산돼서 지난 순위를 나중에 되살릴 수 없으므로,
 * 매 정시마다 차트 상위 곡을 남겨 둔다(`AwardsService`). 이 파일은 시계·DB 없이 값만 다룬다.
 */

export const AWARD_PERSONAS = ['normal', 'dark'] as const;
export type AwardPersona = (typeof AWARD_PERSONAS)[number];

/** 한 정시에 속성마다 남기는 상위 곡 수 */
export const SNAPSHOT_TOP = 30;
export const HOUR_MS = 3600_000;
/** 집계 보관 기간(초). 연 단위 시상식까지 쓸 수 있게 400일이고, 지나면 MongoDB TTL 인덱스가 지운다. */
export const AWARD_RETENTION_SECONDS = 400 * 24 * 3600;
/** 저장하는 글자 수 상한(차트가 곡 제목을 200자까지 받는다) */
const TEXT_MAX = 200;

/** 한 정시 한 곡의 순위 점수: 1위 30점 … 30위 1점, 그 밖은 0점. */
export const rankPoints = (rank: number): number => (Number.isInteger(rank) && rank >= 1 && rank <= SNAPSHOT_TOP ? SNAPSHOT_TOP + 1 - rank : 0);

/** 시각이 속한 정시 번호(1970-01-01 0시부터 센 시간 수) */
export const hourOf = (ms: number): number => Math.floor(ms / HOUR_MS);

/** 차트가 내려주는 상위 곡 한 줄(`ChartService.topRanked`와 같은 모양) */
export interface SnapshotEntry {
  rank: number;
  /** 곡 키(`u:<계정>:<싱글 ID>`) */
  key: string;
  uid: string;
  title: string;
  artist: string;
  /** 그 시각에 역주행 중이었다 */
  revival: boolean;
}

/** (날짜, 속성, 곡) 하나에 더할 값. 한 정시는 `hours`를 1, `points`를 순위 점수만큼 올린다. */
export interface PointRow {
  filter: { day: string; persona: AwardPersona; key: string };
  inc: { points: number; hours: number; revivals: number };
  set: { uid: string; title: string; artist: string };
}

/**
 * 한 정시의 한 속성 상위 곡을 더하기 행으로 바꾼다. 날짜는 정시가 속한 한국 시간 날짜다.
 * 30위 밖이거나 순위가 이상한 줄은 버리고, 같은 곡이 두 줄이면 먼저 나온(더 높은) 순위만 쓴다.
 */
export function pointRows(hour: number, persona: AwardPersona, entries: readonly SnapshotEntry[]): PointRow[] {
  const day = dayOf(hour * HOUR_MS);
  const seen = new Set<string>();
  const rows: PointRow[] = [];
  for (const e of entries) {
    const points = rankPoints(e.rank);
    if (points === 0 || typeof e.key !== 'string' || e.key.length === 0 || seen.has(e.key)) continue;
    seen.add(e.key);
    rows.push({
      filter: { day, persona, key: e.key },
      inc: { points, hours: 1, revivals: e.revival ? 1 : 0 },
      set: { uid: e.uid, title: e.title.slice(0, TEXT_MAX), artist: e.artist.slice(0, TEXT_MAX) },
    });
  }
  return rows;
}
