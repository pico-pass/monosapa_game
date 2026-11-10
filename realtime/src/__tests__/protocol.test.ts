import { describe, expect, it } from 'vitest';
import { ANSWER_MAX, parseClientMsg } from '../protocol.js';

describe('클라이언트 메시지 읽기', () => {
  it('올바른 메시지를 읽는다', () => {
    expect(parseClientMsg('{"t":"join","game":"lyric"}')).toEqual({ t: 'join', game: 'lyric' });
    expect(parseClientMsg('{"t":"join","game":"fandom"}')).toEqual({ t: 'join', game: 'fandom' });
    expect(parseClientMsg('{"t":"leave"}')).toEqual({ t: 'leave' });
    expect(parseClientMsg('{"t":"ans","text":"정답"}')).toEqual({ t: 'ans', text: '정답' });
    expect(parseClientMsg('{"t":"steer","a":1.5}')).toEqual({ t: 'steer', a: 1.5, b: 0 });
    expect(parseClientMsg('{"t":"steer","a":-2,"b":1}')).toEqual({ t: 'steer', a: -2, b: 1 });
  });

  it('모양이 이상하면 null이다', () => {
    for (const raw of ['', 'x', '[]', 'null', '1', '{"t":"nope"}', '{"t":"join"}', '{"t":"join","game":"x"}', '{"t":"ans"}', '{"t":"ans","text":5}', '{"t":"steer","a":"1"}', '{"t":"steer","a":null}']) {
      expect(parseClientMsg(raw)).toBeNull();
    }
    expect(parseClientMsg(JSON.stringify({ t: 'ans', text: '가'.repeat(ANSWER_MAX + 1) }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'ans', text: '가'.repeat(ANSWER_MAX) }))).not.toBeNull();
  });
});
