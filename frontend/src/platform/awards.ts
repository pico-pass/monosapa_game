import type { AwardCategory } from '../game/balance';

/*
 * 시상식 「모노사파 어워즈」의 서버 응답 모양과, 레드카펫 발표를 어디까지 봤는지의 기억(기기·계정별 localStorage).
 * 일정·집계·투표·보상은 모두 서버가 정한다(backend/src/awards). 화면은 받은 값을 보여 줄 뿐이다.
 */

export type AwardPhase = 'collecting' | 'voting' | 'announced' | 'closed';
export type VoteCategory = 'fan-normal' | 'fan-dark';

export interface AwardRow {
  rank: number;
  title: string;
  artist: string;
  /** 올해의 노래·신인상은 점수 합계(24로 나눠 보인다), 롱런상·역주행상은 시간 수, 팬 투표상은 득표 수 */
  value: number;
  mine: boolean;
  /** 이 순위의 보상(다이아). 중간 순위에서는 0 */
  reward: number;
}

export interface AwardStanding {
  category: AwardCategory;
  top: AwardRow[];
  /** 내 곡이 상위 밖에 있을 때 그 줄 */
  mine: AwardRow | null;
}

export interface AwardCandidate {
  key: string;
  title: string;
  artist: string;
  points: number;
  mine: boolean;
}

export interface AwardBallot {
  category: VoteCategory;
  candidates: AwardCandidate[];
  votedKey: string | null;
}

export interface AwardResult {
  category: AwardCategory;
  rows: AwardRow[];
}

export interface AwardItem {
  id: string;
  kind: 'win' | 'vote';
  category: AwardCategory;
  rank: number | null;
  diamonds: number;
  trophy: string | null;
  claimed: boolean;
}

/** GET /api/awards 응답 */
export interface AwardsData {
  period: string;
  phase: AwardPhase;
  now: number;
  voteFrom: number;
  announceAt: number;
  claimUntil: number;
  rookieFrom: number;
  standings: AwardStanding[] | null;
  ballot: AwardBallot[] | null;
  canVote: boolean;
  voteBlocked: string | null;
  results: AwardResult[] | null;
  items: AwardItem[];
  canClaim: boolean;
  trophies: string[];
}

/** 부문마다 발표를 몇 자리까지 봤는지(밑자리부터 센다) */
export type Seen = Record<string, number>;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const seenKey = (uid: string, period: string) => `monosapa.awards.seen:${uid}:${period}`;

/** 저장된 발표 진행. 기억이 없거나 모양이 이상하거나 저장소가 막혀 있으면 빈 값(= 아직 아무것도 안 봤다). */
export function readSeen(store: Store | null, uid: string, period: string): Seen {
  try {
    const raw: unknown = JSON.parse(store?.getItem(seenKey(uid, period)) ?? 'null');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Seen = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function writeSeen(store: Store | null, uid: string, period: string, seen: Seen): void {
  try {
    store?.setItem(seenKey(uid, period), JSON.stringify(seen));
  } catch {
    /* 저장소가 막혀 있으면 다음에 처음부터 다시 보일 뿐이다 */
  }
}
