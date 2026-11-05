/** GET /api/social/summary 응답: 알림 점에 쓰는 개수 */
export class SocialSummaryDto {
  /** 아직 열어 보지 않은 우편 수 */
  mailUnread!: number;
  /** 받지 않은 다이아가 붙은 우편 수 */
  mailClaimable!: number;
  /** 나에게 온 친구 요청 수 */
  friendRequests!: number;
  /** 안 읽은 개인채팅 메시지 수 */
  dmUnread!: number;
}
