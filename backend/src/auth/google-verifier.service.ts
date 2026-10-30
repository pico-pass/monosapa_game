import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppConfig } from '../config/app.config.js';
import type { GoogleProfile } from '../users/users.service.js';

/** 구글이 서명한 ID 토큰을 검증한다. 서명·만료·발급 대상(aud)이 모두 맞아야 한다. */
@Injectable()
export class GoogleVerifierService {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: AppConfig) {}

  /** 검증에 실패하면 null. 구글 인증서는 라이브러리가 받아 캐시한다. */
  async verify(idToken: string): Promise<GoogleProfile | null> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.config.googleClientId });
      const p = ticket.getPayload();
      if (!p?.sub) return null;
      return { sub: p.sub, email: p.email_verified ? (p.email ?? null) : null, name: p.name ?? null, picture: p.picture ?? null };
    } catch {
      return null;
    }
  }
}
