import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { LiveRecordBodyDto, LiveRecordDto, LiveRecordResultDto, MyLiveRecordsDto } from './dto/live.dto.js';
import { LiveRecord } from './live.schema.js';
import { RECENT_MAX, applyGame, incOf, parseGameEntry, pushRecent, toRecordDto, type GameEntry, type RecordStats } from './records.js';

/** 읽어 온 기록 문서(lean)에서 쓰는 부분 */
interface RecordDoc extends RecordStats {
  recent?: GameEntry[];
}

@Injectable()
export class LiveRecordsService {
  constructor(@InjectModel(LiveRecord.name) private readonly records: Model<LiveRecord>) {}

  /**
   * 가사 빈칸 속도전 한 판의 결과를 사람의 기록에 쌓는다. 같은 ref(방·사람)는 한 번만 쌓이고 두 번째 요청은 현재 기록을 돌려준다.
   * 누적은 `$inc`, 최고는 `$max`, 최근 판은 `$push`+`$slice` 로 한 번에 원자적으로 바꾼다.
   */
  async record(body: LiveRecordBodyDto | undefined, now = Date.now()): Promise<LiveRecordResultDto> {
    const uid = (body as Partial<LiveRecordBodyDto> | undefined)?.uid;
    if (typeof uid !== 'string' || !isValidObjectId(uid)) throw new BadRequestException('uid 가 올바르지 않아요.');
    if ((body as Partial<LiveRecordBodyDto>).game !== 'lyric') throw new BadRequestException('game 이 올바르지 않아요.');
    const entry = parseGameEntry(body, now);
    if (!entry) throw new BadRequestException('기록이 올바르지 않아요.');
    const userId = new Types.ObjectId(uid);

    let before: RecordDoc | null;
    try {
      before = await this.records
        .findOneAndUpdate(
          { userId, game: 'lyric', 'recent.ref': { $ne: entry.ref } },
          { $inc: incOf(entry), $max: { bestScore: entry.score, bestCorrect: entry.correct }, $push: { recent: { $each: [entry], $slice: -RECENT_MAX } } },
          { upsert: true, returnDocument: 'before' },
        )
        .lean<RecordDoc>()
        .exec();
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      // 이미 쌓은 판(재시도): 현재 기록을 그대로 돌려준다
      return { record: await this.mineOf(userId), best: { score: false, correct: false } };
    }
    const { after, best } = applyGame(before, entry);
    return { record: toRecordDto(after, pushRecent(before?.recent ?? [], entry)), best };
  }

  /** 내 기록(한 판도 안 했으면 0과 빈 목록) */
  async mine(uid: string): Promise<MyLiveRecordsDto> {
    return { lyric: await this.mineOf(new Types.ObjectId(uid)) };
  }

  private async mineOf(userId: Types.ObjectId): Promise<LiveRecordDto> {
    const doc = await this.records.findOne({ userId, game: 'lyric' }).lean<RecordDoc>().exec();
    return toRecordDto(doc, doc?.recent ?? []);
  }
}
