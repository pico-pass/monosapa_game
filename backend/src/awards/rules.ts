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

/* ---------- 시상식: 일정·부문·순위·투표·보상 (화면·투표·보상 단계) ---------- */

/** 지금 열려 있는 시상식 해(연 1회). 월 단위는 구조만 열어 두고 쓰지 않는다. */
export const AWARD_YEAR = 2026;

const KST_MS = 9 * HOUR_MS;
/** 한국 시간 y년 m월(0부터) d일 0시의 시각(ms) */
const kstStart = (y: number, m: number, d: number): number => Date.UTC(y, m, d) - KST_MS;

export interface AwardSchedule {
  /** 집계에 넣는 날짜 범위(한국 시간 날짜, 양끝 포함) */
  fromDay: string;
  toDay: string;
  /** 투표 후보를 가리는 날짜의 끝(투표 시작 전날) — 후보는 이 날짜까지의 누적으로 정한다 */
  candidatesDay: string;
  voteFrom: number;
  /** 투표가 끝나고 결과를 발표하는 시각 */
  announceAt: number;
  /** 보상을 받을 수 있는 마지막 시각(이 시각부터는 못 받는다) */
  claimUntil: number;
  /** 신인상: 첫 싱글이 이 시각 이후에 나온 계정만 신인이다 */
  rookieFrom: number;
}

/** 해마다 같은 일정: 투표 12/24 0시~12/31 24시, 발표 1/1 0시, 보상은 1/31까지(모두 한국 시간) */
export function scheduleOf(year: number = AWARD_YEAR): AwardSchedule {
  const voteFrom = kstStart(year, 11, 24);
  return {
    fromDay: `${year}-01-01`,
    toDay: `${year}-12-31`,
    candidatesDay: dayOf(voteFrom - 1),
    voteFrom,
    announceAt: kstStart(year + 1, 0, 1),
    claimUntil: kstStart(year + 1, 1, 1),
    rookieFrom: kstStart(year, 11, 1),
  };
}

export type AwardPhase = 'collecting' | 'voting' | 'announced' | 'closed';

export function phaseOf(now: number, year: number = AWARD_YEAR): AwardPhase {
  const s = scheduleOf(year);
  return now < s.voteFrom ? 'collecting' : now < s.announceAt ? 'voting' : now < s.claimUntil ? 'announced' : 'closed';
}

/** 부문. 프런트 `AWARD_CATEGORIES`와 같아야 한다(프런트 테스트가 이 파일을 읽어 비교한다). */
export const SCORE_CATEGORIES = ['song-normal', 'song-dark', 'rookie', 'revival', 'longrun'] as const;
export const VOTE_CATEGORIES = ['fan-normal', 'fan-dark'] as const;
export const AWARD_CATEGORIES = [...SCORE_CATEGORIES, ...VOTE_CATEGORIES] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];
export type VoteCategory = (typeof VOTE_CATEGORIES)[number];
export type AwardCategory = (typeof AWARD_CATEGORIES)[number];

export const isAwardCategory = (v: unknown): v is AwardCategory => typeof v === 'string' && (AWARD_CATEGORIES as readonly string[]).includes(v);
export const isVoteCategory = (v: unknown): v is VoteCategory => typeof v === 'string' && (VOTE_CATEGORIES as readonly string[]).includes(v);

/** 부문마다 순위별 보상(다이아, 1위부터). 길이가 곧 시상대에 서는 수다. 서버가 DTO로 내려주므로 프런트는 이 값을 따로 갖지 않는다. */
export const WINNER_REWARDS: Readonly<Record<AwardCategory, readonly number[]>> = {
  'song-normal': [100, 50, 30],
  'song-dark': [100, 50, 30],
  rookie: [50],
  revival: [30],
  longrun: [30],
  'fan-normal': [50, 30, 20],
  'fan-dark': [50, 30, 20],
};
/** 투표에 참여한 부문마다 주는 다이아 */
export const VOTE_REWARD = 2;
/** 투표 자격: 가입한 지 이 일수 이상 + 팬 이 수 이상(다중 계정 방지) */
export const VOTE_MIN_ACCOUNT_DAYS = 7;
export const VOTE_MIN_FANS = 1000;
/** 팬 투표상 후보 수(부문마다) */
export const CANDIDATES_PER_CATEGORY = 10;
/** 중간 순위로 보여 주는 상위 수 */
export const STANDINGS_TOP = 3;

