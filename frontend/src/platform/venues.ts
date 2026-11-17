import type { Persona, VenueDeviceId } from '../game/types';

/*
 * 무대 디자인 빌더 「내 무대」의 서버 응답 모양. 올라온 무대의 점수·등급·좋아요·방문 수는 서버가 정한다(backend/src/venues).
 * 화면은 받은 값을 보여 줄 뿐이고, 남의 무대 공연 코인만 응답의 등급으로 클라이언트가 계산한다(game/venue.ts의 visitCoins).
 */

export type VenueSort = 'popular' | 'new' | 'friends';

export interface VenueBrief {
  id: string;
  owner: { uid: string; name: string; picture: string | null; avatar: string };
  name: string;
  theme: Persona;
  /** 48칸. 빈 칸은 null */
  cells: (VenueDeviceId | null)[];
  score: number;
  grade: number;
  likes: number;
  plays: number;
  liked: boolean;
  mine: boolean;
  /** 오늘 내가 이 무대에서 이미 공연했다 */
  visitedToday: boolean;
}

/** GET /api/venues 응답 */
export interface VenueListData {
  venues: VenueBrief[];
  page: number;
  hasMore: boolean;
  /** 오늘 더 공연할 수 있는 남의 무대 수 */
  visitsLeft: number;
}

export interface MyVenueBody {
  id: string;
  name: string;
  theme: Persona;
  cells: (VenueDeviceId | null)[];
  score: number;
  grade: number;
  likes: number;
  plays: number;
  /** 신고 처리로 숨겨져 있다(다시 올리면 풀린다) */
  hidden: boolean;
  editedAt: number;
}

export interface VenueWeekly {
  /** 지난주 번호 */
  week: number;
  /** 지난주 내 무대의 순위(3위 밖이거나 무대가 없으면 null) */
  rank: number | null;
  /** 받을 수 있는 다이아(순위권이고 아직 안 받았을 때만) */
  diamonds: number | null;
  claimed: boolean;
}

/** GET·PUT /api/venues/me 응답 */
export interface MyVenueData {
  venue: MyVenueBody | null;
  weekly: VenueWeekly;
  visitsLeft: number;
}

/** 남의 무대 공연 한 번의 결과(화면 연출용) */
export interface VenueVisitData {
  coins: number;
  grade: number;
  rentPaid: boolean;
  visitsLeft: number;
}
