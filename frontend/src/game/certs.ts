import { BALANCE, STREAM_CERT_VIBE, STREAM_PLATFORMS } from './balance';
import { clampResource } from './selectors';
import type { CommandResult, Fail, FailReason, GameState, StreamPlatform, Streaming } from './types';

/*
 * 스트리밍 인증. 플랫폼별 누적 스트리밍이 단계 기준(balance.ts의 certs.tiers)을 넘으면 그 단계를 받을 수 있다.
 * 받으면 다이아가 한 번 나가고, 받은 단계 수만큼 그 플랫폼의 갈래(STREAM_CERT_VIBE)가 영구히 올라간다(packdata.ts의 bonuses).
 * 받지 않은 단계는 사라지지 않고, 한 번에 여러 단계를 몰아 받을 수 있다.
 */

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export const emptyCerts = (): Streaming['certs'] => ({ spotify: 0, ytmusic: 0, melon: 0, applemusic: 0 });

export const CERT_TIER_COUNT = BALANCE.certs.tiers.length;

/** 누적 스트리밍으로 닿은 단계 수 */
export function certReached(total: number): number {
  let n = 0;
  while (n < CERT_TIER_COUNT && total >= BALANCE.certs.tiers[n].need) n++;
  return n;
}

export interface CertStatus {
  platform: StreamPlatform;
  /** 누적 스트리밍 */
  total: number;
  /** 닿은 단계 수 / 받은 단계 수 */
  reached: number;
  claimed: number;
  /** 지금 받을 수 있는 다이아 (받을 단계가 없으면 0) */
  diamonds: number;
  /** 받은 단계가 주는 영구 보너스(비율) */
  bonus: number;
  /** 다음 단계 기준. 끝까지 닿았으면 null */
  next: number | null;
}

export function certStatus(s: Pick<GameState, 'streaming'>, platform: StreamPlatform): CertStatus {
  const total = s.streaming.totals[platform];
  const reached = certReached(total);
  const claimed = Math.min(s.streaming.certs[platform] ?? 0, CERT_TIER_COUNT);
  const diamonds = BALANCE.certs.tiers.slice(claimed, reached).reduce((a, t) => a + t.diamonds, 0);
  return {
    platform,
    total,
    reached,
    claimed,
    diamonds,
    bonus: claimed * BALANCE.certs.bonusPerTier,
    next: reached < CERT_TIER_COUNT ? BALANCE.certs.tiers[reached].need : null,
  };
}

/** 받을 수 있는 인증이 있는 플랫폼 수 (알림 점) */
export const certsClaimable = (s: Pick<GameState, 'streaming'>): number => STREAM_PLATFORMS.filter((p) => certStatus(s, p).reached > certStatus(s, p).claimed).length;

/** 그 플랫폼에서 닿은 인증 단계를 모두 받는다. 받을 단계가 없으면 nothing_to_claim. */
export function claimCert(state: GameState, platform: StreamPlatform): CommandResult<{ tiers: number; diamonds: number; vibe: (typeof STREAM_CERT_VIBE)[StreamPlatform] }> {
  if (!STREAM_PLATFORMS.includes(platform)) return fail(state, 'not_found');
  const st = certStatus(state, platform);
  if (st.reached <= st.claimed) return fail(state, 'nothing_to_claim');
  const next: GameState = {
    ...state,
    diamonds: clampResource(state.diamonds + st.diamonds),
    streaming: { ...state.streaming, certs: { ...state.streaming.certs, [platform]: st.reached } },
  };
  return { ok: true, state: next, tiers: st.reached - st.claimed, diamonds: st.diamonds, vibe: STREAM_CERT_VIBE[platform] };
}