export const rewardFor = (category: AwardCategory, rank: number): number => WINNER_REWARDS[category][rank - 1] ?? 0;

/** 트로피(= 칭호) ID. 1위에게만 준다. 프런트 `trophyId`와 같은 모양이다. */
export const trophyId = (year: number, category: AwardCategory): string => `trophy-${year}-${category}`;

/** 한 곡의 기간 누적(`award_points`를 (속성, 곡)으로 합친 것) */
export interface SongTotal {
  persona: AwardPersona;
  key: string;
  uid: string;
  title: string;
  artist: string;
  points: number;
  hours: number;
  revivals: number;
}

export interface RankedSong {
  rank: number;
  song: SongTotal;
  /** 부문의 기준 값: 올해의 노래·신인상은 points, 롱런상은 hours, 역주행상은 revivals */
  value: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byPoints = (a: SongTotal, b: SongTotal): number => b.points - a.points || b.hours - a.hours || cmp(a.key, b.key);
const byHours = (a: SongTotal, b: SongTotal): number => b.hours - a.hours || b.points - a.points || cmp(a.key, b.key);
const byRevivals = (a: SongTotal, b: SongTotal): number => b.revivals - a.revivals || b.points - a.points || cmp(a.key, b.key);

const valueOf = (category: ScoreCategory, s: SongTotal): number => (category === 'longrun' ? s.hours : category === 'revival' ? s.revivals : s.points);

/** 한 계정은 한 부문에 곡 하나만: 정렬된 목록에서 계정마다 가장 앞선 곡만 남기고 순위를 매긴다. */
function bestPerAccount(sorted: readonly SongTotal[], category: ScoreCategory): RankedSong[] {
  const seen = new Set<string>();
  const out: RankedSong[] = [];
  for (const song of sorted) {
    if (seen.has(song.uid)) continue;
    seen.add(song.uid);
    out.push({ rank: out.length + 1, song, value: valueOf(category, song) });
  }
  return out;
}

/** 첫 싱글 발매 시각(ms). 저장의 `state.singles[].releasedAt` 중 가장 이른 값이고, 싱글이 없거나 값이 이상하면 null. */
export function firstSingleAt(state: unknown): number | null {
  const list = typeof state === 'object' && state !== null ? (state as { singles?: unknown }).singles : undefined;
  if (!Array.isArray(list)) return null;
  let first: number | null = null;
  for (const s of list.slice(0, 2000)) {
    const at = typeof s === 'object' && s !== null ? (s as { releasedAt?: unknown }).releasedAt : undefined;
    if (typeof at === 'number' && Number.isFinite(at) && at > 0 && (first === null || at < first)) first = at;
  }
  return first;
}

/** 신인인가: 첫 싱글이 `rookieFrom` 이후에 나왔다 */
export const isRookie = (firstAt: number | null, rookieFrom: number): boolean => firstAt !== null && firstAt >= rookieFrom;

/**
 * 점수 부문 다섯 개의 전체 순위. 한 곡이 상을 독식하지 못하게 올해의 노래 1위 곡은 롱런상·역주행상 순위에서 뺀다.
 * 신인상은 신인 계정(`rookieUids`)의 곡만 본다. 부문마다 계정당 곡 하나다.
 */
export function rankScores(totals: readonly SongTotal[], rookieUids: ReadonlySet<string>): Record<ScoreCategory, RankedSong[]> {
  const songNormal = bestPerAccount(totals.filter((t) => t.persona === 'normal').sort(byPoints), 'song-normal');
  const songDark = bestPerAccount(totals.filter((t) => t.persona === 'dark').sort(byPoints), 'song-dark');
  const winners = new Set([songNormal[0]?.song.key, songDark[0]?.song.key].filter((k): k is string => !!k));
  const rest = totals.filter((t) => !winners.has(t.key));
  return {
    'song-normal': songNormal,
    'song-dark': songDark,
    rookie: bestPerAccount(totals.filter((t) => rookieUids.has(t.uid)).sort(byPoints), 'rookie'),
    revival: bestPerAccount(rest.filter((t) => t.revivals > 0).sort(byRevivals), 'revival'),
    longrun: bestPerAccount(rest.filter((t) => t.hours > 0).sort(byHours), 'longrun'),
  };
}

/** 팬 투표상 후보 한 줄(투표 시작 때 한 번 정해 두고 바꾸지 않는다) */
export interface CandidateRow {
  category: VoteCategory;
  key: string;
  uid: string;
  title: string;
  artist: string;
  points: number;
}

const SONG_OF: Readonly<Record<VoteCategory, ScoreCategory>> = { 'fan-normal': 'song-normal', 'fan-dark': 'song-dark' };

/** 후보: 속성마다 누적 점수 상위 10곡(계정당 곡 하나) */
export function candidatesOf(totals: readonly SongTotal[]): CandidateRow[] {
  const ranks = rankScores(totals, new Set());
  return VOTE_CATEGORIES.flatMap((category) =>
    ranks[SONG_OF[category]].slice(0, CANDIDATES_PER_CATEGORY).map((r) => ({ category, key: r.song.key, uid: r.song.uid, title: r.song.title, artist: r.song.artist, points: r.song.points })),
  );
}

/** 득표를 모으는 키 */
export const tallyKey = (category: VoteCategory, key: string): string => `${category}|${key}`;

export interface ResultRow {
  category: AwardCategory;
  rank: number;
  key: string;
  uid: string;
  title: string;
  artist: string;
  /** 올해의 노래·신인상은 점수(points), 롱런상은 시간(hours), 역주행상은 시간(revivals), 팬 투표상은 득표 수 */
  value: number;
}

/**
 * 발표용 결과. 점수 부문은 보상이 있는 순위까지(시상대), 팬 투표상은 득표가 있는 후보를 득표 순으로(같으면 점수·키 순) 시상대까지 정한다.
 * 같은 입력이면 항상 같은 결과다.
 */
export function resultsOf(totals: readonly SongTotal[], rookieUids: ReadonlySet<string>, candidates: readonly CandidateRow[], tallies: ReadonlyMap<string, number>): ResultRow[] {
  const ranks = rankScores(totals, rookieUids);
  const out: ResultRow[] = [];
  for (const category of AWARD_CATEGORIES) {
    const places = WINNER_REWARDS[category].length;
    if (isVoteCategory(category)) {
      const rows = candidates
        .filter((c) => c.category === category)
        .map((c) => ({ c, votes: tallies.get(tallyKey(category, c.key)) ?? 0 }))
        .filter((x) => x.votes > 0)
        .sort((a, b) => b.votes - a.votes || b.c.points - a.c.points || cmp(a.c.key, b.c.key))
        .slice(0, places);
      rows.forEach((x, i) => out.push({ category, rank: i + 1, key: x.c.key, uid: x.c.uid, title: x.c.title, artist: x.c.artist, value: x.votes }));
    } else {
      for (const r of ranks[category].slice(0, places)) out.push({ category, rank: r.rank, key: r.song.key, uid: r.song.uid, title: r.song.title, artist: r.song.artist, value: r.value });
    }
  }
  return out;
}

/** 받을 수 있는 보상 한 줄. `id`가 받았는지 가리는 키다(`award_claims`의 (해, id, 사람)이 유일). */
export interface ClaimItem {
  id: string;
  kind: 'win' | 'vote';
  category: AwardCategory;
  rank: number | null;
  diamonds: number;
  trophy: string | null;
}

export const claimId = (kind: ClaimItem['kind'], category: AwardCategory): string => `${kind}:${category}`;

/** 내가 받을 보상 전체: 수상(시상대에 오른 부문마다, 1위는 트로피도)과 투표 참여(투표한 부문마다 다이아 `VOTE_REWARD`). */
export function claimItemsOf(year: number, uid: string, results: readonly ResultRow[], votedCategories: readonly string[]): ClaimItem[] {
  const items: ClaimItem[] = [];
  for (const r of results) {
    const diamonds = rewardFor(r.category, r.rank);
    if (r.uid !== uid || diamonds <= 0) continue;
    items.push({ id: claimId('win', r.category), kind: 'win', category: r.category, rank: r.rank, diamonds, trophy: r.rank === 1 ? trophyId(year, r.category) : null });
  }
  for (const category of VOTE_CATEGORIES) {
    if (votedCategories.includes(category)) items.push({ id: claimId('vote', category), kind: 'vote', category, rank: null, diamonds: VOTE_REWARD, trophy: null });
  }
  return items;
}

export type VoteGate = 'young' | 'fans' | null;

/** 투표 자격 확인. 통과하면 null, 아니면 막힌 이유 */
export function voteGate(createdAt: number | null, fans: number, now: number): VoteGate {
  if (createdAt === null || now - createdAt < VOTE_MIN_ACCOUNT_DAYS * 24 * HOUR_MS) return 'young';
  if (!(fans >= VOTE_MIN_FANS)) return 'fans';
  return null;
}
