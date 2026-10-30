import { describe, expect, it } from 'vitest';
import { BALANCE, STREAM_PLATFORMS } from '../balance';
import { claimStreaming } from '../commands';
import { createInitialState } from '../persistence';
import { streamClaimStatus, streamRate, streamTotal, streamsPending } from '../selectors';
import { advance, makeReport, OFFLINE, ONLINE, settleOffline, settleOnline } from '../simulation';
import { accrueStreams, platformShares, streamSeedFrom, zeroTotals } from '../streaming';
import type { GameState } from '../types';

const T0 = 1_700_000_000_000;
const sec = (n: number) => n * 1000;
const min = (n: number) => n * 60_000;
const HOUR = 3_600_000;
const S = BALANCE.streaming;

function base(over: Partial<GameState> = {}): GameState {
  return { ...createInitialState(T0), ...over };
}

describe('스트리밍: 쌓이는 양', () => {
  it('팬 100명이 10초 동안 → 100 × 0.2 × 10 = 200 스트리밍이 네 플랫폼에 나뉜다', () => {
    const r = advance(base({ fans: 100 }), sec(10), ONLINE);
    const st = r.state.streaming;
    expect(streamTotal(st)).toBeCloseTo(200, 6);
    for (const p of STREAM_PLATFORMS) expect(st.totals[p]).toBeGreaterThan(0);
    expect(st.settled).toBe(0);
  });

  it('스트리밍은 팬 수에 비례한다', () => {
    const a = streamTotal(advance(base({ fans: 100 }), sec(60)).state.streaming);
    const b = streamTotal(advance(base({ fans: 300 }), sec(60)).state.streaming);
    expect(b / a).toBeCloseTo(3, 9);
    expect(streamRate({ fans: 300 })).toBeCloseTo(60, 9);
  });

  it('팬이 없으면 아무것도 쌓이지 않고 기록 객체도 그대로다', () => {
    const s = base();
    const r = advance(s, sec(600));
    expect(r.state.streaming).toBe(s.streaming);
    expect(streamTotal(r.state.streaming)).toBe(0);
  });

  it('자아와 과열은 스트리밍에 영향을 주지 않는다', () => {
    const normal = advance(base({ fans: 50 }), sec(120)).state.streaming;
    const dark = advance(base({ fans: 50, activePersona: 'dark', heat: 70 }), sec(120)).state.streaming;
    expect(streamTotal(dark)).toBeCloseTo(streamTotal(normal), 9);
  });

  it('한 번에 크게 전진해도 여러 번 나눠 전진해도 플랫폼별 결과가 같다 (구간 경계를 넘나드는 25분)', () => {
    const start = base({ fans: 137 });
    const once = advance(start, min(25)).state.streaming;
    let s = start;
    for (let i = 0; i < 25; i++) s = advance(s, min(1)).state;
    let t = start;
    for (let i = 0; i < 1500; i++) t = advance(t, sec(1)).state;
    for (const p of STREAM_PLATFORMS) {
      expect(s.streaming.totals[p]).toBeCloseTo(once.totals[p], 4);
      expect(t.streaming.totals[p]).toBeCloseTo(once.totals[p], 4);
    }
    expect(streamTotal(once)).toBeCloseTo(137 * S.perFanPerSec * 1500, 4);
  });

  it('오프라인 정산: 효율 70%, 2시간 상한을 넘은 시간은 쌓이지 않는다', () => {
    const start = base({ fans: 100 });
    const online = streamTotal(advance(start, HOUR, ONLINE).state.streaming);
    const offline = streamTotal(advance(start, HOUR, OFFLINE).state.streaming);
    expect(offline / online).toBeCloseTo(BALANCE.offline.efficiency, 9);

    const r = settleOffline(start, T0 + 5 * HOUR);
    expect(streamTotal(r.state.streaming)).toBeCloseTo(100 * S.perFanPerSec * 2 * 3600 * BALANCE.offline.efficiency, 4);
    expect(makeReport(start, r).streams).toBeCloseTo(streamTotal(r.state.streaming), 9);
  });

  it('비정상적으로 긴 전진도 금방 끝나고 총량은 맞는다', () => {
    const st = base({ fans: 10 }).streaming;
    const ms = 2e10; // 구간 상한(20,000구간 × 10분)을 넘는 길이
    const t0 = Date.now();
    const out = accrueStreams(st, 10, T0, T0 + ms, 1);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(streamTotal(out)).toBeCloseTo(10 * S.perFanPerSec * (ms / 1000), -2);
  });
});

