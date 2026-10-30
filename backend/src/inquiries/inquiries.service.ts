import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { cleanLine, cleanMultiline, textLength as length } from '../common/text.js';
import type { CreateInquiryDto, InquiryDto, InquiryListDto, ReplyInquiryDto } from './dto/inquiry.dto.js';
import { INQUIRY_CATEGORIES, Inquiry, type InquiryDocument, type InquiryStatus } from './inquiry.schema.js';

export const INQUIRY_TITLE_MAX = 50;
export const INQUIRY_BODY_MAX = 1000;
export const INQUIRY_REPLY_MAX = 1000;
/** 한 사람이 한 시간에 접수할 수 있는 문의 수와, 답변을 기다리는 문의 수 상한 */
const MAX_PER_HOUR = 3;
const MAX_OPEN = 10;
const LIST_LIMIT = 100;

const toDto = (d: InquiryDocument, withSender: boolean): InquiryDto => ({
  id: String(d._id),
  category: d.category,
  title: d.title,
  body: d.body,
  status: d.status,
  reply: d.reply,
  createdAt: d.createdAt.getTime(),
  repliedAt: d.repliedAt ? d.repliedAt.getTime() : null,
  ...(withSender ? { from: { name: d.userName, email: d.userEmail } } : {}),
});

@Injectable()
export class InquiriesService {
  constructor(@InjectModel(Inquiry.name) private readonly inquiries: Model<Inquiry>) {}

  async create(user: UserDto, body: CreateInquiryDto | undefined): Promise<InquiryDto> {
    const category = body?.category;
    if (!category || !INQUIRY_CATEGORIES.includes(category)) throw new BadRequestException('문의 종류를 골라 주세요.');
    const title = cleanLine(body?.title);
    const text = cleanMultiline(body?.body);
    if (length(title) === 0 || length(title) > INQUIRY_TITLE_MAX) throw new BadRequestException(`제목은 1~${INQUIRY_TITLE_MAX}자로 적어 주세요.`);
    if (length(text) === 0 || length(text) > INQUIRY_BODY_MAX) throw new BadRequestException(`내용은 1~${INQUIRY_BODY_MAX}자로 적어 주세요.`);

    const uid = new Types.ObjectId(user.id);
    const [recent, open] = await Promise.all([
      this.inquiries.countDocuments({ userId: uid, createdAt: { $gt: new Date(Date.now() - 3600_000) } }).exec(),
      this.inquiries.countDocuments({ userId: uid, status: 'open' }).exec(),
    ]);
    if (recent >= MAX_PER_HOUR) throw new HttpException('문의를 너무 자주 보내고 있어요. 잠시 뒤에 다시 보내 주세요.', HttpStatus.TOO_MANY_REQUESTS);
    if (open >= MAX_OPEN) throw new HttpException('답변을 기다리는 문의가 너무 많아요. 답변이 오면 다시 보내 주세요.', HttpStatus.TOO_MANY_REQUESTS);

    const doc = await this.inquiries.create({ userId: uid, userName: user.name, userEmail: user.email, category, title, body: text });
    return toDto(doc, false);
  }

  async mine(user: UserDto): Promise<InquiryListDto> {
    const docs = await this.inquiries.find({ userId: new Types.ObjectId(user.id) }).sort({ _id: -1 }).limit(LIST_LIMIT).exec();
    return { inquiries: docs.map((d) => toDto(d, false)) };
  }

  /** 관리자: 상태별 문의 목록. 오래 기다린 문의가 먼저 보이도록 접수 순서(오래된 것부터)로 돌려준다. */
  async listAll(status: InquiryStatus | 'all'): Promise<InquiryListDto> {
    const filter = status === 'all' ? {} : { status };
    const docs = await this.inquiries.find(filter).sort({ _id: status === 'answered' ? -1 : 1 }).limit(LIST_LIMIT).exec();
    return { inquiries: docs.map((d) => toDto(d, true)) };
  }

  /** 관리자: 답변을 달고 상태를 answered 로 바꾼다. 이미 답변한 문의에 다시 달면 답변이 바뀐다. */
  async reply(id: string, body: ReplyInquiryDto | undefined): Promise<InquiryDto> {
    if (!isValidObjectId(id)) throw new NotFoundException('문의를 찾을 수 없어요.');
    const text = cleanMultiline(body?.text);
    if (length(text) === 0 || length(text) > INQUIRY_REPLY_MAX) throw new BadRequestException(`답변은 1~${INQUIRY_REPLY_MAX}자로 적어 주세요.`);
    const doc = await this.inquiries
      .findByIdAndUpdate(id, { $set: { reply: text, status: 'answered', repliedAt: new Date() } }, { returnDocument: 'after' })
      .exec();
    if (!doc) throw new NotFoundException('문의를 찾을 수 없어요.');
    return toDto(doc, true);
  }
}
