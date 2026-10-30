import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppConfig } from '../config/app.config.js';
import type { UserDocument } from '../users/user.schema.js';
import { UsersService } from '../users/users.service.js';
import type { UserDto } from './dto/auth.dto.js';
import { GoogleVerifierService } from './google-verifier.service.js';
import { Session } from './session.schema.js';

const MAX_CREDENTIAL_LENGTH = 4096;
const DAY_MS = 86_400_000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const toUserDto = (u: UserDocument, admins: readonly string[] = []): UserDto => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  picture: u.picture,
  isAdmin: !!u.email && admins.includes(u.email.toLowerCase()),
});

@Injectable()
export class AuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly google: GoogleVerifierService,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
  ) {}

  /** 구글 ID 토큰을 검증하고 계정을 만들거나 갱신한 뒤 새 세션을 연다. */
  async loginWithGoogle(credential: unknown): Promise<{ token: string; maxAgeMs: number; user: UserDto }> {
    if (!this.config.googleClientId) throw new ServiceUnavailableException('구글 로그인이 설정되지 않았어요.');
    if (typeof credential !== 'string' || credential.length === 0 || credential.length > MAX_CREDENTIAL_LENGTH) {
      throw new BadRequestException('credential 이 올바르지 않아요.');
    }
    const profile = await this.google.verify(credential);
    if (!profile) throw new UnauthorizedException('구글 로그인 확인에 실패했어요.');

    const user = await this.users.upsertFromGoogle(profile);
    const token = randomBytes(32).toString('base64url');
    const maxAgeMs = this.config.sessionTtlDays * DAY_MS;
    await this.sessions.create({ tokenHash: hashToken(token), userId: user._id, expiresAt: new Date(Date.now() + maxAgeMs) });
    return { token, maxAgeMs, user: toUserDto(user, this.config.adminEmails) };
  }

  /** 쿠키의 토큰으로 로그인한 사용자를 찾는다. 없거나 만료됐으면 null. (TTL 인덱스는 지연될 수 있어 만료 시각도 직접 본다) */
  async findUserByToken(token: string | undefined): Promise<UserDto | null> {
    if (!token) return null;
    const session = await this.sessions.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).exec();
    if (!session) return null;
    const user = await this.users.findById(String(session.userId));
    return user ? toUserDto(user, this.config.adminEmails) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.deleteOne({ tokenHash: hashToken(token) }).exec();
  }
}
