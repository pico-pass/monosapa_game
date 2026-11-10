/*
 * 가사 빈칸 만들기(순수). 한 줄에서 이어진 한 구간을 서버가 골라 비우고, 플레이어가 친 답이 맞는지 가린다.
 * 같은 씨앗 난수면 같은 빈칸이 나온다.
 */

/** 빈칸으로 가릴 수 있는 글자 수의 상한(공백 제외). 폰에서 치기 어려운 긴 답을 피한다. */
export const BLANK_MAX = 12;

export interface Blank {
  /** 빈칸 앞의 글(띄어쓰기 포함) */
  before: string;
  /** 정답(가려진 부분 그대로) */
  answer: string;
  /** 빈칸 뒤의 글 */
  after: string;
  /** 빈칸 칸 수 = 정답의 글자 수(공백 제외) */
  len: number;
}

interface Token {
  s: number;
  e: number;
  n: number;
}

const countChars = (text: string): number => text.replace(/\s/g, '').length;

function build(text: string, a: number, b: number): Blank {
  const answer = text.slice(a, b);
  return { before: text.slice(0, a), answer, after: text.slice(b), len: countChars(answer) };
}

/**
 * 한 줄에서 빈칸을 고른다.
 * 단어가 둘 이상이면 한 단어(또는 이어진 두 단어)를 비우고, 줄 전체를 비우지는 않는다. 글자가 2자 미만인 구간은 피한다.
 * 한 단어뿐이거나 알맞은 구간이 없으면 가장 긴 단어의 뒤쪽 글자 일부를 비운다.
 */
export function makeBlank(line: string, rng: () => number): Blank {
  const text = line.trim().replace(/\s+/g, ' ');
  const tokens: Token[] = [...text.matchAll(/\S+/g)].map((m) => ({ s: m.index, e: m.index + m[0].length, n: m[0].length }));

  if (tokens.length >= 2) {
    const singles: [number, number][] = [];
    const pairs: [number, number][] = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i; j <= Math.min(i + 1, tokens.length - 1); j++) {
        if (j - i + 1 >= tokens.length) continue;
        const n = countChars(text.slice(tokens[i].s, tokens[j].e));
        if (n < 2 || n > BLANK_MAX) continue;
        (i === j ? singles : pairs).push([i, j]);
      }
    }
    const pool = pairs.length > 0 && (singles.length === 0 || rng() < 0.35) ? pairs : singles.length > 0 ? singles : pairs;
    if (pool.length > 0) {
      const [i, j] = pool[Math.floor(rng() * pool.length)];
      return build(text, tokens[i].s, tokens[j].e);
    }
  }

  if (tokens.length === 0) return { before: '', answer: '', after: '', len: 0 };
  const longest = tokens.reduce((best, t) => (t.n > best.n ? t : best), tokens[0]);
  const hide = longest.n < 3 ? 1 : Math.min(BLANK_MAX, Math.max(2, Math.round(longest.n * 0.5)));
  const lo = Math.min(1, longest.n - hide);
  const off = lo + Math.floor(rng() * (longest.n - hide - lo + 1));
  return build(text, longest.s + off, longest.s + off + hide);
}

/** 글자·숫자만 남기고 소문자로 맞춘다(띄어쓰기·기호·대소문자 차이는 같은 답으로 본다). */
export function normalizeAnswer(text: string): string {
  return [...text.normalize('NFC').toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('');
}

/** 친 글이 정답이다: 빈칸 부분이거나, 가사 한 줄 전체를 쳤을 때 */
export function isCorrect(blank: Blank, input: string): boolean {
  const typed = normalizeAnswer(input);
  if (typed.length === 0) return false;
  return typed === normalizeAnswer(blank.answer) || typed === normalizeAnswer(blank.before + blank.answer + blank.after);
}
