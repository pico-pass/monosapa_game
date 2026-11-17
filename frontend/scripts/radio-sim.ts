/**
 * 라디오국 하루 수입 시뮬레이션. 실행: npm run sim:radio
 * 팬 수별로 곡 10개(일반 5·어둠 5)를 가진 계정에 편성표 몇 가지를 올려 보고, 하루(24칸, 변수 제외)가 주는 인세 분량(분)과 팬 증가율을 보여 준다.
 * 목표: 잘 짠 하루(자동 편성) ≈ 인세 46분 분량 + 팬 0.8% 안팎, 곡 하나를 되풀이한 하루 ≈ 21분 분량 안팎.
 * 인세에 곱해지는 값이라 팬 수가 달라도 분량은 같다(팬 수는 곡 카드 등급·게스트 보유에 따라 달라진다).
 * 인세 분량 = 그날 편성표가 주는 코인 ÷ 그 팬 수의 인세(초당). 「하루 인세」는 24시간 내내 방치했을 때의 인세 분량(1440분)이라 비교용이다.
 */
import { autoSlots, radioDay } from '../src/game/radio';
import { createInitialState } from '../src/game/persistence';
import type { GameState, RadioSlot, Single } from '../src/game/types';

const T0 = new Date(2026, 10, 4, 12, 0, 0).getTime();
const SINGLES: Single[] = Array.from({ length: 10 }, (_, i) => ({ id: `single-${i + 1}`, persona: i % 2 === 0 ? 'normal' : 'dark', title: `곡${i + 1}`, releasedAt: T0 }));

const slots = (f: (h: number) => RadioSlot): RadioSlot[] => Array.from({ length: 24 }, (_, h) => f(h));

function stateOf(fans: number, withGuests: boolean): GameState {
  const s = createInitialState(T0);
  const owned: Record<string, number> = withGuests ? { 'f-alfrado': 1, 'f-gangyusi': 1 } : {};
  return { ...s, fans, lastSettledAt: T0, singles: SINGLES, feat: { ...s.feat, owned } };
}

const FANS = [10_000, 100_000_000];
console.log('팬 수 | 편성표 | 인세 분량(분) | 팬 증가(%) | 평균 곡 배율');
for (const fans of FANS) {
  for (const withGuests of [false, true]) {
  const base = stateOf(fans, withGuests);
  console.log(`[팬 ${fans.toLocaleString('ko-KR')}명 · 게스트 래퍼 ${withGuests ? '2명(일반·레어)' : '없음'}]`);
  const rows: [string, RadioSlot[]][] = [
    ['전부 비움', slots(() => ({ k: 'off' }))],
    ['곡 하나 반복', slots(() => ({ k: 'song', id: 'single-1' }))],
    ['곡 4개 순환(자아 무시)', slots((h) => ({ k: 'song', id: `single-${(h % 4) + 1}` }))],
    ['곡 10개 순환 + 멘트 6번', slots((h) => (h % 4 === 3 ? { k: 'talk' } : { k: 'song', id: `single-${(h % 10) + 1}` }))],
    ['자동 편성', autoSlots(base)],
  ];
  for (const [name, sl] of rows) {
    const s: GameState = { ...base, radio: { ...base.radio, slots: sl } };
    const d = radioDay(s);
    const royalty = d.coinSecs > 0 ? d.coins / d.coinSecs : 0;
    const minutes = d.coinSecs / 60;
    const songs = d.hours.filter((x) => x.kind === 'song');
    const avgMult = songs.length ? songs.reduce((a, x) => a + x.mult, 0) / songs.length : 0;
    console.log(`${String(fans).padStart(11)} | ${name.padEnd(22)} | ${minutes.toFixed(1).padStart(6)}분 (${((minutes / 1440) * 100).toFixed(1)}%) | ${(d.fansPct * 100).toFixed(2).padStart(5)}% | ${avgMult.toFixed(2)}${royalty === 0 ? '' : ''}`);
  }
  const auto = autoSlots(base);
  {
    const kinds = auto.map((x) => (x.k === 'song' ? `${base.singles.find((y) => y.id === x.id)!.persona === 'dark' ? '어' : '일'}` : x.k === 'talk' ? '멘' : x.k === 'ad' ? '광' : x.k === 'guest' ? '게' : '·')).join('');
    console.log(`   자동 편성(0~23시): ${kinds}`);
  }
  console.log('');
  }
}
