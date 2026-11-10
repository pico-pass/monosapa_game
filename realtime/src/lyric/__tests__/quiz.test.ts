import { describe, expect, it } from 'vitest';
import type { EndRow, ServerMsg } from '../../protocol.js';
import { mulberry32 } from '../../rng.js';
import { LyricRoom, QUIZ } from '../quiz.js';

const LINES = ['하나 둘 셋 넷', '다섯 여섯 일곱 여덟', '아홉 열 열하나 열둘', '가나다 라마바 사아자', '차카 타파 하하하', '일이삼 사오육', '칠팔구 십십일', '이십 삼십 사십', '오십 육십 칠십'];

interface Log {
  to: { uid: string; msg: ServerMsg }[];
  all: ServerMsg[];
  finished: { rows: EndRow[]; rewarded: boolean }[];
}

function setup(lines = LINES, seed = 1) {
  const log: Log = { to: [], all: [], finished: [] };
  const room = new LyricRoom('r1', lines, mulberry32(seed), {
    to: (uid, msg) => log.to.push({ uid, msg }),
    all: (msg) => log.all.push(msg),
    finish: (rows, rewarded) => log.finished.push({ rows, rewarded }),
  });
  return { room, log };
}

/** 지금 문제의 정답을 로그에서 알아낸다(l.q 의 앞·뒤와 가사 줄을 맞춰 본다) */
function answerOf(log: Log, lines = LINES): string {
  const q = [...log.all].reverse().find((m) => m.t === 'l.q');
  if (!q || q.t !== 'l.q') throw new Error('문제가 없어요');
  const line = lines.find((l) => l.startsWith(q.before) && l.endsWith(q.after) && l.length > q.before.length + q.after.length);
  if (!line) throw new Error('줄을 못 찾았어요');
  return line.slice(q.before.length, line.length - q.after.length);
}

