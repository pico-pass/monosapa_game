import { ASSETS } from '../assets';
import type { Persona } from '../game/types';

/*
 * 자아별 배경음악. 첫 사용자 입력 이후에만 재생하고, 자아가 바뀌면 서서히 교차 페이드한다.
 * 곡마다 재생 위치를 따로 유지해서 자아를 오가도 이어서 들린다. 탭이 숨겨지면 멈춘다.
 * 모든 호출은 실패해도 게임을 멈추지 않는다.
 */

const FULL_VOLUME = 0.45;
/** 직접 공연 중에는 박자 효과음이 묻히지 않도록 낮춘다. */
const DUCKED_VOLUME = 0.15;
const FADE_MS = 900;
const STEP_MS = 50;

interface BgmOptions {
  persona: Persona;
  /** 소리 전체 끔 */
  muted: boolean;
  /** 배경음악만 끔 */
  bgmMuted: boolean;
  ducked: boolean;
}

const tracks = new Map<Persona, HTMLAudioElement>();
let opts: BgmOptions = { persona: 'normal', muted: false, bgmMuted: false, ducked: false };
let unlocked = false;
let hidden = false;
let timer: ReturnType<typeof setInterval> | null = null;

function track(persona: Persona): HTMLAudioElement | null {
  const url = ASSETS.bgm[persona];
  if (!url) return null;
  let el = tracks.get(persona);
  if (!el) {
    try {
      el = new Audio(url);
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      tracks.set(persona, el);
    } catch {
      return null;
    }
  }
  return el;
}

function targetVolume(persona: Persona): number {
  if (!unlocked || hidden || opts.muted || opts.bgmMuted || persona !== opts.persona) return 0;
  return opts.ducked ? DUCKED_VOLUME : FULL_VOLUME;
}

function step(): boolean {
  let moving = false;
  const delta = (FULL_VOLUME * STEP_MS) / FADE_MS;
  for (const persona of ['normal', 'dark'] as const) {
    const want = targetVolume(persona);
    const el = want > 0 ? track(persona) : tracks.get(persona);
    if (!el) continue;
    try {
      if (want > 0 && el.paused) void el.play().catch(() => undefined);
      const cur = el.volume;
      if (Math.abs(cur - want) <= delta) el.volume = want;
      else el.volume = cur + Math.sign(want - cur) * delta;
      if (el.volume !== want) moving = true;
      else if (want === 0 && !el.paused) el.pause();
    } catch {
      /* 재생 오류는 무시 */
    }
  }
  return moving;
}

function sync(): void {
  if (timer) return;
  if (!step()) return;
  timer = setInterval(() => {
    if (!step() && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, STEP_MS);
}

export const bgm = {
  /** 첫 사용자 입력에서 호출한다. */
  unlock(): void {
    unlocked = true;
    sync();
  },
  configure(next: BgmOptions): void {
    opts = next;
    sync();
  },
  setHidden(value: boolean): void {
    hidden = value;
    if (value) {
      for (const el of tracks.values()) {
        try {
          el.pause();
          el.volume = 0;
        } catch {
          /* 무시 */
        }
      }
    }
    sync();
  },
};
