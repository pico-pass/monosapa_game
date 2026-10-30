/*
 * 사용자가 쓴 글을 저장하기 전에 정리한다. 렌더링은 프런트가 텍스트로만 하므로 HTML 이스케이프는 필요 없고,
 * 줄을 속이는 제어문자·보이지 않는 문자·방향 제어 문자만 걷어낸다.
 */

/** 걷어낼 코드 포인트 범위(양끝 포함): 제어문자, 폭 없는 문자, 줄·문단 구분자와 방향 제어, 단어 결합자, BOM */
const STRIPPED: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];

const isStripped = (cp: number) => STRIPPED.some(([lo, hi]) => cp >= lo && cp <= hi);

/** 글자 수(코드 포인트 기준). 이모지 하나가 1로 센다. */
export const textLength = (s: string): number => [...s].length;

/** 한 줄 글: 걷어낼 문자(줄바꿈 포함)를 공백으로 바꾸고 공백을 하나로 줄인 뒤 앞뒤를 자른다. */
export function cleanLine(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return [...raw]
    .map((ch) => (isStripped(ch.codePointAt(0)!) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 여러 줄 글: 줄바꿈(\n, \r\n)은 살리고 나머지 걷어낼 문자는 지운다. 빈 줄은 하나까지만 둔다. */
export function cleanMultiline(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return [...raw.replace(/\r\n?/g, '\n')]
    .filter((ch) => ch === '\n' || !isStripped(ch.codePointAt(0)!))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
