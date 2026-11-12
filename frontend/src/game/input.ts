import { BALANCE } from './balance';

/**
 * 작업하기 입력 상한. 터치·포인터·키보드 입력을 하나로 합쳐 평균 초당 최대 maxPerSec회만 인정한다.
 * 시계는 호출자가 넘기는 단조 증가 ms(performance.now 등)다.
 *
 * 인정한 입력마다 「다음에 받을 수 있는 시각」(tat)을 간격(windowMs / max)만큼 뒤로 민다. 그래서 아무리 빨리 연타해도
 * 인정되는 입력이 고르게 퍼진다(예전 「1초 창에 3회」 방식은 3번을 몰아서 받고 약 0.9초를 쉬어서 끊겨 보였다).
 * earlyMs 만큼 일찍 눌러도 받으므로, 상한에 가까운 속도로 누르는 사람이 손해를 덜 본다.
 * 장기 평균은 항상 max 회/초 이하이고, 쉬었다가 처음 누를 때만 한 번 더 받을 수 있다.
 */
export class InputLimiter {
  /** 다음 입력을 받을 수 있는 이론상 시각(이보다 earlyMs 이상 일찍 오면 거절) */
  private tat = Number.NEGATIVE_INFINITY;
  private readonly interval: number;

  constructor(
    max: number = BALANCE.click.maxPerSec,
    windowMs = 1000,
    private readonly earlyMs: number = BALANCE.click.earlyMs,
  ) {
    this.interval = windowMs / max;
  }

  accept(nowMs: number): boolean {
    if (nowMs < this.tat - this.earlyMs) return false;
    this.tat = Math.max(this.tat, nowMs) + this.interval;
    return true;
  }

  reset(): void {
    this.tat = Number.NEGATIVE_INFINITY;
  }
}
