/*
 * 가사 빈칸 속도전 화면 상태(순수). 서버 메시지를 하나씩 받아 화면에 보일 모습(view)으로 바꾼다.
 * 시각은 서버 시계가 아니라 메시지를 받은 이 기기의 시각(at, performance.now() ms)에 서버가 알려 준 남은 시간을 더해 센다.
 */
import type { BoardRow, EndRow, PlayerRow, ServerMsg } from '../../../../realtime/src/protocol';

export interface Solved {
  uid: string;
  name: string;
  gain: number;
  place: number;
}

export type LyricView =
  | { k: 'wait' }
  | { k: 'lobby'; players: PlayerRow[]; startsAt: number; solo: boolean }
  | { k: 'question'; round: number; rounds: number; before: string; after: string; len: number; endsAt: number; totalMs: number; hint: string | null; solved: Solved[]; me: { ok: boolean; gain: number } | null; wrong: number }
  | { k: 'reveal'; round: number; rounds: number; line: string; answer: string; board: BoardRow[]; nextAt: number }
  | { k: 'end'; rows: EndRow[]; rewarded: boolean };

export interface LyricState {
  view: LyricView;
  myUid: string | null;
  /** 보상 우편이 나간 결과(아직 안 왔으면 null) */
  reward: { diamonds: number; capped: boolean } | null;
  /** 서버가 거절한 이유(없으면 null) */
  error: string | null;
}

export const initialLyric: LyricState = { view: { k: 'wait' }, myUid: null, reward: null, error: null };

const ERR_TEXT: Record<string, string> = { busy: '이미 게임 중이에요.', full: '지금은 들어갈 자리가 없어요. 잠시 뒤에 다시 해 주세요.', rate: '너무 빨라요. 잠깐만요!', bad: '' };

export function lyricReduce(s: LyricState, m: ServerMsg, at: number): LyricState {
  const v = s.view;
  switch (m.t) {
    case 'hello':
      return { ...s, myUid: m.uid };
    case 'l.lobby':
      return { ...s, error: null, reward: null, view: { k: 'lobby', players: m.players, startsAt: at + m.startsInMs, solo: m.solo } };
    case 'l.q':
      return { ...s, error: null, view: { k: 'question', round: m.round, rounds: m.rounds, before: m.before, after: m.after, len: m.len, endsAt: at + m.endsInMs, totalMs: m.endsInMs, hint: null, solved: [], me: null, wrong: 0 } };
    case 'l.hint':
      return v.k === 'question' ? { ...s, view: { ...v, hint: m.first } } : s;
    case 'l.ok':
      return v.k === 'question' ? { ...s, view: { ...v, solved: [...v.solved, { uid: m.uid, name: m.name, gain: m.gain, place: m.place }] } } : s;
    case 'l.me':
      if (v.k !== 'question') return s;
      return { ...s, view: m.ok ? { ...v, me: { ok: true, gain: m.gain } } : { ...v, wrong: v.wrong + 1 } };
    case 'l.reveal': {
      const round = v.k === 'question' ? v.round : 0;
      const rounds = v.k === 'question' ? v.rounds : 0;
      return { ...s, view: { k: 'reveal', round, rounds, line: m.line, answer: m.answer, board: m.board, nextAt: at + m.nextInMs } };
    }
    case 'l.end':
      return { ...s, view: { k: 'end', rows: m.rows, rewarded: m.rewarded } };
    case 'reward':
      return { ...s, reward: { diamonds: m.diamonds, capped: m.capped } };
    case 'left':
      return { ...s, view: { k: 'wait' } };
    case 'err':
      return { ...s, error: ERR_TEXT[m.code] || s.error };
    default:
      return s;
  }
}
