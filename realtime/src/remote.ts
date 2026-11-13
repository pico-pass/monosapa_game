/*
 * 메인 서버(NestJS)와 이야기하는 부분: 로그인 확인과 보상 우편.
 * 둘 다 같은 컴퓨터의 127.0.0.1 로만 부른다.
 */
import type { RecordRequest, RecordResult, RecordSink, RewardRequest, RewardSink } from './hub.js';

export interface LiveUser {
  uid: string;
  name: string;
}

export type AuthFn = (cookie: string | undefined) => Promise<LiveUser | null>;

/** 쿠키를 메인 서버의 `GET /api/auth/me` 에 넘겨 로그인한 사람을 알아낸다. */
export function httpAuth(url: string): AuthFn {
  return async (cookie) => {
    if (!cookie) return null;
    const res = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { id?: unknown; displayName?: unknown; name?: unknown } | null };
    const u = body.user;
    if (!u || typeof u.id !== 'string') return null;
    const name = typeof u.displayName === 'string' && u.displayName ? u.displayName : typeof u.name === 'string' && u.name ? u.name : '익명';
    return { uid: u.id, name: name.slice(0, 20) };
  };
}

/** 메인 서버의 내부 보상 주소로 다이아 우편을 요청한다. 비밀 값이 비어 있으면 보상은 꺼진 것으로 본다. */
export function httpRewards(url: string, secret: string): RewardSink {
  return {
    async pay(req: RewardRequest) {
      if (!secret) return null;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-realtime-secret': secret },
        body: JSON.stringify({ uid: req.uid, game: req.game, diamonds: req.diamonds, ref: req.ref, label: req.label }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`보상 요청 실패(${res.status})`);
      const body = (await res.json()) as { granted?: unknown; capped?: unknown };
      return { granted: typeof body.granted === 'number' ? body.granted : 0, capped: body.capped === true };
    },
  };
}

/** 메인 서버의 내부 기록 주소로 판 기록을 보낸다. 비밀 값이 비어 있으면 기록은 꺼진 것으로 본다. */
export function httpRecords(url: string, secret: string): RecordSink {
  return {
    async save(req: RecordRequest) {
      if (!secret) return null;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-realtime-secret': secret },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`기록 요청 실패(${res.status})`);
      const body = (await res.json()) as { record?: unknown; best?: { score?: unknown; correct?: unknown } };
      if (typeof body.record !== 'object' || body.record === null) return null;
      return { record: body.record as RecordResult['record'], best: { score: body.best?.score === true, correct: body.best?.correct === true } };
    },
  };
}
