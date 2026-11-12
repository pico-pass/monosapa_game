import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { BossModule } from './boss/boss.module.js';
import { ChallengeModule } from './challenge/challenge.module.js';
import { ChartModule } from './chart/chart.module.js';
import { ChatModule } from './chat/chat.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DmModule } from './dm/dm.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { HealthModule } from './health/health.module.js';
import { InquiriesModule } from './inquiries/inquiries.module.js';
import { LaunchModule } from './launch/launch.module.js';
import { LiveModule } from './live/live.module.js';
import { MailboxModule } from './mailbox/mailbox.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { RankingModule } from './ranking/ranking.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SavesModule } from './saves/saves.module.js';
import { SocialModule } from './social/social.module.js';
import { TradesModule } from './trades/trades.module.js';
import { UsersModule } from './users/users.module.js';
import { VillageModule } from './village/village.module.js';

/** 루트 모듈. 기능은 기능별 모듈로 나눠 여기서 가져온다. */
@Module({
  imports: [ConfigModule, DatabaseModule, UsersModule, AuthModule, SavesModule, RankingModule, ChatModule, InquiriesModule, ChallengeModule, ChartModule, TradesModule, ProfilesModule, FriendsModule, MailboxModule, DmModule, ReportsModule, VillageModule, BossModule, LiveModule, LaunchModule, SocialModule, HealthModule],
})
export class AppModule {}
