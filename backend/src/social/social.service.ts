import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { BossService } from '../boss/boss.service.js';
import { DirectMessage } from '../dm/direct-message.schema.js';
import { FriendsService } from '../friends/friends.service.js';
import { MailboxService } from '../mailbox/mailbox.service.js';
import { VillageService } from '../village/village.service.js';
import type { SocialSummaryDto } from './dto/social.dto.js';

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(DirectMessage.name) private readonly dms: Model<DirectMessage>,
    private readonly mailbox: MailboxService,
    private readonly friends: FriendsService,
    private readonly village: VillageService,
    private readonly boss: BossService,
  ) {}

  async summary(user: UserDto): Promise<SocialSummaryDto> {
    const me = new Types.ObjectId(user.id);
    const [mail, friendRequests, dmUnread, villageFlags, bossClaimable] = await Promise.all([
      this.mailbox.counts(me),
      this.friends.incomingCount(user.id),
      this.dms.countDocuments({ to: me, readAt: null }).exec(),
      // 마을·보스 개수는 덤이라 실패해도 우편·친구 알림까지 깨지지 않게 0으로 둔다.
      this.village.pendingCount(user.id).catch(() => 0),
      this.boss.claimableCount(user.id).catch(() => 0),
    ]);
    return { mailUnread: mail.unread, mailClaimable: mail.claimable, friendRequests, dmUnread, villageFlags, bossClaimable };
  }
}
