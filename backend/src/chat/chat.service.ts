import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { cleanLine, textLength } from '../common/text.js';
import type { ChatListDto, ChatMessageDto, PostChatDto } from './dto/chat.dto.js';
import { ChatMessage, type ChatMessageDocument } from './chat.schema.js';

export const CHAT_MAX_LENGTH = 200;
export const CHAT_TITLE_MAX_LENGTH = 16;
/** 한 번에 내려주는 최근 메시지 수 */
export const CHAT_PAGE_SIZE = 60;
/** 연속 전송 간격과 1분당 최대 개수 (도배 방지) */
const MIN_GAP_MS = 1500;
const MAX_PER_MINUTE = 20;
/** 같은 말을 반복해 보내지 못하는 시간 */
const REPEAT_BLOCK_MS = 10_000;

const toDto = (m: ChatMessageDocument, viewer: UserDto): ChatMessageDto => {
  const mine = String(m.userId) === viewer.id;
  return {
    id: String(m._id),
    name: m.name,
    picture: m.picture,
    title: m.title,
    text: m.text,
    at: m.createdAt.getTime(),
    mine,
    canDelete: mine || viewer.isAdmin,
  };
};

@Injectable()
export class ChatService {
  /** 사용자별 최근 전송 시각(서버 메모리). 서버를 다시 켜면 비워지지만 도배 방지에는 충분하다. */
  private readonly recent = new Map<string, { at: number; text: string }[]>();

  constructor(@InjectModel(ChatMessage.name) private readonly messages: Model<ChatMessage>) {}

  async list(viewer: UserDto): Promise<ChatListDto> {
    const docs = await this.messages.find().sort({ _id: -1 }).limit(CHAT_PAGE_SIZE).exec();
    return { messages: docs.reverse().map((d) => toDto(d, viewer)) };
  }

  async post(user: UserDto, body: PostChatDto | undefined): Promise<ChatMessageDto> {
    const text = cleanLine(body?.text);
    if (textLength(text) === 0) throw new BadRequestException('내용을 입력해 주세요.');
    if (textLength(text) > CHAT_MAX_LENGTH) throw new BadRequestException(`${CHAT_MAX_LENGTH}자까지 보낼 수 있어요.`);
    const title = cleanLine(body?.title);
    this.checkRate(user.id, text);

    const doc = await this.messages.create({
      userId: new Types.ObjectId(user.id),
      name: user.name?.trim() || '익명',
      picture: user.picture,
      title: title && textLength(title) <= CHAT_TITLE_MAX_LENGTH ? title : null,
      text,
    });
    return toDto(doc, user);
  }

  /** 내 메시지이거나 관리자일 때만 지울 수 있다. */
  async remove(user: UserDto, id: string): Promise<void> {
    if (!isValidObjectId(id)) throw new NotFoundException('메시지를 찾을 수 없어요.');
    const doc = await this.messages.findById(id).exec();
    if (!doc) throw new NotFoundException('메시지를 찾을 수 없어요.');
    if (String(doc.userId) !== user.id && !user.isAdmin) throw new ForbiddenException('내 메시지만 지울 수 있어요.');
    await this.messages.deleteOne({ _id: doc._id }).exec();
  }

  private checkRate(userId: string, text: string): void {
    const now = Date.now();
    const list = (this.recent.get(userId) ?? []).filter((x) => now - x.at < 60_000);
    const last = list[list.length - 1];
    const tooMany = () => new HttpException('너무 빨리 보내고 있어요. 잠시 뒤에 다시 보내 주세요.', HttpStatus.TOO_MANY_REQUESTS);
    if (last && now - last.at < MIN_GAP_MS) throw tooMany();
    if (list.length >= MAX_PER_MINUTE) throw tooMany();
    if (list.some((x) => x.text === text && now - x.at < REPEAT_BLOCK_MS)) {
      throw new HttpException('같은 말을 반복해서 보낼 수 없어요.', HttpStatus.TOO_MANY_REQUESTS);
    }
    list.push({ at: now, text });
    this.recent.set(userId, list);
  }
}
