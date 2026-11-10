/* 팬덤 모으기 화면 상태(순수): 서버 메시지를 하나씩 받아 HUD와 단계(들어가는 중·플레이·결과)를 정한다. 그림용 스냅샷은 따로 둔다. */
import type { FandomRosterRow, ServerMsg } from '../../../../realtime/src/protocol';

export interface FandomOver {
  why: 'dead' | 'time' | 'left';
  fans: number;
  peak: number;
  kills: number;
  by: string | null;
  reward: number;
}

export interface FandomState {
  phase: 'wait' | 'play' | 'over';
  myId: number;
  w: number;
  h: number;
  names: Record<number, string>;
  hud: { fans: number; rank: number; alive: number; leftMs: number; lb: [number, number][]; boost: boolean };
  over: FandomOver | null;
  /** 보상 우편이 나간 결과(아직 안 왔으면 null) */
  reward: { diamonds: number; capped: boolean } | null;
  error: string | null;
}

export const initialFandom: FandomState = {
  phase: 'wait',
  myId: 0,
  w: 120,
  h: 120,
  names: {},
  hud: { fans: 0, rank: 1, alive: 1, leftMs: 0, lb: [], boost: false },
  over: null,
  reward: null,
  error: null,
};

const ERR_TEXT: Record<string, string> = { busy: '이미 게임 중이에요.', full: '지금은 들어갈 자리가 없어요. 잠시 뒤에 다시 해 주세요.' };

const namesOf = (list: FandomRosterRow[]): Record<number, string> => Object.fromEntries(list.map((r) => [r.id, r.name]));

export function fandomReduce(s: FandomState, m: ServerMsg): FandomState {
  switch (m.t) {
    case 'f.go':
      return { ...s, phase: 'play', myId: m.id, w: m.w, h: m.h, over: null, reward: null, error: null, hud: { ...initialFandom.hud, leftMs: m.runMs } };
    case 'f.roster':
      return { ...s, names: namesOf(m.list) };
    case 'f.s':
      return s.phase === 'over' ? s : { ...s, phase: 'play', hud: { fans: m.me.fans, rank: m.rk[0], alive: m.rk[1], leftMs: m.left, lb: m.lb, boost: m.me.boost === 1 } };
    case 'f.over':
      return { ...s, phase: 'over', over: { why: m.why, fans: m.fans, peak: m.peak, kills: m.kills, by: m.by, reward: m.reward } };
    case 'reward':
      return { ...s, reward: { diamonds: m.diamonds, capped: m.capped } };
    case 'left':
      return { ...s, phase: 'wait' };
    case 'err':
      return ERR_TEXT[m.code] ? { ...s, error: ERR_TEXT[m.code] } : s;
    default:
      return s;
  }
}
