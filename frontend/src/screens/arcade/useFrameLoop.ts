import { useEffect, useRef } from 'react';
import { MinigameClock } from '../../game/minigame';

/**
 * 아케이드 게임 화면의 프레임 루프. 미니게임 시계로 시간을 읽어(탭을 숨기면 멈추고 한 프레임에 250ms까지만 흐른다) 프레임마다 흐른 ms를 알려 준다.
 * runId가 바뀌면 루프를 새로 시작한다. onFrame은 매 렌더마다 바뀌어도 된다(최신 것을 부른다).
 */
export function useFrameLoop(runId: string, onFrame: (dtMs: number, nowPerf: number) => void): void {
  const cb = useRef(onFrame);
  useEffect(() => {
    cb.current = onFrame;
  });
  useEffect(() => {
    const clock = new MinigameClock();
    clock.start(performance.now());
    let last = 0;
    let raf = 0;
    const loop = (nowPerf: number) => {
      raf = requestAnimationFrame(loop);
      const t = clock.read(nowPerf);
      const dt = t - last;
      last = t;
      cb.current(dt, nowPerf);
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => (document.hidden ? clock.pause(performance.now()) : clock.resume(performance.now()));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [runId]);
}

/** 캔버스 위 포인터 위치를 게임 좌표(0~w, 0~h)로 바꾼다. */
export function toField(e: { clientX: number; clientY: number; currentTarget: Element }, w: number, h: number): { x: number; y: number } {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * w, y: ((e.clientY - r.top) / Math.max(1, r.height)) * h };
}
