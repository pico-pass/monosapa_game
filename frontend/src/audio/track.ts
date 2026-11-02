import { ASSETS } from '../assets';
import type { ChartAudio } from '../game/rhythm';

/*
 * 음원 곡 재생(리듬 모드). 음원은 AudioBuffer로 디코딩해서 AudioContext 시계로 샘플 정확도로 시작하고,
 * 판정 시계도 이 시계를 따라간다. 그래서 프레임이 밀리거나 탭이 잠깐 멈춰도 노트와 소리가 어긋나지 않는다.
 * 스피커로 나가는 소리의 지연은 ctx.getOutputTimestamp()로 반영한다(블루투스처럼 지연이 큰 기기도 맞는다).
 * 모든 호출은 실패해도 게임을 멈추지 않는다: 불러오지 못하면 호출한 쪽이 소리 없는 시계로 이어 간다.
 */

const SAMPLE_RATE = 44_100;
/** 인코더 정보(LAME 태그)를 따라 앞뒤 패딩을 자른 디코드 길이(44.1kHz 샘플 수) = 프레임 수 × 1152 − 2210 */
const TRACK_SAMPLES: Record<string, number> = { 'dark-love': 6_331_486 };
export const expectedSamples = (trackId: string): number | undefined => TRACK_SAMPLES[trackId];

/** 끝 패딩(576) + 디코더 지연(529): 끝만 안 자르는 디코더도 이만큼은 길다 */
const END_PAD_SAMPLES = 1105;
const GAIN = 0.85;
/** 시작 신호를 이만큼 앞에서 예약한다(초) */
const SCHEDULE_AHEAD = 0.15;

export interface LoadedTrack {
  buffer: AudioBuffer;
  /** 디코더가 앞 패딩을 자르지 않았을 때 버릴 앞부분(초). 잘라 주는 디코더(대부분)는 0 */
  leadSec: number;
}

/**
 * 디코더마다 MP3의 앞 지연(1105샘플 ≈ 25ms)을 자르는 방식이 달라서, 디코드된 길이로 앞부분이 안 잘렸는지 알아낸다.
 *  앞뒤 모두 자름 → 기준 길이 · 앞만 자름 → +1105 · 아무것도 안 자름 → +2210(정보 프레임까지 소리로 읽으면 +1152 더)
 *  앞이 남은 만큼 = 길이 − 기준 − 1105 (0 아래는 0)
 */
export function leadingSamples(trackId: string, length: number, sampleRate: number): number {
  const ref = TRACK_SAMPLES[trackId];
  if (!ref || !(sampleRate > 0)) return 0;
  const extra = Math.round((length * SAMPLE_RATE) / sampleRate - ref - END_PAD_SAMPLES);
  return extra >= 300 ? extra : 0;
}

/** 음원 파일을 받아 디코딩한다. 실패하면 null. */
export async function loadTrack(ctx: AudioContext, trackId: string): Promise<LoadedTrack | null> {
  const url = ASSETS.tracks[trackId];
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    return { buffer, leadSec: leadingSamples(trackId, buffer.length, buffer.sampleRate) / SAMPLE_RATE };
  } catch {
    return null;
  }
}

/** 지금 스피커에서 나오고 있는 음원 시각(초). 출력 지연을 반영한다. */
export function audibleTime(ctx: AudioContext, nowPerf: number): number {
  try {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.contextTime + (nowPerf - ts.performanceTime) / 1000;
    }
  } catch {
    /* 아래 근사값을 쓴다 */
  }
  return ctx.currentTime - (ctx.baseLatency || 0) - (ctx.outputLatency || 0);
}

/** MinigameClock과 같은 모양의 시계. 게임 시각 0 = 시작을 예약한 AudioContext 시각이다. */
export class TrackClock {
  private startCtx = 0;
  private last = 0;
  private paused = false;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly track: LoadedTrack,
    private readonly audio: ChartAudio,
  ) {}

  /** 게임 시각 0을 정하고, 음원을 audio.startMs 시각에 시작하도록 예약한다. */
  start(nowPerf: number): void {
    void nowPerf;
    const { ctx, audio } = this;
    this.startCtx = ctx.currentTime + SCHEDULE_AHEAD;
    this.last = -SCHEDULE_AHEAD * 1000;
    this.paused = false;
    try {
      const when = this.startCtx + audio.startMs / 1000;
      const end = when + audio.playMs / 1000;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = this.track.buffer;
      gain.gain.setValueAtTime(GAIN, when);
      gain.gain.setValueAtTime(GAIN, end - audio.fadeMs / 1000);
      gain.gain.linearRampToValueAtTime(0, end);
      source.connect(gain).connect(ctx.destination);
      source.start(when, this.track.leadSec, audio.playMs / 1000 + 0.05);
      this.source = source;
      this.gain = gain;
    } catch {
      /* 소리 없이 시계만 흐른다 */
    }
  }

  /** 현재 게임 시각(ms). 소리가 나가는 시각 기준이고 거꾸로 가지 않는다. */
  read(nowPerf: number): number {
    if (this.paused || this.ctx.state !== 'running') return this.last;
    const t = (audibleTime(this.ctx, nowPerf) - this.startCtx) * 1000;
    if (t > this.last) this.last = t;
    return this.last;
  }

  pause(nowPerf: number): void {
    this.read(nowPerf);
    this.paused = true;
    void this.ctx.suspend().catch(() => undefined);
  }

  resume(nowPerf: number): void {
    void nowPerf;
    if (!this.paused) return;
    this.paused = false;
    void this.ctx.resume().catch(() => undefined);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** 재생을 멈추고 정리한다. 일시정지로 멈춘 컨텍스트는 다시 켠다. */
  stop(): void {
    try {
      this.source?.stop();
      this.source?.disconnect();
      this.gain?.disconnect();
    } catch {
      /* 이미 끝났다 */
    }
    this.source = null;
    this.gain = null;
    if (this.paused || this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    this.paused = false;
  }
}