describe('가사 빈칸 속도전 방', () => {
  it('대기실: 들어오면 목록이 가고 정원이 차면 곧 시작하며, 시간이 되면 시작한다', () => {
    const { room, log } = setup();
    expect(room.join('a', 'A', 0)).toBe(true);
    const lobby = log.all.at(-1);
    expect(lobby).toMatchObject({ t: 'l.lobby', solo: true, startsInMs: QUIZ.lobbyMs });
    room.join('b', 'B', 1000);
    expect(log.all.at(-1)).toMatchObject({ t: 'l.lobby', solo: false });
    room.advance(QUIZ.lobbyMs - 1);
    expect(room.phase).toBe('lobby');
    room.advance(QUIZ.lobbyMs);
    expect(room.phase).toBe('question');
    expect(room.joinable).toBe(false);
    expect(room.join('c', 'C', QUIZ.lobbyMs)).toBe(false);
  });

  it('정원이 다 차면 대기 시간을 줄여 곧 시작한다', () => {
    const { room } = setup();
    for (let i = 0; i < QUIZ.capacity; i++) room.join(`u${i}`, `U${i}`, 100);
    expect(room.joinable).toBe(false);
    room.advance(100 + QUIZ.fullStartMs - 1);
    expect(room.phase).toBe('lobby');
    room.advance(100 + QUIZ.fullStartMs);
    expect(room.phase).toBe('question');
  });

  it('문제가 나오면 빈칸 정보가 가고, 맞히면 점수가 오르고 순서 보너스가 붙는다', () => {
    const { room, log } = setup();
    room.join('a', 'A', 0);
    room.join('b', 'B', 0);
    room.advance(QUIZ.lobbyMs);
    const q = log.all.find((m) => m.t === 'l.q');
    expect(q).toMatchObject({ t: 'l.q', round: 1, rounds: QUIZ.rounds, endsInMs: QUIZ.answerMs });
    const ans = answerOf(log);
    const t0 = QUIZ.lobbyMs;
    expect(room.answer('a', ans, t0)).toBe(true);
    expect(room.answer('b', ans, t0 + 10_000)).toBe(true);
    const oks = log.all.filter((m) => m.t === 'l.ok');
    expect(oks).toHaveLength(2);
    expect(oks[0]).toMatchObject({ uid: 'a', place: 1, gain: QUIZ.baseMax + QUIZ.orderBonus[0] });
    expect(oks[1]).toMatchObject({ uid: 'b', place: 2, gain: Math.round(QUIZ.baseMax - (QUIZ.baseMax - QUIZ.baseMin) * 0.5 + QUIZ.orderBonus[1]) });
    // 모두 맞혔으니 곧 공개로 넘어간다
    room.advance(t0 + 10_001);
    expect(room.phase).toBe('reveal');
    const rev = log.all.find((m) => m.t === 'l.reveal');
    expect(rev).toMatchObject({ t: 'l.reveal', nextInMs: QUIZ.revealMs });
    if (rev?.t === 'l.reveal') {
      expect(rev.board.map((r) => r.uid)).toEqual(['a', 'b']);
      expect(rev.answer).toBe(ans.trim());
    }
  });

  it('오답은 본인에게만 알리고 점수가 없으며, 같은 문제에서 두 번 점수를 받지 못한다', () => {
    const { room, log } = setup();
    room.join('a', 'A', 0);
    room.join('b', 'B', 0);
    room.advance(QUIZ.lobbyMs);
    const t0 = QUIZ.lobbyMs;
    expect(room.answer('a', '전혀 아닌 말', t0)).toBe(false);
    expect(log.to.at(-1)).toEqual({ uid: 'a', msg: { t: 'l.me', ok: false, gain: 0 } });
    expect(log.all.some((m) => m.t === 'l.ok')).toBe(false);
    const ans = answerOf(log);
    expect(room.answer('a', ans, t0 + 50)).toBe(false); // 너무 빨리 또 보냄
    expect(room.answer('a', ans, t0 + 500)).toBe(true);
    expect(room.answer('a', ans, t0 + 1000)).toBe(false); // 이미 맞힘
    expect(log.all.filter((m) => m.t === 'l.ok')).toHaveLength(1);
  });

  it('시간이 다 되면 공개로 넘어가고, 공개가 끝나면 다음 문제가 나온다. 힌트는 한 번만 간다', () => {
    const { room, log } = setup();
    room.join('a', 'A', 0);
    room.advance(QUIZ.lobbyMs);
    room.advance(QUIZ.lobbyMs + QUIZ.hintMs);
    room.advance(QUIZ.lobbyMs + QUIZ.hintMs + 100);
    expect(log.all.filter((m) => m.t === 'l.hint')).toHaveLength(1);
    room.advance(QUIZ.lobbyMs + QUIZ.answerMs);
    expect(room.phase).toBe('reveal');
    room.advance(QUIZ.lobbyMs + QUIZ.answerMs + QUIZ.revealMs);
    expect(room.phase).toBe('question');
    expect(log.all.filter((m) => m.t === 'l.q')).toHaveLength(2);
  });

  it('끝까지 하면 결과가 나가고 순위대로 보상이 정해지며, 시간이 지나면 닫힌다', () => {
    const { room, log } = setup();
    room.join('a', 'A', 0);
    room.join('b', 'B', 0);
    room.join('c', 'C', 0);
    let t = QUIZ.lobbyMs;
    room.advance(t);
    for (let r = 0; r < room.rounds; r++) {
      const ans = answerOf(log);
      room.answer('a', ans, t + 200); // a 는 항상 가장 빨리
      if (r % 2 === 0) room.answer('b', ans, t + 5000);
      room.advance(t + QUIZ.answerMs);
      t += QUIZ.answerMs;
      room.advance(t + QUIZ.revealMs);
      t += QUIZ.revealMs;
    }
    expect(room.phase).toBe('result');
    const end = log.finished[0];
    expect(end.rewarded).toBe(true);
    expect(end.rows.map((r) => [r.uid, r.rank, r.reward])).toEqual([
      ['a', 1, QUIZ.rewards[0]],
      ['b', 2, QUIZ.rewards[1]],
      ['c', 3, 0], // 한 문제도 못 맞히면 참가 보상도 없다
    ]);
    expect(log.all.at(-1)).toMatchObject({ t: 'l.end', rewarded: true });
    room.advance(t + QUIZ.resultMs);
    expect(room.phase).toBe('closed');
  });

  it('4위 이하는 한 문제라도 맞혔으면 참가 보상을 받는다', () => {
    const { room, log } = setup();
    const ids = ['a', 'b', 'c', 'd'];
    ids.forEach((u) => room.join(u, u.toUpperCase(), 0));
    let t = QUIZ.lobbyMs;
    room.advance(t);
    for (let r = 0; r < room.rounds; r++) {
      const ans = answerOf(log);
      ids.forEach((u, i) => room.answer(u, ans, t + 100 + i * 1000));
      room.advance(t + 6000);
      t += 6000 + QUIZ.revealMs;
      room.advance(t);
    }
    const rows = log.finished[0].rows;
    expect(rows.map((r) => r.reward)).toEqual([...QUIZ.rewards, QUIZ.participation]);
  });

  it('혼자 시작한 방은 보상이 나가지 않는다', () => {
    const { room, log } = setup();
    room.join('a', 'A', 0);
    let t = QUIZ.lobbyMs;
    room.advance(t);
    for (let r = 0; r < room.rounds; r++) {
      room.answer('a', answerOf(log), t + 100);
      room.advance(t + 200);
      t += 200 + QUIZ.revealMs;
      room.advance(t);
    }
    expect(room.phase).toBe('result');
    expect(log.finished[0].rewarded).toBe(false);
    expect(log.finished[0].rows[0].reward).toBe(0);
  });

  it('줄이 라운드 수보다 적으면 줄 수만큼만 한다. 줄이 겹치지 않는다', () => {
    const { room, log } = setup(['하나 둘 셋', '넷 다섯 여섯', '일곱 여덟 아홉']);
    expect(room.rounds).toBe(3);
    room.join('a', 'A', 0);
    room.join('b', 'B', 0);
    let t = QUIZ.lobbyMs;
    room.advance(t);
    const seen = new Set<string>();
    for (let r = 0; r < room.rounds; r++) {
      const q = [...log.all].reverse().find((m) => m.t === 'l.q');
      if (q?.t === 'l.q') seen.add(q.before + '|' + q.after);
      t += QUIZ.answerMs;
      room.advance(t);
      t += QUIZ.revealMs;
      room.advance(t);
    }
    expect(seen.size).toBe(3);
    expect(room.phase).toBe('result');
  });

  it('나간 사람은 결과에서 빠지고, 모두 나가면 방이 닫힌다', () => {
    const { room, log } = setup();
    room.join('a', 'A', 0);
    room.join('b', 'B', 0);
    room.leave('b', 500);
    expect(log.all.at(-1)).toMatchObject({ t: 'l.lobby', players: [{ uid: 'a', name: 'A' }] });
    room.advance(QUIZ.lobbyMs);
    room.leave('a', QUIZ.lobbyMs + 100);
    expect(room.phase).toBe('closed');
    const lone = setup();
    lone.room.join('x', 'X', 0);
    lone.room.leave('x', 10);
    expect(lone.room.phase).toBe('closed');
  });
});
