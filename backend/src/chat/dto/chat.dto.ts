/** POST /api/chat 요청 */
export class PostChatDto {
  text!: string;
  /** 달고 있는 칭호(선택, 16자까지) */
  title?: string | null;
}

export class ChatMessageDto {
  id!: string;
  name!: string;
  picture!: string | null;
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
