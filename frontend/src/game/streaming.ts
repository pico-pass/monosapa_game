import { BALANCE, STREAM_PLATFORMS } from './balance';
import { mulberry32 } from './runner';
import type { Streaming } from './types';

/*
 * 음원 플랫폼별 스트리밍. 팬 수에 비례해 쌓이고, 쌓인 양은 플랫폼에 무작위로 나뉜다.
 * 무작위는 씨앗과 "절대 시각 구간 번호"로만 정해지는 시드 난수다. 그래서 엔진은 순수 함수로 남고,
 * 한 번에 크게 전진하든 여러 번 나눠 전진하든(온라인 틱 vs 오프라인 정산) 같은 결과가 나온다.
 */

const S = BALANCE.streaming;

/** 구간 수 상한. 비정상적으로 긴 전진은 남은 양을 균등 분배해서 계산 시간을 묶어 둔다. */
const MAX_BUCKETS = 20_000;

export function zeroTotals(): Streaming['totals'] {
  return { spotify: 0, ytmusic: 0, melon: 0, applemusic: 0 };
}

/** 씨앗과 구간 번호를 섞어 32비트 정수로 만든다. */
export function mix(seed: number, bucket: number): number {
  let h = (seed ^ Math.imul(bucket | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 새 게임·예전 저장에 줄 씨앗. 시각에서 결정적으로 만들어서 테스트와 저장 복원이 흔들리지 않는다. */
export const streamSeedFrom = (n: number): number => mix((Math.floor(n) % 4294967296) >>> 0, 0x5eed);

/** 그 구간에서 각 플랫폼이 가져가는 비율(합 1). 지수분포를 정규화한 무작위 분배라 한쪽으로 크게 쏠리는 구간도 나온다. */
export function platformShares(seed: number, bucket: number): number[] {
  const rng = mulberry32(mix(seed, bucket));
  rng(); // 첫 값은 씨앗과 닮기 쉬워 버린다
  const w = STREAM_PLATFORMS.map(() => -Math.log(1 - rng() * 0.999999));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/**
 * fromMs~toMs 동안 쌓인 스트리밍을 플랫폼별 누적에 더한다. efficiency는 생산 효율(오프라인 0.7, 상한 뒤 0).
 * 쌓일 게 없으면 입력 객체를 그대로 돌려준다.
 */
export function accrueStreams(streaming: Streaming, fans: number, fromMs: number, toMs: number, efficiency: number): Streaming {
  const perSec = fans * S.perFanPerSec * efficiency;
  if (!(perSec > 0) || !(toMs > fromMs)) return streaming;
  const totals = { ...streaming.totals };
  let t = fromMs;
  for (let n = 0; t < toMs; n++) {
    if (n >= MAX_BUCKETS) {
      const each = (perSec * (toMs - t)) / 1000 / STREAM_PLATFORMS.length;
      for (const p of STREAM_PLATFORMS) totals[p] += each;
      break;
    }
    const bucket = Math.floor(t / S.shareBucketMs);
    const segEnd = Math.min(toMs, (bucket + 1) * S.shareBucketMs);
    const streams = (perSec * (segEnd - t)) / 1000;
    const shares = platformShares(streaming.seed, bucket);
    STREAM_PLATFORMS.forEach((p, i) => {
      totals[p] += streams * shares[i];
    });
    t = segEnd;
  }
  for (const p of STREAM_PLATFORMS) totals[p] = Math.min(totals[p], BALANCE.maxResource);
  return { ...streaming, totals };
}
