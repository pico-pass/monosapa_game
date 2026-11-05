import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { ChatMessage } from '../chat/chat.schema.js';
import { cleanLine, cleanMultiline, textLength } from '../common/text.js';
import { DirectMessage } from '../dm/direct-message.schema.js';
import { MailboxService } from '../mailbox/mailbox.service.js';
import { displayNameOf, mutedUntilMs } from '../users/profile.js';
import { User } from '../users/user.schema.js';
import type { CreateReportDto, MutedListDto, ReportDto, ReportListDto, ResolveReportDto } from './dto/reports.dto.js';
import { muteMail, reporterMail, warnMail } from './messages.js';
import { REASON_TEXT, REPORT_ACTIONS, REPORT_KINDS, REPORT_REASONS, Report, type ReportAction, type ReportDocument, type ReportKind } from './report.schema.js';

export const REPORT_DETAIL_MAX = 200;
export const REPORT_NOTE_MAX = 300;
/** 한 사람이 하루(24시간)에 낼 수 있는 신고 수 */
export const REPORTS_PER_DAY = 10;
export const MUTE_MAX_HOURS = 8760;
/** 개인채팅 신고에 함께 남기는 앞선 대화 줄 수 */
const DM_CONTEXT_LINES = 4;
const LIST_LIMIT = 100;
const HOUR_MS = 3600_000;

