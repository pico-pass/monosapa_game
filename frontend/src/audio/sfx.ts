import { ASSETS } from '../assets';
import type { Persona } from '../game/types';
import type { Judgement } from '../game/minigame';

/*
 * 원곡 없이 Web Audio로 합성하는 짧은 효과음·비트. 모든 호출은 실패해도 게임을 멈추지 않는다.
 * 브라우저 정책상 AudioContext는 첫 사용자 입력 이후에만 만든다. (처음부터 자동 재생하지 않는다)
 * assets/index.ts에 파일 경로를 넣으면 합성 대신 그 파일을 재생한다.
 */

let ctx: AudioContext | null = null;
let muted = false;
const fileCache = new Map<string, HTMLAudioElement>();

export function setMuted(value: boolean): void {
  muted = value;
}

/** 샘플러처럼 같은 AudioContext를 써야 하는 곳을 위한 접근자. 첫 사용자 입력 전에는 null이다. */
export const audioContext = (): AudioContext | null => ctx;
export const isSfxMuted = (): boolean => muted;

/** 첫 사용자 입력에서 호출한다. */
export function unlockAudio(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

interface Tone {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  at?: number;
  slideTo?: number;
}

function play(tones: Tone[]): void {
  if (muted || !ctx || ctx.state !== 'running') return;
  try {
    const c = ctx;
    const t0 = c.currentTime;
    for (const t of tones) {
      const osc = c.createOscillator();
      const g = c.createGain();
      const start = t0 + (t.at ?? 0);
      osc.type = t.type ?? 'sine';
      osc.frequency.setValueAtTime(t.freq, start);
      if (t.slideTo) osc.frequency.exponentialRampToValueAtTime(t.slideTo, start + t.dur);
      const peak = t.gain ?? 0.08;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
      osc.connect(g).connect(c.destination);
      osc.start(start);
      osc.stop(start + t.dur + 0.02);
    }
  } catch {
    /* 효과음 오류는 무시 */
  }
}

function playFile(key: keyof typeof ASSETS.sfx): boolean {
  const url = ASSETS.sfx[key];
  if (!url || muted) return false;
  try {
    let el = fileCache.get(url);
    if (!el) {
      el = new Audio(url);
      fileCache.set(url, el);
    }
    el.currentTime = 0;
    void el.play().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export const sfx = {
  work(persona: Persona) {
    if (playFile('work')) return;
    play(persona === 'normal' ? [{ freq: 660, dur: 0.07, type: 'triangle' }] : [{ freq: 180, dur: 0.09, type: 'sawtooth', gain: 0.05 }]);
  },
  switch(persona: Persona) {
    if (playFile('switch')) return;
    play(
      persona === 'dark'
        ? [{ freq: 420, slideTo: 90, dur: 0.3, type: 'sawtooth', gain: 0.06 }]
        : [{ freq: 300, slideTo: 720, dur: 0.25, type: 'triangle' }],
    );
  },
  release() {
    if (playFile('release')) return;
    play([
      { freq: 523, dur: 0.12, type: 'triangle' },
      { freq: 659, dur: 0.12, at: 0.1, type: 'triangle' },
      { freq: 784, dur: 0.22, at: 0.2, type: 'triangle' },
    ]);
  },
  buy() {
    if (playFile('buy')) return;
    play([
      { freq: 880, dur: 0.06, type: 'square', gain: 0.04 },
      { freq: 1175, dur: 0.1, at: 0.07, type: 'square', gain: 0.04 },
    ]);
  },
  album() {
    if (playFile('album')) return;
    play([
      { freq: 392, dur: 0.15, type: 'triangle' },
      { freq: 523, dur: 0.15, at: 0.12, type: 'triangle' },
      { freq: 659, dur: 0.15, at: 0.24, type: 'triangle' },
      { freq: 1047, dur: 0.35, at: 0.36, type: 'triangle' },
    ]);
  },
  micSeized() {
    if (playFile('micSeized')) return;
    play([
      { freq: 600, slideTo: 80, dur: 0.5, type: 'sawtooth', gain: 0.07 },
      { freq: 90, dur: 0.25, at: 0.45, type: 'square', gain: 0.06 },
    ]);
  },
  unlock() {
    play([
      { freq: 660, dur: 0.1, type: 'triangle' },
      { freq: 990, dur: 0.25, at: 0.1, type: 'triangle' },
    ]);
  },
  fail() {
    play([{ freq: 200, slideTo: 140, dur: 0.18, type: 'square', gain: 0.04 }]);
  },
  /** 가챠: 높은 등급일수록 화려하다 */
  pull(rare: boolean) {
    if (rare)
      play([
        { freq: 523, dur: 0.12, type: 'triangle' },
        { freq: 659, dur: 0.12, at: 0.1, type: 'triangle' },
        { freq: 784, dur: 0.12, at: 0.2, type: 'triangle' },
        { freq: 1047, dur: 0.12, at: 0.3, type: 'triangle' },
        { freq: 1568, dur: 0.4, at: 0.4, type: 'triangle', gain: 0.1 },
      ]);
    else play([{ freq: 740, dur: 0.1, type: 'triangle', gain: 0.06 }, { freq: 988, dur: 0.12, at: 0.08, type: 'triangle', gain: 0.05 }]);
  },
  /** 마스코트를 쓰다듬는 소리 */
  mascot() {
    play([{ freq: 880, slideTo: 1320, dur: 0.1, type: 'sine', gain: 0.06 }, { freq: 1175, slideTo: 1568, dur: 0.1, at: 0.09, type: 'sine', gain: 0.05 }]);
  },
  /** 리듬게임 레인 탭 */
  tap(lane: number) {
    play([{ freq: [523, 587, 659, 784][lane % 4], dur: 0.05, type: 'square', gain: 0.03 }]);
  },
  beat(strong: boolean) {
    play([
      strong
        ? { freq: 110, slideTo: 50, dur: 0.14, type: 'sine', gain: 0.16 }
        : { freq: 2400, dur: 0.03, type: 'square', gain: 0.012 },
    ]);
  },
  target() {
    play([{ freq: 880, dur: 0.05, type: 'sine', gain: 0.05 }]);
  },
  judge(j: Judgement) {
    if (j === 'perfect') play([{ freq: 1175, dur: 0.12, type: 'triangle', gain: 0.1 }, { freq: 1568, dur: 0.14, at: 0.05, type: 'triangle', gain: 0.08 }]);
    else if (j === 'good') play([{ freq: 880, dur: 0.1, type: 'triangle', gain: 0.08 }]);
    else play([{ freq: 150, dur: 0.12, type: 'square', gain: 0.04 }]);
  },
  jump(second: boolean) {
    play([{ freq: second ? 620 : 440, slideTo: second ? 980 : 760, dur: 0.12, type: 'triangle', gain: 0.07 }]);
  },
  jelly() {
    play([{ freq: 1320, dur: 0.05, type: 'sine', gain: 0.05 }, { freq: 1760, dur: 0.07, at: 0.04, type: 'sine', gain: 0.04 }]);
  },
  hit() {
    play([{ freq: 220, slideTo: 70, dur: 0.22, type: 'sawtooth', gain: 0.09 }]);
  },
  finish(cleared: boolean) {
    if (cleared)
      play([
        { freq: 523, dur: 0.15, type: 'triangle' },
        { freq: 659, dur: 0.15, at: 0.15, type: 'triangle' },
        { freq: 784, dur: 0.15, at: 0.3, type: 'triangle' },
        { freq: 1047, dur: 0.4, at: 0.45, type: 'triangle' },
      ]);
    else play([{ freq: 330, slideTo: 165, dur: 0.5, type: 'sawtooth', gain: 0.05 }]);
  },
};
