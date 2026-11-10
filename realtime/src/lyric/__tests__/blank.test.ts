import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../rng.js';
import { BLANK_MAX, isCorrect, makeBlank, normalizeAnswer } from '../blank.js';
import { LYRIC_LINES, cleanLines } from '../lines.js';

describe('가사 빈칸 만들기', () => {
  it('모든 가사 줄과 여러 씨앗에서 앞·정답·뒤를 이으면 원래 줄이 되고, 정답은 비어 있지 않다', () => {
    for (const line of cleanLines(LYRIC_LINES)) {
      for (let seed = 1; seed <= 60; seed++) {
        const b = makeBlank(line, mulberry32(seed));
        expect(b.before + b.answer + b.after).toBe(line);
        expect(b.answer.trim().length).toBeGreaterThan(0);
        expect(b.len).toBe(b.answer.replace(/\s/g, '').length);
        expect(b.len).toBeLessThanOrEqual(BLANK_MAX);
        expect(b.len).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('단어가 둘 이상이면 줄 전체를 비우지 않고 두 글자 이상을 비운다', () => {
    for (const line of cleanLines(LYRIC_LINES).filter((l) => l.includes(' '))) {
      for (let seed = 1; seed <= 60; seed++) {
        const b = makeBlank(line, mulberry32(seed));
        expect(b.before.length + b.after.length).toBeGreaterThan(0);
        expect(b.len).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('한 단어뿐인 줄은 앞 글자를 남기고 뒤쪽 글자 일부만 비운다', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const b = makeBlank('잘자베이비굿나잇', mulberry32(seed));
      expect(b.before.length).toBeGreaterThanOrEqual(1);
      expect(b.len).toBeGreaterThanOrEqual(2);
      expect(b.len).toBeLessThan('잘자베이비굿나잇'.length);
    }
  });

  it('같은 씨앗이면 같은 빈칸이고, 씨앗이 다르면 빈칸이 달라지기도 한다', () => {
    const line = '나는 매일 이런생각을 하루에 수십번도 넘게 하는데 왜 정신병이 안낫는걸까';
    expect(makeBlank(line, mulberry32(7))).toEqual(makeBlank(line, mulberry32(7)));
    const answers = new Set(Array.from({ length: 40 }, (_, i) => makeBlank(line, mulberry32(i + 1)).answer));
    expect(answers.size).toBeGreaterThan(3);
  });

  it('아주 짧거나 이상한 줄도 터지지 않는다', () => {
    expect(makeBlank('', mulberry32(1)).len).toBe(0);
    expect(makeBlank('   ', mulberry32(1)).len).toBe(0);
    expect(makeBlank('가', mulberry32(1)).answer).toBe('가');
    const b = makeBlank('어 아', mulberry32(1));
    expect(b.before + b.answer + b.after).toBe('어 아');
    expect(b.answer.length).toBeGreaterThan(0);
  });

  it('줄 앞뒤·연속 공백과 중복·빈 줄은 읽을 때 정리된다', () => {
    expect(cleanLines(['  가  나  ', '가 나', '', '   ', '다'])).toEqual(['가 나', '다']);
  });
});

describe('정답 판정', () => {
  const blank = { before: '니엄마와 ', answer: '커플로 자해흉터가', after: '있다', len: 9 };

  it('띄어쓰기·기호·대소문자 차이는 같은 답으로 본다', () => {
    expect(normalizeAnswer(' 커플로, 자해흉터가! ')).toBe('커플로자해흉터가');
    expect(isCorrect(blank, '커플로자해흉터가')).toBe(true);
    expect(isCorrect(blank, '커플로 자해 흉터가')).toBe(true);
    expect(isCorrect({ before: '', answer: 'Love You', after: '' , len: 7 }, 'love you')).toBe(true);
  });

  it('줄 전체를 쳐도 정답이고, 틀리거나 비면 오답이다', () => {
    expect(isCorrect(blank, '니엄마와 커플로 자해흉터가있다')).toBe(true);
    expect(isCorrect(blank, '자해흉터')).toBe(false);
    expect(isCorrect(blank, '')).toBe(false);
    expect(isCorrect(blank, '  ?!  ')).toBe(false);
  });
});
