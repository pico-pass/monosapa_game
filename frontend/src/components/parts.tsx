import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { BALANCE } from '../game/balance';
import { PERSONA_TEXT } from '../game/content';
import type { Persona } from '../game/types';
import { doWork } from '../store/gameStore';

export function PersonaBadge({ persona }: { persona: Persona }) {
  return <span className={`badge badge-${persona}`}>{PERSONA_TEXT[persona].short}</span>;
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function heatHint(heat: number, persona: Persona): string {
  if (persona === 'dark') {
    return heat >= BALANCE.persona.hotThreshold ? '고속 구간 · 100이면 마이크 압수' : '어둠속성에서는 올라가요';
  }
  if (heat <= 0) return '안정';
  return heat >= BALANCE.persona.hotThreshold ? '식는 중 · 어둠 복귀는 80 이하' : '일반속성에서 식어요';
}

/** 과열 게이지: 60(재진입 기준)·80(고속 구간) 눈금 표시. 80 이상에서는 색이 바뀌고 테두리 경고가 켜진다. */
export function HeatGauge({ heat, persona }: { heat: number; persona: Persona }) {
  const hot = heat >= BALANCE.persona.hotThreshold;
  return (
    <div className={`heat ${hot ? 'heat-hot' : ''}`}>
      <div className="heat-label">
        <span>과열 G</span>
        <strong>{Math.floor(heat)}</strong>
        <span className="heat-hint">{heatHint(heat, persona)}</span>
      </div>
      <div className="heat-track" role="progressbar" aria-label="과열" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(heat)}>
        <div className="heat-fill" style={{ width: `${heat}%` }} />
        <i className="heat-tick" style={{ left: '60%' }} />
        <i className="heat-tick" style={{ left: '80%' }} />
      </div>
    </div>
  );
}

/**
 * 작업하기 입력: 포인터·키보드를 모두 받지만 같은 doWork()(상한 공통)로 들어간다.
 * 누르고 있으면 초당 holdPerSec회 반복하고, 누르는 순간 1회는 즉시 인정한다. onClick은 쓰지 않아 중복 지급이 없다.
 */
export function WorkPad({ persona, disabled }: { persona: Persona; disabled?: boolean }) {
  const sources = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  const stopAll = () => {
    sources.current.clear();
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };
  const start = (src: string) => {
    if (disabled || sources.current.has(src)) return;
    sources.current.add(src);
    doWork();
    if (timer.current === null) {
      timer.current = window.setInterval(doWork, 1000 / BALANCE.click.holdPerSec);
    }
  };
  const stop = (src: string) => {
    sources.current.delete(src);
    if (sources.current.size === 0 && timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    const onVis = () => document.hidden && stopAll();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', stopAll);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', stopAll);
      stopAll();
    };
  }, []);

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* 캡처 실패는 입력에 영향 없음 */
    }
    start(`ptr:${e.pointerId}`);
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => stop(`ptr:${e.pointerId}`);
  const keyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) start('key');
  };
  const keyUp = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      stop('key');
    }
  };

  return (
    <button
      type="button"
      className={`work-pad work-pad-${persona}`}
      aria-label="작업하기 (누르고 있으면 반복)"
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      onBlur={() => stop('key')}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="work-pad-icon" aria-hidden>
        {persona === 'normal' ? '✍️' : '🔥'}
      </span>
      <span className="work-pad-label">작업하기</span>
      <span className="work-pad-sub">탭 · 누르기 유지 · Space</span>
    </button>
  );
}
