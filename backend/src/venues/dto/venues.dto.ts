import type { Avatar } from '../../users/profile.js';
import type { DeviceId, VenueTheme } from '../rules.js';

/** 무대 하나(남에게 보여 주는 모습). 이메일은 담지 않는다. */
export class VenueBriefDto {
  id!: string;
  owner!: { uid: string; name: string; picture: string | null; avatar: Avatar };
  name!: string;
  theme!: VenueTheme;
  /** 48칸. 빈 칸은 null */
  cells!: (DeviceId | null)[];
  score!: number;
  /** 0(E) ~ 5(S) */
  grade!: number;
  likes!: number;
  plays!: number;
  liked!: boolean;
  mine!: boolean;
  /** 오늘 내가 이 무대에서 이미 공연했다 */
  visitedToday!: boolean;
}

/** GET /api/venues 응답 */
export class VenueListDto {
  venues!: VenueBriefDto[];
  page!: number;
  hasMore!: boolean;
  /** 오늘 더 공연할 수 있는 남의 무대 수 */
  visitsLeft!: number;
}

/** 내 무대 한 건(주인에게만 보이는 통계 포함) */
export class MyVenueBodyDto {
  id!: string;
  name!: string;
  theme!: VenueTheme;
  cells!: (DeviceId | null)[];
  score!: number;
  grade!: number;
  likes!: number;
  plays!: number;
  /** 신고 처리로 숨겨져 있다(다시 올리면 풀린다) */
  hidden!: boolean;
  editedAt!: number;
}

/** 지난주 인기 무대 보상 안내 */
export class VenueWeeklyDto {
  /** 지난주 번호 */
  week!: number;
  /** 지난주 내 무대의 순위(3위 밖이거나 무대가 없으면 null) */
  rank!: number | null;
  /** 받을 수 있는 다이아(순위권이고 아직 안 받았을 때만, 아니면 null) */
  diamonds!: number | null;
  claimed!: boolean;
}

/** GET /api/venues/me · PUT /api/venues/me 응답 */
export class MyVenueDto {
  venue!: MyVenueBodyDto | null;
  weekly!: VenueWeeklyDto;
  visitsLeft!: number;
}

/** POST /api/venues/:id/play 응답: 클라이언트가 이 등급으로 코인을 계산해 반영한다. */
export class VenuePlayDto {
  grade!: number;
  /** 주인에게 대관료가 갔는지(주인의 하루 상한을 넘으면 가지 않는다) */
  rentPaid!: boolean;
  visitsLeft!: number;
}

/** POST /api/venues/:id/like 응답 */
export class VenueLikeDto {
  likes!: number;
  liked!: boolean;
}

/** POST /api/venues/claim-weekly 응답 */
export class VenueClaimDto {
  week!: number;
  rank!: number;
  diamonds!: number;
}

/** PUT /api/venues/me 요청 */
export class SaveVenueDto {
  name?: unknown;
  theme?: unknown;
  cells?: unknown;
}
