import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { Save, type SaveDocument } from '../saves/save.schema.js';
import { rankFieldsOf } from '../saves/saves.service.js';
import type { SinglesSide } from '../saves/singles.js';
import { PERSON_FIELDS, toPerson, type PersonDto } from '../users/person.js';
import { User } from '../users/user.schema.js';
import type { NurtureRankingDto, NurtureRankingEntryDto, RankingDto, RankingEntryDto, SinglesRankingDto, SinglesRankingEntryDto, TowerRankingDto, TowerRankingEntryDto, VillageRankingDto, VillageRankingEntryDto } from './dto/ranking.dto.js';

export const RANKING_SIZE = 20;

@Injectable()
export class RankingService implements OnModuleInit {
  private readonly log = new Logger(RankingService.name);

  constructor(
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** 랭킹 필드(팬 수·레벨·계단 최고 층·육성 레벨·마을 명성·싱글 발매 수)가 생기기 전에 저장된 문서에 값을 채운다. (이미 채워진 문서는 건드리지 않는다) */
  async onModuleInit(): Promise<void> {
    const old = await this.saves
      .find({ $or: [{ level: { $exists: false } }, { towerBest: { $exists: false } }, { nurtureTotal: { $exists: false } }, { villageFame: { $exists: false } }, { singlesNormal: { $exists: false } }, { singlesDark: { $exists: false } }] })
      .exec();
    for (const doc of old) await this.saves.updateOne({ _id: doc._id }, { $set: rankFieldsOf(doc.state) }).exec();
    if (old.length > 0) this.log.log(`랭킹 필드 채움: ${old.length}개`);
  }

  /** 계정 ID로 보여 줄 모습(프로필 설정의 이름·사진과 마지막 접속 몇 ms 전)을 찾아 준다. 이메일은 읽지 않는다. */
  private async profiles(ids: Types.ObjectId[]): Promise<Map<string, PersonDto>> {
    const unique = [...new Set(ids.map(String))].map((i) => new Types.ObjectId(i));
    const users = await this.users.find({ _id: { $in: unique } }, PERSON_FIELDS).exec();
    const now = Date.now();
    return new Map(users.map((u) => [String(u._id), toPerson(u, now)]));
  }

  /** 랭킹 줄에 공통으로 들어가는 사람 정보 */
  private who(d: SaveDocument, rank: number, profileOf: Map<string, PersonDto>, viewerId: string) {
    const p = profileOf.get(String(d.userId));
    return { rank, uid: String(d.userId), name: p?.name ?? '익명', picture: p?.picture ?? null, avatar: p?.avatar ?? ('google' as const), seenAgoMs: p?.seenAgoMs ?? null, me: String(d.userId) === viewerId };
  }

  async top(viewerId: string): Promise<RankingDto> {
    const viewer = new Types.ObjectId(viewerId);
    const [docs, total, mine] = await Promise.all([
      this.saves.find().sort({ level: -1, fans: -1, _id: 1 }).limit(RANKING_SIZE).exec(),
      this.saves.countDocuments().exec(),
      this.saves.findOne({ userId: viewer }).exec(),
    ]);
    const profileOf = await this.profiles([...docs.map((d) => d.userId), ...(mine ? [mine.userId] : [])]);

    const entry = (d: SaveDocument, rank: number): RankingEntryDto => ({ ...this.who(d, rank, profileOf, viewerId), level: d.level, fans: d.fans });

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

    const entry = (d: SaveDocument, rank: number): TowerRankingEntryDto => ({ ...this.who(d, rank, profileOf, viewerId), floor: d.towerBest, level: d.level });

    let mineEntry: TowerRankingEntryDto | null = null;
    if (mine && mine.towerBest > 0) {
      const ahead = await this.saves.countDocuments({ $or: [{ towerBest: { $gt: mine.towerBest } }, { towerBest: mine.towerBest, _id: { $lt: mine._id } }] }).exec();
      mineEntry = entry(mine, ahead + 1);
    }
    return { entries: docs.map((d, i) => entry(d, i + 1)), mine: mineEntry, total };
  }

  /** 모노사파 육성 랭킹: 일반·어둠 육성 레벨의 합계가 높은 순, 같으면 성장도 합계, 그래도 같으면 먼저 가입한 쪽. 한 번도 육성하지 않은 계정은 오르지 않는다. */
  async nurtureTop(viewerId: string): Promise<NurtureRankingDto> {
    const viewer = new Types.ObjectId(viewerId);
    const raised = { nurtureXp: { $gt: 0 } };
    const [docs, total, mine] = await Promise.all([
      this.saves.find(raised).sort({ nurtureTotal: -1, nurtureXp: -1, _id: 1 }).limit(RANKING_SIZE).exec(),
      this.saves.countDocuments(raised).exec(),
      this.saves.findOne({ userId: viewer }).exec(),
    ]);
    const profileOf = await this.profiles([...docs.map((d) => d.userId), ...(mine ? [mine.userId] : [])]);

    const entry = (d: SaveDocument, rank: number): NurtureRankingEntryDto => ({ ...this.who(d, rank, profileOf, viewerId), normal: d.nurtureNormal, dark: d.nurtureDark, total: d.nurtureTotal });

    let mineEntry: NurtureRankingEntryDto | null = null;
    if (mine && mine.nurtureXp > 0) {
      const ahead = await this.saves
        .countDocuments({
          $or: [
            { nurtureTotal: { $gt: mine.nurtureTotal } },
            { nurtureTotal: mine.nurtureTotal, nurtureXp: { $gt: mine.nurtureXp } },
            { nurtureTotal: mine.nurtureTotal, nurtureXp: mine.nurtureXp, _id: { $lt: mine._id } },
          ],
        })
        .exec();
      mineEntry = entry(mine, ahead + 1);
    }
    return { entries: docs.map((d, i) => entry(d, i + 1)), mine: mineEntry, total };
  }
  /** 팬 마을 명성 랭킹: 건물 레벨 합계가 높은 순, 같으면 먼저 가입한 쪽. 건물이 하나도 없는 계정은 오르지 않는다. */
  async villageTop(viewerId: string): Promise<VillageRankingDto> {
    const viewer = new Types.ObjectId(viewerId);
    const built = { villageFame: { $gt: 0 } };
    const [docs, total, mine] = await Promise.all([
      this.saves.find(built).sort({ villageFame: -1, _id: 1 }).limit(RANKING_SIZE).exec(),
      this.saves.countDocuments(built).exec(),
      this.saves.findOne({ userId: viewer }).exec(),
    ]);
    const profileOf = await this.profiles([...docs.map((d) => d.userId), ...(mine ? [mine.userId] : [])]);

    const entry = (d: SaveDocument, rank: number): VillageRankingEntryDto => ({ ...this.who(d, rank, profileOf, viewerId), fame: d.villageFame, level: d.level });

    let mineEntry: VillageRankingEntryDto | null = null;
    if (mine && mine.villageFame > 0) {
      const ahead = await this.saves.countDocuments({ $or: [{ villageFame: { $gt: mine.villageFame } }, { villageFame: mine.villageFame, _id: { $lt: mine._id } }] }).exec();
      mineEntry = entry(mine, ahead + 1);
    }
    return { entries: docs.map((d, i) => entry(d, i + 1)), mine: mineEntry, total };
  }

  /** 싱글 발매 수 랭킹(자아별): 그 자아로 발매한 싱글이 많은 순, 같으면 먼저 가입한 쪽. 한 장도 발매하지 않은 계정은 오르지 않는다. */
  async singlesTop(viewerId: string, side: SinglesSide): Promise<SinglesRankingDto> {
    const viewer = new Types.ObjectId(viewerId);
    const field = side === 'dark' ? 'singlesDark' : 'singlesNormal';
    const released = { [field]: { $gt: 0 } };
    const [docs, total, mine] = await Promise.all([
      this.saves.find(released).sort({ [field]: -1, _id: 1 }).limit(RANKING_SIZE).exec(),
      this.saves.countDocuments(released).exec(),
      this.saves.findOne({ userId: viewer }).exec(),
    ]);
    const profileOf = await this.profiles([...docs.map((d) => d.userId), ...(mine ? [mine.userId] : [])]);

    const entry = (d: SaveDocument, rank: number): SinglesRankingEntryDto => ({ ...this.who(d, rank, profileOf, viewerId), count: d[field], level: d.level });

    let mineEntry: SinglesRankingEntryDto | null = null;
    if (mine && mine[field] > 0) {
      const ahead = await this.saves.countDocuments({ $or: [{ [field]: { $gt: mine[field] } }, { [field]: mine[field], _id: { $lt: mine._id } }] }).exec();
      mineEntry = entry(mine, ahead + 1);
    }
    return { entries: docs.map((d, i) => entry(d, i + 1)), mine: mineEntry, total };
  }
}