describe('스트리밍: 플랫폼 무작위 분배', () => {
  it('구간마다 비율의 합은 1이고 같은 씨앗·구간이면 항상 같다', () => {
    const a = platformShares(123, 456);
    expect(a).toHaveLength(STREAM_PLATFORMS.length);
    expect(a.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
    for (const v of a) expect(v).toBeGreaterThan(0);
    expect(platformShares(123, 456)).toEqual(a);
  });

  it('씨앗이 다르거나 구간이 바뀌면 분배도 달라진다', () => {
    expect(platformShares(1, 100)).not.toEqual(platformShares(2, 100));
    expect(platformShares(1, 100)).not.toEqual(platformShares(1, 101));
    expect(streamSeedFrom(T0)).not.toBe(streamSeedFrom(T0 + 1000));
    expect(streamSeedFrom(T0)).toBe(streamSeedFrom(T0));
  });

  it('구간마다는 크게 쏠리기도 하지만, 오래 쌓이면 평균은 25%에 가까워진다', () => {
    const sums = [0, 0, 0, 0];
    let maxShare = 0;
    let minShare = 1;
    const N = 3000;
    for (let b = 0; b < N; b++) {
      platformShares(777, b).forEach((v, i) => {
        sums[i] += v;
        maxShare = Math.max(maxShare, v);
        minShare = Math.min(minShare, v);
      });
    }
    for (const x of sums) expect(x / N).toBeGreaterThan(0.23);
    for (const x of sums) expect(x / N).toBeLessThan(0.27);
    expect(maxShare).toBeGreaterThan(0.6);
    expect(minShare).toBeLessThan(0.02);
  });

  it('zeroTotals는 네 플랫폼 이름을 그대로 가진다', () => {
    expect(Object.keys(zeroTotals()).sort()).toEqual([...STREAM_PLATFORMS].sort());
    expect([...STREAM_PLATFORMS]).toEqual(['spotify', 'ytmusic', 'melon', 'applemusic']);
  });
});

describe('스트리밍: 정산', () => {
  it('정산 간격(1시간)이 지나기 전에는 정산할 수 없고 상태도 그대로다', () => {
    const s = advance(base({ fans: 100 }), min(30)).state;
    const r = claimStreaming(s);
    expect(r).toMatchObject({ ok: false, reason: 'streaming_wait' });
    expect(r.state).toBe(s);
    expect(streamClaimStatus(s).waitMs).toBe(min(30));
    expect(streamClaimStatus(s).ready).toBe(false);
  });

  it('1시간 뒤: streamsPerCoin 스트리밍당 1코인으로 정산되고, 간격이 다시 시작된다', () => {
    const s = advance(base({ fans: 100 }), HOUR).state;
    const pending = 100 * S.perFanPerSec * 3600;
    expect(streamsPending(s.streaming)).toBeCloseTo(pending, 4);
    const r = claimStreaming(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coins).toBe(Math.floor(pending / S.streamsPerCoin));
    expect(r.state.coins).toBe(s.coins + r.coins);
    expect(r.state.streaming.settled).toBe(r.coins * S.streamsPerCoin);
    expect(r.state.streaming.lastClaimAt).toBe(s.lastSettledAt);
    // 기록(누적)은 줄지 않는다
    expect(r.state.streaming.totals).toEqual(s.streaming.totals);
    // 바로 한 번 더 누르면 간격이 안 지났다
    expect(claimStreaming(r.state)).toMatchObject({ ok: false, reason: 'streaming_wait' });
    // 다음 1시간이 지나면 새로 쌓인 만큼만 정산된다
    const next = advance(r.state, HOUR).state;
    const r2 = claimStreaming(next);
    expect(r2.ok && r2.coins).toBe(Math.floor(streamClaimStatus(next).pending / S.streamsPerCoin));
    expect(streamClaimStatus(next).pending).toBeLessThan(pending + S.streamsPerCoin);
  });

  it('환산 비율로 나누고 남은 스트리밍은 다음 정산으로 넘어간다', () => {
    const per = S.streamsPerCoin;
    // 합계 = 3 × per + 1 → 3코인을 받고 1스트리밍이 남는다
    const s = base({
      streaming: {
        totals: { spotify: 2 * per, ytmusic: per / 2, melon: per / 2, applemusic: 1 },
        settled: 0,
        lastClaimAt: T0 - HOUR,
        seed: 1,
      },
    });
    expect(streamClaimStatus(s)).toMatchObject({ coins: 3, waitMs: 0, ready: true });
    const r = claimStreaming(s);
    expect(r.ok && r.coins).toBe(3);
    expect(r.ok && r.streams).toBe(3 * per);
    expect(r.ok && streamsPending(r.state.streaming)).toBeCloseTo(1, 9);
  });

  it('받을 코인이 없으면 실패하고 정산 시각은 바뀌지 않는다', () => {
    const s = base({ streaming: { ...base().streaming, lastClaimAt: T0 - HOUR } });
    const r = claimStreaming(s);
    expect(r).toMatchObject({ ok: false, reason: 'nothing_to_claim' });
    expect(r.state.streaming.lastClaimAt).toBe(T0 - HOUR);
    // 1코인 몫(streamsPerCoin)에 하나 모자라면 아직 정산할 코인이 없다
    const short = base({
      streaming: { totals: { ...zeroTotals(), melon: S.streamsPerCoin - 1 }, settled: 0, lastClaimAt: T0 - HOUR, seed: 1 },
    });
    expect(claimStreaming(short)).toMatchObject({ ok: false, reason: 'nothing_to_claim' });
  });

  it('기기 시계가 거꾸로 가도 정산 간격이 1시간보다 길어지지 않는다', () => {
    const s = base({
      lastSettledAt: T0 + 1000,
      streaming: { ...base().streaming, lastClaimAt: T0 + 9 * HOUR },
    });
    const r = settleOnline(s, T0);
    expect(r.state.streaming.lastClaimAt).toBe(T0);
    expect(streamClaimStatus(r.state).waitMs).toBe(HOUR);
  });

  it('정산해도 팬·다른 재화는 건드리지 않는다', () => {
    const s = advance(base({ fans: 40, coins: 5 }), HOUR).state;
    const r = claimStreaming(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.fans).toBe(40);
    expect(r.state.diamonds).toBe(s.diamonds);
    expect(r.state.normalRhymes).toBe(s.normalRhymes);
  });
});
