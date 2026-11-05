import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 사용자별 도배 방지(서버 메모리). 서버를 다시 켜면 비워지지만 도배 방지에는 충분하다.
 * 연속 전송 간격, 1분당 최대 개수, 같은 말을 반복하는 간격을 본다.
 */
export class RateLimiter {
  private readonly recent = new Map<string, { at: number; text: string }[]>();

  constructor(
    private readonly minGapMs: number,
    private readonly maxPerMinute: number,
    private readonly repeatBlockMs: number,
  ) {}

  check(key: string, text: string, now = Date.now()): void {
    const list = (this.recent.get(key) ?? []).filter((x) => now - x.at < 60_000);
    const last = list[list.length - 1];
    const tooMany = () => new HttpException('너무 빨리 보내고 있어요. 잠시 뒤에 다시 보내 주세요.', HttpStatus.TOO_MANY_REQUESTS);
    if (last && now - last.at < this.minGapMs) throw tooMany();
    if (list.length >= this.maxPerMinute) throw tooMany();
    if (list.some((x) => x.text === text && now - x.at < this.repeatBlockMs)) {
      throw new HttpException('같은 말을 반복해서 보낼 수 없어요.', HttpStatus.TOO_MANY_REQUESTS);
    }
    list.push({ at: now, text });
    this.recent.set(key, list);
  }
}
