import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, isValidObjectId, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { dayOf } from '../common/week.js';
import { FriendsService } from '../friends/friends.service.js';
import { Save } from '../saves/save.schema.js';
import { PERSON_FIELDS, toPerson } from '../users/person.js';
import { User } from '../users/user.schema.js';
import type { FlagClaimDto, FlagPendingDto, FlagSentDto, VillageViewDto } from './dto/village.dto.js';
import { FLAG_CLAIM_BATCH, FLAG_HEARTS, tilesOf, villageFameOf, villageSideOf } from './rules.js';
import { VillageFlag } from './village.schema.js';

/** 저장에서 읽어 오는 일부 필드(fans 는 서버가 저장 때마다 계산해 둔 값) */
interface SaveSlice {
  fans?: number;
  state?: unknown;
}

const isDuplicate = (e: unknown): boolean => (e as { code?: number }).code === 11000;

@Injectable()
export class VillageService {
  constructor(
    @InjectModel(VillageFlag.name) private readonly flags: Model<VillageFlag>,
    @InjectModel(Save.name) private readonly saves: Model<Save>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly friends: FriendsService,
  ) {}

  /** 친구(또는 나)의 마을을 읽는다. 저장에서 마을 부분만 읽어 모양을 거른 뒤 내려준다. */
  async view(viewer: UserDto, uid: string, now = Date.now()): Promise<VillageViewDto> {
    if (!isValidObjectId(uid)) throw new NotFoundException('마을을 찾을 수 없어요.');
    if (uid !== viewer.id && !(await this.friends.areFriends(viewer.id, uid))) throw new ForbiddenException('친구의 마을만 볼 수 있어요.');
    const target = new Types.ObjectId(uid);
    const [save, user, flagged] = await Promise.all([
      this.saves.findOne({ userId: target }, { fans: 1, 'state.village': 1 }).lean().exec() as unknown as Promise<SaveSlice | null>,
      this.users.findById(target, PERSON_FIELDS).exec(),
      this.flags.exists({ from: new Types.ObjectId(viewer.id), to: target, day: dayOf(now) }).exec(),
    ]);
    const side = villageSideOf(save?.fans);
    if (!user || !save || side === 0) throw new NotFoundException('아직 마을이 열리지 않았어요.');
    const person = toPerson(user, now);
    return { uid, name: person.name, picture: person.picture, avatar: person.avatar, side, fame: villageFameOf(save.state), tiles: tilesOf(save.state), flaggedToday: !!flagged };
  }

  /** 친구 마을에 하루 한 번 응원 깃발을 꽂는다. 꽂은 사람은 바로 ❤️를 받고(클라이언트가 반영), 마을 주인은 나중에 받는다. */
  async flag(viewer: UserDto, uid: string, now = Date.now()): Promise<FlagSentDto> {
    if (!isValidObjectId(uid) || uid === viewer.id || !(await this.friends.areFriends(viewer.id, uid))) throw new ForbiddenException('친구 마을에만 깃발을 꽂을 수 있어요.');
    const target = new Types.ObjectId(uid);
    const save = (await this.saves.findOne({ userId: target }, { fans: 1 }).lean().exec()) as unknown as SaveSlice | null;
    if (villageSideOf(save?.fans) === 0) throw new NotFoundException('아직 마을이 열리지 않은 친구예요.');
    try {
      await this.flags.create({ from: new Types.ObjectId(viewer.id), to: target, day: dayOf(now) });
    } catch (e) {
      if (isDuplicate(e)) throw new ConflictException('오늘은 이미 이 친구 마을에 깃발을 꽂았어요.');
      throw e;
    }
    return { hearts: FLAG_HEARTS };
  }

  /** 아직 받지 않은 깃발 수 */
  async pending(userId: string): Promise<FlagPendingDto> {
    return { pending: await this.pendingCount(userId) };
  }

  pendingCount(userId: string): Promise<number> {
    return this.flags.countDocuments({ to: new Types.ObjectId(userId), claimed: false }).exec();
  }

  /** 받지 않은 깃발을 한 번에 받는다. 문서마다 claimed를 원자적으로 바꾸므로 같은 깃발은 한 번만 나간다. */
  async claim(userId: string): Promise<FlagClaimDto> {
    const to = new Types.ObjectId(userId);
    const open = await this.flags.find({ to, claimed: false }, { _id: 1 }).limit(FLAG_CLAIM_BATCH).exec();
    const res = open.length > 0 ? await this.flags.updateMany({ _id: { $in: open.map((d) => d._id) }, claimed: false }, { $set: { claimed: true } }).exec() : null;
    const count = res?.modifiedCount ?? 0;
    if (count < 1) throw new NotFoundException('받을 깃발이 없어요.');
    return { count, hearts: count * FLAG_HEARTS };
  }
}
