import { audioContext, isSfxMuted } from './sfx';

/*
 * 내 목소리 샘플러: 마이크로 3초를 녹음해 패드(음높이 4단계)와 8스텝 비트로 쓴다.
 * 녹음은 이 기기 안에서만 처리·저장하고 밖으로 보내지 않는다. 규칙(자르기·정규화·패턴)은 순수 함수라 테스트한다.
 */

export const SAMPLE_MS = 3000;
/** 패드 4개의 재생 속도(음높이). 1이 원음 */
export const PAD_RATES: readonly number[] = [0.75, 1, 1.25, 1.5];
export const STEPS = 8;
export const BPM_RANGE = { min: 70, max: 160, default: 100 } as const;

export interface Sample {
  /** 모노 PCM(-1~1) */
  data: Float32Array;
  sampleRate: number;
}

/** 앞뒤의 조용한 부분을 자르고, 최대 길이로 줄이고, 가장 큰 소리가 peak가 되게 키운다. 거의 무음이면 null. */
export function processSample(pcm: Float32Array, sampleRate: number, maxMs = SAMPLE_MS, peak = 0.9): Float32Array | null {
  const threshold = 0.02;
  let start = 0;
  let end = pcm.length - 1;
  while (start < pcm.length && Math.abs(pcm[start]) < threshold) start++;
  while (end > start && Math.abs(pcm[end]) < threshold) end--;
  if (start >= end) return null;
  const maxLen = Math.floor((sampleRate * maxMs) / 1000);
  const trimmed = pcm.slice(start, Math.min(end + 1, start + maxLen));
  let max = 0;
  for (let i = 0; i < trimmed.length; i++) max = Math.max(max, Math.abs(trimmed[i]));
  if (max < threshold) return null;
  const gain = peak / max;
  for (let i = 0; i < trimmed.length; i++) trimmed[i] = Math.max(-1, Math.min(1, trimmed[i] * gain));
  return trimmed;
}

/** 패턴 표: pattern[패드][스텝] */
export type Pattern = boolean[][];
export const emptyPattern = (): Pattern => PAD_RATES.map(() => Array.from({ length: STEPS }, () => false));
export const defaultPattern = (): Pattern => {
  const p = emptyPattern();
  for (const s of [0, 4]) p[1][s] = true;
  for (const s of [2, 6]) p[2][s] = true;
  p[3][7] = true;
  return p;
};
export const stepSeconds = (bpm: number): number => 60 / Math.max(1, bpm) / 2;

let current: Sample | null = null;
let workSfx = false;

export const getSample = (): Sample | null => current;
export const setSample = (s: Sample | null): void => {
  current = s;
};
export const setWorkSfx = (on: boolean): void => {
  workSfx = on;
};
export const isWorkSfx = (): boolean => workSfx;

function bufferOf(ctx: AudioContext, s: Sample): AudioBuffer {
  const buf = ctx.createBuffer(1, s.data.length, s.sampleRate);
  buf.getChannelData(0).set(s.data);
  return buf;
}

/** 샘플을 rate 속도로 재생한다. when은 AudioContext 시각(초). 재생하면 true. */
export function playSample(rate = 1, gain = 0.8, when = 0): boolean {
  const ctx = audioContext();
  if (!ctx || !current || isSfxMuted() || ctx.state !== 'running') return false;
  try {
    const src = ctx.createBufferSource();
    src.buffer = bufferOf(ctx, current);
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ctx.destination);
    src.start(when > 0 ? when : 0);
    return true;
  } catch {
    return false;
  }
}

/** 작업하기 효과음으로 쓰기로 했고 샘플이 있으면 한 번 재생한다. 쓰였으면 true(합성음은 건너뛴다). */
export function playWorkSample(): boolean {
  return workSfx && current !== null && playSample(1, 0.6);
}

/** 8스텝 반복 재생. 켜 두면 다음 스텝을 100ms 앞서 예약해서 박자가 흔들리지 않는다. */
export class Looper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextAt = 0;
  private step = 0;

  get running(): boolean {
    return this.timer !== null;
  }

  start(bpm: () => number, pattern: () => Pattern, onStep: (step: number) => void): boolean {
    const ctx = audioContext();
    if (this.timer || !ctx || !current) return false;
    this.nextAt = ctx.currentTime + 0.05;
    this.step = 0;
    this.timer = setInterval(() => {
      while (this.nextAt < ctx.currentTime + 0.1) {
        const p = pattern();
        const step = this.step;
        PAD_RATES.forEach((rate, pad) => {
          if (p[pad]?.[step]) playSample(rate, 0.7, this.nextAt);
        });
        const delay = Math.max(0, (this.nextAt - ctx.currentTime) * 1000);
        setTimeout(() => onStep(step), delay);
        this.nextAt += stepSeconds(bpm());
        this.step = (this.step + 1) % STEPS;
      }
    }, 25);
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** 마이크로 ms 동안 녹음해서 샘플로 만든다. 권한이 없거나 브라우저가 지원하지 않으면 이유를 담아 던진다. */
export async function recordSample(ms = SAMPLE_MS, onStart?: () => void): Promise<Sample> {
  const ctx = audioContext();
  if (!ctx) throw new Error('먼저 화면을 한 번 눌러 소리를 켜 주세요.');
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('이 브라우저는 녹음을 지원하지 않아요.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('마이크 사용이 허용되지 않았어요. 브라우저 설정에서 허용해 주세요.');
  }
  try {
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.start();
    onStart?.();
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await stopped;
    const buf = await ctx.decodeAudioData(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
    const pcm = processSample(buf.getChannelData(0).slice(), buf.sampleRate);
    if (!pcm) throw new Error('소리가 거의 들리지 않았어요. 마이크에 가까이 대고 다시 해 보세요.');
    return { data: pcm, sampleRate: buf.sampleRate };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
