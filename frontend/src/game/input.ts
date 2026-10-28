import { BALANCE } from './balance';

/**
 * 작업하기 입력 상한. 터치·포인터·키보드 입력을 하나로 합쳐 초당 최대 maxPerSec회만 인정한다.
 * 시계는 호출자가 넘기는 단조 증가 ms(performance.now 등)다.
 */
export class InputLimiter {
  private accepted: number[] = [];

  constructor(
    private readonly max: number = BALANCE.click.maxPerSec,
    private readonly windowMs = 1000,
  ) {}

  accept(nowMs: number): boolean {
    this.accepted = this.accepted.filter((t) => nowMs - t < this.windowMs);
    if (this.accepted.length >= this.max) return false;
    this.accepted.push(nowMs);
    return true;
  }

  reset(): void {
    this.accepted = [];
  }
}