const isDuplicate = (e: unknown): boolean => (e as { code?: number }).code === 11000;

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(ChatMessage.name) private readonly chat: Model<ChatMessage>,
    @InjectModel(DirectMessage.name) private readonly dms: Model<DirectMessage>,
    private readonly mailbox: MailboxService,
  ) {}

  async create(user: UserDto, body: CreateReportDto | undefined, now = Date.now()): Promise<void> {
    const kind = body?.kind;
    const reason = body?.reason;
    if (!kind || !REPORT_KINDS.includes(kind)) throw new BadRequestException('신고할 대상 종류가 올바르지 않아요.');
    if (!reason || !REPORT_REASONS.includes(reason)) throw new BadRequestException('신고 사유를 골라 주세요.');
    const detail = cleanLine(body?.detail);
    if (textLength(detail) > REPORT_DETAIL_MAX) throw new BadRequestException(`자세한 설명은 ${REPORT_DETAIL_MAX}자까지 적을 수 있어요.`);

    const me = new Types.ObjectId(user.id);
    const today = await this.reports.countDocuments({ reporter: me, createdAt: { $gt: new Date(now - 24 * HOUR_MS) } }).exec();
    if (today >= REPORTS_PER_DAY) throw new HttpException('오늘은 신고를 너무 많이 했어요. 내일 다시 해 주세요.', HttpStatus.TOO_MANY_REQUESTS);

    const found = await this.resolveTarget(user, kind, body);
    if (String(found.target) === user.id) throw new BadRequestException('내 글이나 내 프로필은 신고할 수 없어요.');
    try {
      await this.reports.create({ reporter: me, target: found.target, kind, refId: found.refId, reason, detail, snapshot: found.snapshot, context: found.context });
    } catch (e) {
      if (isDuplicate(e)) throw new ConflictException('이미 신고했어요. 운영자가 확인하고 있어요.');
      throw e;
    }
  }

  /** 신고 대상의 주인과 신고 당시 내용을 찾는다. */
  private async resolveTarget(user: UserDto, kind: ReportKind, body: CreateReportDto | undefined): Promise<{ target: Types.ObjectId; refId: string; snapshot: string; context: string[] }> {
    if (kind === 'profile') {
      const uid = body?.uid;
      const doc = typeof uid === 'string' && isValidObjectId(uid) ? await this.users.findById(uid).exec() : null;
      if (!doc) throw new NotFoundException('신고할 사용자를 찾을 수 없어요.');
      return { target: doc._id, refId: String(doc._id), snapshot: `닉네임: ${displayNameOf(doc)}\n한 줄 소개: ${doc.bio ?? '(없음)'}`, context: [] };
    }
    const refId = body?.refId;
    if (typeof refId !== 'string' || !isValidObjectId(refId)) throw new NotFoundException('신고할 메시지를 찾을 수 없어요.');
    if (kind === 'chat') {
      const msg = await this.chat.findById(refId).exec();
      if (!msg) throw new NotFoundException('신고할 메시지를 찾을 수 없어요.');
      return { target: msg.userId, refId, snapshot: msg.text, context: [] };
    }
    // 개인채팅: 나에게 온 메시지만 신고할 수 있다. 앞선 대화 몇 줄을 함께 남긴다.
    const msg = await this.dms.findById(refId).exec();
    if (!msg || String(msg.to) !== user.id) throw new NotFoundException('신고할 메시지를 찾을 수 없어요.');
    const before = await this.dms.find({ pair: msg.pair, _id: { $lt: msg._id } }).sort({ _id: -1 }).limit(DM_CONTEXT_LINES).exec();
    const names = await this.nameMap([msg.from, msg.to]);
    const context = before.reverse().map((m) => `${names.get(String(m.from)) ?? '?'}: ${m.text}`);
    return { target: msg.from, refId, snapshot: msg.text, context };
  }

  /* ---------- 관리자 ---------- */

  async adminList(status: 'open' | 'done' | 'all'): Promise<ReportListDto> {
    const filter = status === 'all' ? {} : { status };
    const docs = await this.reports.find(filter).sort({ _id: status === 'open' ? 1 : -1 }).limit(LIST_LIMIT).exec();
    return { reports: await this.present(docs) };
  }

  /** 관리자 화면용으로 이름·제재 상태·누적 신고 수를 붙인다. */
  private async present(docs: ReportDocument[]): Promise<ReportDto[]> {
    const targets = [...new Set(docs.map((d) => String(d.target)))].map((t) => new Types.ObjectId(t));
    const [names, mutes, totals] = await Promise.all([
      this.nameMap(docs.flatMap((d) => [d.reporter, d.target, ...(d.handledBy ? [d.handledBy] : [])])),
      this.users.find({ _id: { $in: targets } }, 'mutedUntil').exec(),
      this.reports.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { target: { $in: targets } } }, { $group: { _id: '$target', n: { $sum: 1 } } }]).exec(),
    ]);
    const mutedOf = new Map(mutes.map((u) => [String(u._id), mutedUntilMs(u)]));
    const totalOf = new Map(totals.map((t) => [String(t._id), t.n]));
    const who = (id: Types.ObjectId) => ({ uid: String(id), name: names.get(String(id)) ?? '(삭제된 계정)' });
    return docs.map((d) => ({
      id: String(d._id),
      kind: d.kind,
      reason: d.reason,
      reasonText: REASON_TEXT[d.reason],
      detail: d.detail,
      snapshot: d.snapshot,
      context: d.context,
      reporter: who(d.reporter),
      target: { ...who(d.target), mutedUntil: mutedOf.get(String(d.target)) ?? null, totalReports: totalOf.get(String(d.target)) ?? 1 },
      status: d.status,
      action: d.action,
      note: d.note,
      muteHours: d.muteHours,
      handledBy: d.handledBy ? (names.get(String(d.handledBy)) ?? null) : null,
      handledAt: d.handledAt ? d.handledAt.getTime() : null,
      createdAt: d.createdAt.getTime(),
    }));
  }

  /**
   * 신고를 처리한다. dismiss 는 조치 없이 닫고, warn 은 신고된 글(프로필이면 닉네임·소개)을 지우고 경고 우편을 보내고,
   * mute 는 거기에 더해 muteHours 동안 챗방·개인채팅·프로필 수정을 막는다. 같은 대상의 열린 신고는 함께 처리한다.
   */
  async resolve(admin: UserDto, id: string, body: ResolveReportDto | undefined, now = Date.now()): Promise<ReportDto> {
    if (!isValidObjectId(id)) throw new NotFoundException('신고를 찾을 수 없어요.');
    const action = body?.action;
    if (!action || !REPORT_ACTIONS.includes(action)) throw new BadRequestException('처리 방법을 골라 주세요.');
    const note = cleanMultiline(body?.note);
    if (textLength(note) > REPORT_NOTE_MAX) throw new BadRequestException(`메모는 ${REPORT_NOTE_MAX}자까지 적을 수 있어요.`);
    if (action !== 'dismiss' && textLength(note) === 0) throw new BadRequestException('경고·제재는 당사자에게 가는 안내 글(메모)이 필요해요.');
    let muteHours = 0;
    if (action === 'mute') {
      muteHours = body?.muteHours ?? 24;
      if (!Number.isInteger(muteHours) || muteHours < 1 || muteHours > MUTE_MAX_HOURS) throw new BadRequestException(`이용 제한은 1~${MUTE_MAX_HOURS}시간으로 정해 주세요.`);
    }

    const done = { $set: { status: 'done' as const, action, note, muteHours, handledBy: new Types.ObjectId(admin.id), handledAt: new Date(now) } };
    const doc = await this.reports.findOneAndUpdate({ _id: id, status: 'open' }, done, { returnDocument: 'after' }).exec();
    if (!doc) {
      if (await this.reports.exists({ _id: id }).exec()) throw new ConflictException('이미 처리한 신고예요.');
      throw new NotFoundException('신고를 찾을 수 없어요.');
    }
    // 같은 대상을 신고한 다른 열린 신고도 같은 결과로 닫는다.
    const same = { _id: { $ne: doc._id }, status: 'open' as const, target: doc.target, kind: doc.kind, refId: doc.refId };
    const others = await this.reports.find(same, 'reporter').exec();
    if (others.length > 0) await this.reports.updateMany({ _id: { $in: others.map((o) => o._id) }, status: 'open' }, done).exec();

    const reasonText = REASON_TEXT[doc.reason];
    if (action !== 'dismiss') {
      await this.removeContent(doc);
      let until = 0;
      if (action === 'mute') {
        const target = await this.users.findById(doc.target, 'mutedUntil').exec();
        until = Math.max(now + muteHours * HOUR_MS, target?.mutedUntil?.getTime() ?? 0);
        await this.users.updateOne({ _id: doc.target }, { $set: { mutedUntil: new Date(until) } }).exec();
      }
      const mail = action === 'mute' ? muteMail(reasonText, note, muteHours, until) : warnMail(reasonText, note);
      await this.sendMail(String(doc.target), 'warning', mail);
    }
    const reporters = new Set([String(doc.reporter), ...others.map((o) => String(o.reporter))]);
    await Promise.all([...reporters].map((r) => this.sendMail(r, 'report', reporterMail(action))));

    return (await this.present([doc]))[0];
  }

  /** 지금 이용 제한 중인 계정 목록 */
  async muted(now = Date.now()): Promise<MutedListDto> {
    const docs = await this.users.find({ mutedUntil: { $gt: new Date(now) } }, 'name nickname mutedUntil').sort({ mutedUntil: -1 }).limit(LIST_LIMIT).exec();
    return { users: docs.map((u) => ({ uid: String(u._id), name: displayNameOf(u), until: u.mutedUntil!.getTime() })) };
  }

  async unmute(uid: string): Promise<void> {
    if (!isValidObjectId(uid)) throw new NotFoundException('사용자를 찾을 수 없어요.');
    const doc = await this.users.findOneAndUpdate({ _id: uid, mutedUntil: { $ne: null } }, { $set: { mutedUntil: null } }, { returnDocument: 'after' }).exec();
    if (!doc) throw new NotFoundException('이용 제한 중인 사용자가 아니에요.');
    await this.sendMail(uid, 'warning', { title: '✅ 이용 제한 해제', body: '이용 제한이 풀렸어요. 앞으로 즐겁게 이용해 주세요.' });
  }

  /* ---------- 내부 ---------- */

  private async removeContent(doc: ReportDocument): Promise<void> {
    if (doc.kind === 'chat') await this.chat.deleteOne({ _id: doc.refId }).exec();
    else if (doc.kind === 'dm') await this.dms.deleteOne({ _id: doc.refId }).exec();
    else await this.users.updateOne({ _id: doc.target }, { $set: { nickname: null, bio: null } }).exec();
  }

  /** 안내 우편. 보내지 못해도 처리 자체는 이미 끝났으므로 실패는 무시한다. */
  private async sendMail(to: string, kind: 'warning' | 'report', mail: { title: string; body: string }): Promise<void> {
    await this.mailbox.send(to, { kind, title: mail.title, body: mail.body, fromName: '운영팀' }).catch(() => undefined);
  }

  private async nameMap(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.map(String))].map((i) => new Types.ObjectId(i));
    const docs = await this.users.find({ _id: { $in: unique } }, 'name nickname').exec();
    return new Map(docs.map((u) => [String(u._id), displayNameOf(u)]));
  }
}
