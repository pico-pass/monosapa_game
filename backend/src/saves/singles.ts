/*
 * 싱글 발매 수 랭킹용 규칙(순수). 프런트 저장의 state.singles(Single[], 각 항목에 persona)에서 자아별 발매 수를 센다.
 */

/** 발매할 수 있는 싱글 수의 상한. 프런트 BALANCE.maxSingles 와 같다(고쳐진 저장이 랭킹을 차지하지 못하게 한다). 프런트 테스트가 이 값을 비교한다. */
export const MAX_SINGLES = 2000;

export type SinglesSide = 'normal' | 'dark';

export interface SingleCounts {
  normal: number;
  dark: number;
}

/** 저장된 state 에서 일반·어둠 싱글 발매 수를 센다. 목록이 아니거나 자아가 이상한 항목은 세지 않고, 앞에서부터 MAX_SINGLES 개까지만 본다. */
export function singleCountsOf(state: unknown): SingleCounts {
  const list = typeof state === 'object' && state !== null ? (state as { singles?: unknown }).singles : undefined;
  const counts: SingleCounts = { normal: 0, dark: 0 };
  if (!Array.isArray(list)) return counts;
  for (const s of list.slice(0, MAX_SINGLES)) {
    const persona = typeof s === 'object' && s !== null ? (s as { persona?: unknown }).persona : undefined;
    if (persona === 'normal' || persona === 'dark') counts[persona]++;
  }
  return counts;
}
