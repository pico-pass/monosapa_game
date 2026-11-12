import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { MailboxService } from '../mailbox/mailbox.service.js';
import { User } from '../users/user.schema.js';
import type { LaunchEnterDto } from './dto/launch.dto.js';
import { LaunchGrant, LaunchMeta } from './launch.schema.js';
import { LAUNCH, launchRef, newcomerEligible, popupOpen, starterMailText } from './rules.js';

export interface LaunchState {
  /** 저장 세대. 초기화가 시작되면 올라간다. */
  epoch: number;
  /** 초기화를 모두 마쳤는가 */
  launched: boolean;
  launchedAt: number | null;
}

/** 저장할 때마다 읽으므로 잠깐 기억해 둔다(초기화는 서버를 멈추고 하고 켜면 새로 읽는다). */
const CACHE_MS = 5_000;

@Injectable()
export class LaunchService {
  private cache: { at: number; value: LaunchState } | null = null;

  constructor(
    @InjectModel(LaunchMeta.name) private readonly meta: Model<LaunchMeta>,
    @InjectModel(LaunchGrant.name) private readonly grants: Model<LaunchGrant>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly mailbox: MailboxService,
  ) {}

  async state(now = Date.now()): Promise<LaunchState> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.value;
    const doc = await this.meta.findById('launch').lean().exec();
    const value: LaunchState = doc
      ? { epoch: doc.epoch ?? 0, launched: doc.status === 'done', launchedAt: doc.launchedAt ? new Date(doc.launchedAt).getTime() : null }
      : { epoch: 0, launched: false, launchedAt: null };
    this.cache = { at: now, value };
    return value;
  }

  async epoch(): Promise<number> {
    return (await this.state()).epoch;
  }

  /**
   * 게임에 들어올 때 부른다. 출시 상태를 알려 주고, 출시 뒤에 가입한 신규 계정이면 스타트 패키지 우편을 한 번만 보낸다.
   * (출시 시점에 있던 계정은 초기화 스크립트가 이미 보냈다.)
   */
  async enter(user: UserDto, now = Date.now()): Promise<LaunchEnterDto> {
    const st = await this.state(now);
    const base: LaunchEnterDto = {
      launched: st.launched,
      epoch: st.epoch,
      launchedAt: st.launchedAt,
      popup: st.launched && st.launchedAt !== null && popupOpen(st.launchedAt, now),
      starter: { coins: LAUNCH.starter.coins, diamonds: LAUNCH.starter.diamonds },
      granted: false,
    };
    if (!st.launched || st.launchedAt === null) return base;
    const doc = await this.users.findById(user.id, 'createdAt').lean().exec();
    const createdAt = doc?.createdAt ? new Date(doc.createdAt).getTime() : null;
    if (createdAt === null || !newcomerEligible(createdAt, st.launchedAt)) return base;
    return { ...base, granted: await this.grantStarter(user.id, now) };
  }

  /** 스타트 패키지를 한 번만 보낸다. 장부에 먼저 적어서(유니크) 동시에 불러도 한 통만 간다. */
  private async grantStarter(uid: string, now: number): Promise<boolean> {
    const ref = launchRef('starter', uid);
    try {
      await this.grants.create({ ref, userId: new Types.ObjectId(uid), kind: 'starter' });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false;
      throw e;
    }
    const { title, body } = starterMailText();
    await this.mailbox.send(uid, { kind: 'launch', title, body, ...LAUNCH.starter, ref, fromName: '운영팀', retentionDays: LAUNCH.mailDays }, now);
    return true;
  }
}
