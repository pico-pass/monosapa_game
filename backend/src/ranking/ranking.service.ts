import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { Save, type SaveDocument } from '../saves/save.schema.js';
import { rankFieldsOf } from '../saves/saves.service.js';
import { User } from '../users/user.schema.js';
import type { RankingDto, RankingEntryDto, TowerRankingDto, TowerRankingEntryDto } from './dto/ranking.dto.js';

export const RANKING_SIZE = 20;

@Injectable()
export class RankingService implements OnModuleInit {
  private readonly log = new Logger(RankingService.name);

  constructor(
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** 랭킹 필드(팬 수·레벨·계단 최고 층)가 생기기 전에 저장된 문서에 값을 채운다. (이미 채워진 문서는 건드리지 않는다) */
  async onModuleInit(): Promise<void> {
    const old = await this.saves.find({ $or: [{ level: { $exists: false } }, { towerBest: { $exists: false } }] }).exec();
    for (const doc of old) await this.saves.updateOne({ _id: doc._id }, { $set: rankFieldsOf(doc.state) }).exec();
    if (old.length > 0) this.log.log(`랭킹 필드 채움: ${old.length}개`);
  }

  /** 구글 프로필(이름·사진)을 계정 ID로 찾아 준다. 이메일은 읽지 않는다. */
  private async profiles(ids: Types.ObjectId[]): Promise<Map<string, { name: string; picture: string | null }>> {
    const unique = [...new Set(ids.map(String))].map((i) => new Types.ObjectId(i));
    const users = await this.users.find({ _id: { $in: unique } }).exec();
    return new Map(users.map((u) => [String(u._id), { name: u.name?.trim() || '익명', picture: u.picture ?? null }]));
  }

  async top(viewerId: string): Promise<RankingDto> {
    const viewer = new Types.ObjectId(viewerId);
    const [docs, total, mine] = await Promise.all([
      this.saves.find().sort({ level: -1, fans: -1, _id: 1 }).limit(RANKING_SIZE).exec(),
      this.saves.countDocuments().exec(),
      this.saves.findOne({ userId: viewer }).exec(),
    ]);
    const profileOf = await this.profiles([...docs.map((d) => d.userId), ...(mine ? [mine.userId] : [])]);

    const entry = (d: SaveDocument, rank: number): RankingEntryDto => {
      const p = profileOf.get(String(d.userId));
      return { rank, name: p?.name ?? '익명', picture: p?.picture ?? null, level: d.level, fans: d.fans, me: String(d.userId) === viewerId };
    };

    let mineEntry: RankingEntryDto | null = null;
    if (mine) {
      const ahead = await this.saves
        .countDocuments({ $or: [{ level: { $gt: mine.level } }, { level: mine.level, fans: { $gt: mine.fans } }, { level: mine.level, fans: mine.fans, _id: { $lt: mine._id } }] })
        .exec();
      mineEntry = entry(mine, ahead + 1);
    }
    return { entries: docs.map((d, i) => entry(d, i + 1)), mine: mineEntry, total };
  }

  /** 무한의 계단 최고 층 랭킹. 같은 층이면 계정을 먼저 만든 쪽이 앞선다. 한 층도 못 깬 계정은 오르지 않는다. */
  async towerTop(viewerId: string): Promise<TowerRankingDto> {
    const viewer = new Types.ObjectId(viewerId);
    const climbed = { towerBest: { $gt: 0 } };
    const [docs, total, mine] = await Promise.all([
      this.saves.find(climbed).sort({ towerBest: -1, _id: 1 }).limit(RANKING_SIZE).exec(),
      this.saves.countDocuments(climbed).exec(),
      this.saves.findOne({ userId: viewer }).exec(),
    ]);
    const profileOf = await this.profiles([...docs.map((d) => d.userId), ...(mine ? [mine.userId] : [])]);

    const entry = (d: SaveDocument, rank: number): TowerRankingEntryDto => {
      const p = profileOf.get(String(d.userId));
      return { rank, name: p?.name ?? '익명', picture: p?.picture ?? null, floor: d.towerBest, level: d.level, me: String(d.userId) === viewerId };
    };

    let mineEntry: TowerRankingEntryDto | null = null;
    if (mine && mine.towerBest > 0) {
      const ahead = await this.saves.countDocuments({ $or: [{ towerBest: { $gt: mine.towerBest } }, { towerBest: mine.towerBest, _id: { $lt: mine._id } }] }).exec();
      mineEntry = entry(mine, ahead + 1);
    }
    return { entries: docs.map((d, i) => entry(d, i + 1)), mine: mineEntry, total };
  }
}
