import type { Avatar } from '../../users/profile.js';

/** POST /api/chat 요청 */
export class PostChatDto {
  text!: string;
  /** 달고 있는 칭호(선택, 16자까지) */
  title?: string | null;
}

export class ChatMessageDto {
  id!: string;
  /** 글쓴이의 계정 ID(프로필 보기) */
  uid!: string;
  /** 글쓴이의 지금 이름: 닉네임이 있으면 닉네임, 없으면 구글 이름 */
  name!: string;
  picture!: string | null;
  avatar!: Avatar;
  /** 글쓴이가 마지막으로 접속한 지 몇 ms 지났는지(모르면 null) */
  seenAgoMs!: number | null;
  title!: string | null;
  text!: string;
  /** 보낸 시각(ms) */
  at!: number;
  /** 내가 보낸 메시지 */
  mine!: boolean;
  /** 내가 지울 수 있는 메시지(내 것이거나 내가 관리자) */
  canDelete!: boolean;
}

/** GET /api/chat 응답. 가장 오래된 것부터 최신 순서다. */
export class ChatListDto {
  messages!: ChatMessageDto[];
}
