import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import { cleanLine } from '../common/text.js';
import { dayOf } from '../common/week.js';
import { MailboxService } from '../mailbox/mailbox.service.js';
import type { LiveRewardBodyDto, LiveRewardResultDto } from './dto/live.dto.js';
import { LiveDaily, LiveReward } from './live.schema.js';
import { LIVE_LABEL_MAX, LIVE_MAX_REWARD, LIVE_REF_MAX, grantedOf, isLiveGame, liveMailTitle } from './rules.js';

const DAY_MS = 86_400_000;
const CAS_TRIES = 5;

@Injectable()
export class LiveService {
  constructor(
    @InjectModel(LiveReward.name) private readonly ledger: Model<LiveReward>,
    @InjectModel(LiveDaily.name) private readonly daily: Model<LiveDaily>,
    private readonly mailbox: MailboxService,
  ) {}

  /**
   * 라이브 보상을 우편으로 보낸다. 같은 ref 는 한 번만 나가고(두 번째 요청은 처음 결과를 돌려준다),
   * 하루(한국 시간) 합계는 LIVE_DAILY_CAP 을 넘지 못한다.
   */
  async grant(body: LiveRewardBodyDto | undefined, now = Date.now()): Promise<LiveRewardResultDto> {
    const { uid, game, diamonds, ref, label } = body ?? ({} as Partial<LiveRewardBodyDto>);
    if (typeof uid !== 'string' || !isValidObjectId(uid)) throw new BadRequestException('uid 가 올바르지 않아요.');
    if (!isLiveGame(game)) throw new BadRequestException('game 이 올바르지 않아요.');
    if (!Number.isInteger(diamonds) || (diamonds as number) < 1 || (diamonds as number) > LIVE_MAX_REWARD) throw new BadRequestException('diamonds 가 올바르지 않아요.');
    if (typeof ref !== 'string' || ref.length === 0 || ref.length > LIVE_REF_MAX) throw new BadRequestException('ref 가 올바르지 않아요.');
    const want = diamonds as number;
    const title = cleanLine(typeof label === 'string' ? label : '').slice(0, LIVE_LABEL_MAX) || '미니게임';
    const userId = new Types.ObjectId(uid);

    try {
      await this.ledger.create({ ref, userId, game, want, granted: -1 });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const prev = await this.ledger.findOne({ ref }).exec();
      const granted = Math.max(0, prev?.granted ?? 0);
      return { granted, capped: granted < want };
    }

    const granted = await this.takeFromDailyCap(userId, dayOf(now), want, now);
    if (granted > 0) {
      await this.mailbox.send(uid, { kind: 'live', title: liveMailTitle(title), body: `다이아 ${granted}개를 보냈어요. 우편함에서 받아 가세요.${granted < want ? ' (오늘 라이브 보상 한도에 닿았어요)' : ''}`, diamonds: granted }, now);
    }
    await this.ledger.updateOne({ ref }, { $set: { granted } }).exec();
    return { granted, capped: granted < want };
  }

  /** 오늘 한도에서 want 중 내줄 수 있는 만큼을 원자적으로 가져간다(값이 그대로일 때만 올리는 비교-교환). */
  private async takeFromDailyCap(userId: Types.ObjectId, day: string, want: number, now: number): Promise<number> {
    for (let i = 0; i < CAS_TRIES; i++) {
      const cur = await this.daily.findOne({ userId, day }).exec();
      const total = cur?.total ?? 0;
      const granted = grantedOf(total, want);
      if (granted <= 0) return 0;
      if (!cur) {
        try {
          await this.daily.create({ userId, day, total: granted, expiresAt: new Date(now + 3 * DAY_MS) });
          return granted;
        } catch (e) {
          if ((e as { code?: number }).code === 11000) continue;
          throw e;
        }
      }
      const res = await this.daily.updateOne({ userId, day, total }, { $inc: { total: granted } }).exec();
      if (res.modifiedCount === 1) return granted;
    }
    return 0;
  }
}
