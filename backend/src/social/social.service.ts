import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { UserDto } from '../auth/dto/auth.dto.js';
import { DirectMessage } from '../dm/direct-message.schema.js';
import { FriendsService } from '../friends/friends.service.js';
import { MailboxService } from '../mailbox/mailbox.service.js';
import type { SocialSummaryDto } from './dto/social.dto.js';

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(DirectMessage.name) private readonly dms: Model<DirectMessage>,
    private readonly mailbox: MailboxService,
    private readonly friends: FriendsService,
  ) {}

  async summary(user: UserDto): Promise<SocialSummaryDto> {
    const me = new Types.ObjectId(user.id);
    const [mail, friendRequests, dmUnread] = await Promise.all([this.mailbox.counts(me), this.friends.incomingCount(user.id), this.dms.countDocuments({ to: me, readAt: null }).exec()]);
    return { mailUnread: mail.unread, mailClaimable: mail.claimable, friendRequests, dmUnread };
  }
}
