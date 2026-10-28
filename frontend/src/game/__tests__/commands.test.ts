import { describe, expect, it } from 'vitest';
import {
  abandonConcert,
  beginManualConcert,
  buyEquipment,
  buyMusicPower,
  finishManualConcert,
  releaseAlbum,
  manualConcertReward,
  releaseSingle,
  runAutoConcert,
  work,
} from '../commands';
import { BALANCE, BALANCE as B, STAGES } from '../balance';
import { createInitialState } from '../persistence';
import { advance } from '../simulation';
import { InputLimiter } from '../input';
import {
  albumCost,
  albumFans,
  clickGain,
  equipmentCost,
  musicPowerCost,
  previewEquipment,
  previewMusicPower,
  roomTier,
  previewSingle,
  previewAlbum,
  singleCoins,
  singleFans,
  singleNeed,
  stageDifficulty,
  stageStatus,
  isTourComplete,
} from '../selectors';
import { ALBUM_CATALOG, dialogueCount, DIALOGUE, SITUATIONS, pickLine } from '../content';
import type { GameState } from '../types';

const T0 = 1_700_000_000_000;
const base = (over: Partial<GameState> = {}): GameState => ({ ...createInitialState(T0), ...over });
const at = (s: GameState, ms: number): GameState => advance(s, ms, { efficiency: 0 }).state;

describe('싱글 발매', () => {
  it('공식: 필요라임·코인·팬', () => {
    // 지정 공식(일반·어둠 공통): 비용 ceil(130×3.3^n), 코인 floor(50×1.44^n), 팬 ceil(5×1.8^n)
    expect([0, 1, 2, 5].map((n) => singleNeed('normal', n))).toEqual([130, 429, 1416, 50877]);
    expect([0, 1, 5].map((n) => singleCoins('normal', n))).toEqual([50, 72, 309]);
    expect([0, 1, 2, 5].map((n) => singleFans('normal', n))).toEqual([5, 9, 17, 95]);
    for (const p of ['normal', 'dark'] as const) {
      const c = B.single[p];
      expect(singleNeed(p, 1)).toBe(Math.ceil(c.rhymeBase * c.rhymeGrowth));
      expect(singleCoins(p, 3)).toBe(Math.floor(c.coinBase * c.coinGrowth ** 3));
      expect(singleFans(p, 5)).toBe(Math.ceil(c.fanBase * c.fanGrowth ** 5));
    }
  });

  it('현재 자아의 라임만 소비하고 곡에 자아를 기록한다', () => {
    const s = base({ normalRhymes: 200, darkRhymes: 200, activePersona: 'dark' });
    const r = releaseSingle(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.darkRhymes).toBe(200 - singleNeed('dark', 0));
    expect(r.state.normalRhymes).toBe(200);
    expect(r.state.coins).toBe(singleCoins('dark', 0));
    expect(r.state.fans).toBe(singleFans('dark', 0));
    expect(r.state.singles[0]).toMatchObject({ persona: 'dark' });
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments.length).toBeLessThanOrEqual(2);
  });

  it('비용·효과는 자아별로 따로 센다: 일반을 여러 곡 냈어도 어둠 첫 싱글은 첫 곡 값', () => {
    let s = base({ normalRhymes: 1e9, darkRhymes: 1e9 });
    for (let i = 0; i < 5; i++) {
      const r = releaseSingle(s);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    const normalNext = previewSingle(s, 'normal');
    expect(normalNext.n).toBe(5);
    expect(normalNext.needRhymes).toBe(singleNeed('normal', 5));
    const darkFirst = previewSingle(s, 'dark');
    expect(darkFirst.n).toBe(0);
    expect(darkFirst.needRhymes).toBe(singleNeed('dark', 0));
    expect(darkFirst.coins).toBe(singleCoins('dark', 0));
    expect(darkFirst.fans).toBe(singleFans('dark', 0));
    // 어둠으로 발매하면 일반 쪽 비용은 그대로
    const dark = releaseSingle({ ...s, activePersona: 'dark' });
    expect(dark.ok && dark.state.darkRhymes).toBe(1e9 - singleNeed('dark', 0));
    expect(dark.ok && previewSingle(dark.state, 'normal').needRhymes).toBe(normalNext.needRhymes);
    expect(dark.ok && dark.single.id).toBe('single-6');
  });

  it('미리보기 제목과 실제 제목이 같다', () => {
    const s = base({ normalRhymes: singleNeed('normal', 0) });
    const preview = previewSingle(s);
    const r = releaseSingle(s);
    expect(r.ok && r.single.title).toBe(preview.title);
  });

  it('6) 재료 부족·연타 → 음수 없음, 중복 생성 없음', () => {
    let s = base({ normalRhymes: singleNeed('normal', 0) - 0.1 });
    const fail = releaseSingle(s);
    expect(fail.ok).toBe(false);
    expect(fail.state).toBe(s);
    s = { ...s, normalRhymes: singleNeed('normal', 0) };
    const first = releaseSingle(s);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // 같은 클릭의 중복 이벤트: 이미 소비된 상태로 다시 호출
    const second = releaseSingle(first.state);
    expect(second.ok).toBe(false);
    expect(first.state.singles).toHaveLength(1);
    expect(first.state.normalRhymes).toBeGreaterThanOrEqual(0);
  });

  it('같은 제목이 반복되면 번호가 붙고 ID는 제목과 분리된다', () => {
    let s = base({ normalRhymes: 1e15 });
    const titles = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = releaseSingle(s);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
      titles.add(r.single.title);
    }
    expect(titles.size).toBe(20);
    expect(new Set(s.singles.map((x) => x.id)).size).toBe(20);
  });
});

describe('장비', () => {
  it('비용 공식과 최대 레벨 20', () => {
    expect(equipmentCost('mic', 0)).toBe(50);
    expect(equipmentCost('studio', 0)).toBe(150);
    expect(equipmentCost('promotion', 0)).toBe(90);
    expect(equipmentCost('mic', 3)).toBe(Math.ceil(B.equipment.mic.base * B.equipment.mic.growth ** 3));
    expect(equipmentCost('studio', 2)).toBe(Math.ceil(B.equipment.studio.base * B.equipment.studio.growth ** 2));
  });

  it('코인 부족이면 실패, 충분하면 정확히 차감', () => {
    expect(buyEquipment(base({ coins: 49 }), 'mic').ok).toBe(false);
    const r = buyEquipment(base({ coins: 120 }), 'mic');
    expect(r.ok && r.state.coins).toBe(70);
    expect(r.ok && r.state.equipment.mic).toBe(1);
  });

  it('20레벨에서 더 못 산다', () => {
    const s = base({ coins: 1e12, equipment: { mic: 20, studio: 0, promotion: 0 } });
    expect(buyEquipment(s, 'mic')).toMatchObject({ ok: false, reason: 'max_level' });
  });
});

describe('순수 음악력', () => {
  it('비용 공식: ceil(250×1.5^레벨) → 250, 375, 563, 844, 1266', () => {
    expect([0, 1, 2, 3, 4].map((lv) => musicPowerCost(lv))).toEqual([250, 375, 563, 844, 1266]);
    expect(musicPowerCost(10)).toBe(Math.ceil(B.musicPower.base * B.musicPower.growth ** 10));
  });

  it('코인 부족이면 아무것도 바뀌지 않고, 충분하면 정확히 차감하며 1레벨 오른다', () => {
    const poor = base({ coins: 249 });
    const fail = buyMusicPower(poor);
    expect(fail).toMatchObject({ ok: false, reason: 'insufficient_coins' });
    expect(fail.state).toBe(poor);

    const r = buyMusicPower(base({ coins: 625 }));
    expect(r.ok && r.state.coins).toBe(375);
    expect(r.ok && r.state.musicPower).toBe(1);
    expect(r.ok && r.cost).toBe(250);
    // 다음 레벨은 375코인
    const r2 = r.ok ? buyMusicPower(r.state) : r;
    expect(r2.ok && r2.state.coins).toBe(0);
    expect(r2.ok && r2.state.musicPower).toBe(2);
  });

  it('최대 레벨이 없다: 레벨이 높아도 코인만 있으면 계속 오른다', () => {
    const s = base({ coins: 1e12, musicPower: 30 });
    expect(buyMusicPower(s)).toMatchObject({ ok: true });
  });

  it('레벨당 작업하기 기본 라임 +1, 생산배율이 곱해진다', () => {
    expect(clickGain(base())).toBe(1);
    expect(clickGain(base({ musicPower: 3 }))).toBe(4);
    const s = base({ musicPower: 2, equipment: { mic: 2, studio: 0, promotion: 0 }, activePersona: 'normal' });
    const r = work(s);
    expect(r.ok && r.gained).toBeCloseTo(3 * 1.3, 9);
    expect(r.ok && r.state.normalRhymes).toBeCloseTo(3 * 1.3, 9);
  });

  it('미리보기: 올리기 전·후 1회 라임과 구매 가능 여부', () => {
    const pv = previewMusicPower(base({ coins: 250, musicPower: 0 }));
    expect(pv).toMatchObject({ level: 0, cost: 250, affordable: true, gainBefore: 1, gainAfter: 2 });
    expect(previewMusicPower(base({ coins: 249 })).affordable).toBe(false);
  });

  it('일반속성의 순수 음악력·장비는 어둠 작업하기에 적용되지 않는다', () => {
    const geared = base({ musicPower: 5, equipment: { mic: 4, studio: 3, promotion: 0 } });
    expect(clickGain({ ...geared, activePersona: 'normal' })).toBeCloseTo(6 * 1.75, 9);
    expect(clickGain({ ...geared, activePersona: 'dark' })).toBe(1);
    const r = work({ ...geared, activePersona: 'dark' });
    expect(r.ok && r.gained).toBe(1);
    expect(r.ok && r.state.darkRhymes).toBe(1);
    // 미리보기는 요청한 속성 기준이다 (기본은 일반)
    const pv = previewMusicPower({ ...geared, activePersona: 'dark' });
    expect(pv.gainBefore).toBeCloseTo(6 * 1.75, 9);
    expect(pv.gainAfter).toBeCloseTo(7 * 1.75, 9);
  });

  it('자동 생산(초당 라임)에는 영향이 없다', () => {
    const a = at(base({ musicPower: 0 }), 10_000);
    const b = at(base({ musicPower: 9 }), 10_000);
    expect(b.normalRhymes).toBeCloseTo(a.normalRhymes, 9);
  });
});

describe('어둠속성 장비·음지 드립력', () => {
  it('가격: 최초 비용은 일반의 12배, 늘어나는 폭(성장률 − 1)은 일반의 2.4배', () => {
    expect([equipmentCost('mic', 0, 'dark'), equipmentCost('studio', 0, 'dark'), equipmentCost('promotion', 0, 'dark')]).toEqual([600, 1800, 1080]);
    expect(musicPowerCost(0, 'dark')).toBe(3000);
    for (const k of ['mic', 'studio', 'promotion'] as const) {
      const n = B.equipment[k];
      const d = B.darkEquipment[k];
      expect(d.base).toBe(n.base * 12);
      expect(d.growth - 1).toBeCloseTo((n.growth - 1) * 2.4, 3);
      expect(equipmentCost(k, 3, 'dark')).toBe(Math.ceil(d.base * d.growth ** 3));
    }
    expect(B.dripPower.base).toBe(B.musicPower.base * 12);
    expect(B.dripPower.growth - 1).toBeCloseTo((B.musicPower.growth - 1) * 2.4, 3);
    // 일반 가격은 그대로
    expect(equipmentCost('mic', 0)).toBe(50);
    expect(musicPowerCost(0)).toBe(250);
  });

  it('어둠 장비는 일반 장비와 레벨·코인이 따로 간다', () => {
    const r = buyEquipment(base({ coins: 700 }), 'mic', 'dark');
    expect(r.ok && r.state.coins).toBe(100);
    expect(r.ok && r.state.darkEquipment.mic).toBe(1);
    expect(r.ok && r.state.equipment.mic).toBe(0);
    const n = buyEquipment(base({ coins: 100 }), 'mic');
    expect(n.ok && n.state.equipment.mic).toBe(1);
    expect(n.ok && n.state.darkEquipment.mic).toBe(0);
    // 어둠 마이크는 일반 마이크 가격으로 살 수 없다
    expect(buyEquipment(base({ coins: 599 }), 'mic', 'dark')).toMatchObject({ ok: false, reason: 'insufficient_coins' });
  });

  it('어둠 장비도 20레벨이 최대', () => {
    const s = base({ coins: 1e15, darkEquipment: { mic: 20, studio: 0, promotion: 0 } });
    expect(buyEquipment(s, 'mic', 'dark')).toMatchObject({ ok: false, reason: 'max_level' });
    expect(buyEquipment(s, 'studio', 'dark')).toMatchObject({ ok: true });
  });

  it('음지 드립력: 어둠에서만 레벨당 작업하기 라임 +1, 어둠 생산배율이 곱해진다', () => {
    const fail = buyMusicPower(base({ coins: 2999 }), 'dark');
    expect(fail).toMatchObject({ ok: false, reason: 'insufficient_coins' });
    const bought = buyMusicPower(base({ coins: 3100 }), 'dark');
    expect(bought.ok && bought.state.coins).toBe(100);
    expect(bought.ok && bought.state.dripPower).toBe(1);
    expect(bought.ok && bought.state.musicPower).toBe(0);

    const s = base({ dripPower: 2, darkEquipment: { mic: 2, studio: 0, promotion: 0 }, activePersona: 'dark' });
    expect(clickGain(s)).toBeCloseTo(3 * 1.3, 9);
    const r = work(s);
    expect(r.ok && r.state.darkRhymes).toBeCloseTo(3 * 1.3, 9);
    // 같은 레벨이라도 일반속성으로 작업하면 드립력은 적용되지 않는다
    expect(clickGain({ ...s, activePersona: 'normal' })).toBe(1);
  });

  it('미리보기는 요청한 속성의 값을 보여준다', () => {
    const s = base({ coins: 5000, darkEquipment: { mic: 1, studio: 0, promotion: 0 } });
    const pv = previewEquipment(s, 'mic', 'dark');
    expect(pv).toMatchObject({ persona: 'dark', level: 1, cost: equipmentCost('mic', 1, 'dark') });
    expect(pv.before).toBeCloseTo(1.15, 9);
    expect(pv.after).toBeCloseTo(1.3, 9);
    expect(pv.rateBefore).toBeCloseTo(1.7 * 1.15, 9);
    expect(pv.rateAfter).toBeCloseTo(1.7 * 1.3, 9);
    expect(previewMusicPower(s, 'dark')).toMatchObject({ persona: 'dark', level: 0, cost: 3000, affordable: true });
  });

  it('작업실 외형 단계는 그 속성의 작업실 레벨을 따른다', () => {
    const s = base({ equipment: { mic: 0, studio: 10, promotion: 0 }, darkEquipment: { mic: 0, studio: 5, promotion: 0 } });
    expect(roomTier({ ...s, activePersona: 'normal' })).toBe(2);
    expect(roomTier({ ...s, activePersona: 'dark' })).toBe(1);
    expect(roomTier(s, 'dark')).toBe(1);
  });
});

describe('앨범', () => {
  const ready = (coins = 1e9) => base({ coins });

  it('카탈로그: 지정한 3장의 수록곡·속성', () => {
    expect(ALBUM_CATALOG.map((d) => [d.title, d.kind, d.type, d.tracks.length])).toEqual([
      ['SAPA', 'EP', 'normal', 5],
      ['MONO', 'EP', 'normal', 5],
      ['cybergirl.vst3', '싱글', 'normal', 3],
    ]);
    expect(ALBUM_CATALOG[0].tracks.map((x) => x.title)).toEqual([
      'outro (항해사랑빈칸)',
      'draco !',
      'i been always abandoned by ( )',
      '편린',
      'Keep it mono - Intro',
    ]);
    expect(ALBUM_CATALOG[1].tracks.filter((x) => x.isTitle).map((x) => x.title)).toEqual(['이리 와']);
    expect(ALBUM_CATALOG[2].tracks.filter((x) => x.isTitle).map((x) => x.title)).toEqual(['cybergirl.vst3']);
  });

  it('비용·팬 공식', () => {
    expect([0, 1, 2].map(albumCost)).toEqual([10_000, 350_000, 20_000_000]);
    expect([0, 1, 2].map(albumFans)).toEqual([100, 200, 300]);
    const first = releaseAlbum(ready());
    expect(first.ok && first.fans).toBe(albumFans(0));
    expect(first.ok && first.state.coins).toBe(1e9 - 10_000);
    expect(first.ok && first.album).toMatchObject({ id: 'album-1', title: 'SAPA', type: 'normal' });
    // 세 번째 앨범
    const third = releaseAlbum(base({ coins: 1e8, albums: ALBUM_CATALOG.slice(0, 2).map((d) => ({ id: d.id, title: d.title, type: d.type, releasedAt: 0 })) }));
    expect(third.ok && third.fans).toBe(albumFans(2));
    expect(third.ok && third.cost).toBe(albumCost(2));
  });

  it('발매한 싱글과 무관하게 지정 순서대로 낸다', () => {
    const s = ready();
    expect(s.singles).toHaveLength(0);
    let cur = s;
    for (const def of ALBUM_CATALOG) {
      const r = releaseAlbum(cur);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.def.id).toBe(def.id);
      expect(r.state.singles).toHaveLength(0);
      cur = r.state;
    }
    expect(cur.albums.map((a) => a.title)).toEqual(['SAPA', 'MONO', 'cybergirl.vst3']);
    expect(cur.tutorialFlags.album).toBe(true);
  });

  it('모두 발매하면 더 낼 수 없다', () => {
    let cur = ready();
    for (let i = 0; i < ALBUM_CATALOG.length; i++) {
      const r = releaseAlbum(cur);
      if (!r.ok) return;
      cur = r.state;
    }
    expect(previewAlbum(cur)).toBeNull();
    expect(releaseAlbum(cur)).toMatchObject({ ok: false, reason: 'no_more_albums' });
  });

  it('코인 부족이면 아무것도 바뀌지 않는다', () => {
    const s = ready(9_999);
    const r = releaseAlbum(s);
    expect(r).toMatchObject({ ok: false, reason: 'insufficient_coins' });
    expect(r.state).toBe(s);
  });

  it('누적 앨범 수가 다음 비용·팬·인세 배율에 반영', () => {
    const a1 = releaseAlbum(ready());
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    const a2 = releaseAlbum(a1.state);
    expect(a2.ok && a2.cost).toBe(albumCost(1));
    expect(a2.ok && a2.fans).toBe(albumFans(1));
    expect(a2.ok && a2.state.albums).toHaveLength(2);
  });
});

describe('공연', () => {
  const fanned = (fans: number) => base({ fans });

  it('해금: 팬 조건 + 이전 공연장 클리어', () => {
    const s = fanned(1500);
    expect(stageStatus(s, 'room').unlocked).toBe(true);
    expect(stageStatus(s, 'club').unlocked).toBe(false); // 방구석 미클리어
    expect(stageStatus(fanned(99), 'room').unlocked).toBe(false);
    expect(runAutoConcert(fanned(99), 'room')).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('8) 자동·직접을 번갈아도 첫 클리어 보너스는 한 번, 쿨다운 우회 없음', () => {
    let s = fanned(100);
    const auto = runAutoConcert(s, 'room');
    expect(auto.ok).toBe(true);
    if (!auto.ok) return;
    expect(auto.outcome.coins).toBe(40 + 200);
    s = auto.state;
    // 쿨다운 중에는 자동도 직접도 불가
    expect(runAutoConcert(s, 'room')).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(beginManualConcert(s, 'room', 'r1')).toMatchObject({ ok: false, reason: 'cooldown' });
    s = at(s, BALANCE.concert.cooldownMs - 1);
    expect(runAutoConcert(s, 'room').ok).toBe(false);
    s = at(s, 1);
    const begin = beginManualConcert(s, 'room', 'r2');
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const fin = finishManualConcert(begin.state, begin.run, 800);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.outcome.firstClear).toBe(false);
    expect(fin.outcome.coins).toBe(manualConcertReward(40, 800, 'normal'));
    expect(fin.state.concerts.room.bestScore).toBe(800);
  });

  it('직접 공연 보상: 점수·자아 배율, 600 미만은 50%·첫 클리어 아님', () => {
    expect(manualConcertReward(40, 1000, 'normal')).toBe(80);
    expect(manualConcertReward(40, 1000, 'dark')).toBe(Math.floor(40 * 2 * 1.5));
    expect(manualConcertReward(80, 700, 'normal')).toBe(Math.floor(80 * 1.7));
    expect(manualConcertReward(80, 500, 'normal')).toBe(Math.floor(80 * 1.5 * 0.5));

    const begin = beginManualConcert(fanned(100), 'room', 'f1');
    if (!begin.ok) throw new Error('begin failed');
    const lost = finishManualConcert(begin.state, begin.run, 550);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.state.concerts.room.cleared).toBe(false);
    expect(lost.ok && lost.outcome.firstClearCoins).toBe(0);
  });

  it('공연장이 올라갈수록 직접 공연 난이도가 1.1배씩 어려워진다', () => {
    expect(stageDifficulty('room')).toBeCloseTo(1.3, 9);
    expect(stageDifficulty('club')).toBeCloseTo(1.3 * 1.1, 9);
    expect(stageDifficulty('hall')).toBeCloseTo(1.3 * 1.1 * 1.1, 9);
    const begin = beginManualConcert({ ...fanned(1500), concerts: { ...fanned(1500).concerts, room: { cleared: true, bestScore: 0, cooldownUntil: 0 } } }, 'club', 'd1');
    expect(begin.ok && begin.run.difficulty).toBeCloseTo(1.43, 9);
  });

  it('보상은 공연 ID당 한 번만: 재렌더·중복 이벤트로 두 번 받을 수 없다', () => {
    const begin = beginManualConcert(fanned(100), 'room', 'dup');
    if (!begin.ok) throw new Error('begin failed');
    const first = finishManualConcert(begin.state, begin.run, 900);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // 호출자가 종료된 run을 다시 넘겨도 거부
    const second = finishManualConcert(first.state, first.run, 900);
    expect(second).toMatchObject({ ok: false, reason: 'session_closed' });
    expect(first.state.coins).toBe(first.state.coins);
    const abandoned = abandonConcert(first.run);
    expect(finishManualConcert(first.state, abandoned, 900).ok).toBe(false);
  });

  it('중도 포기: 보상 없음, 쿨다운 유지', () => {
    const s = fanned(100);
    const begin = beginManualConcert(s, 'room', 'ab');
    if (!begin.ok) throw new Error('begin failed');
    const run = abandonConcert(begin.run);
    expect(run.status).toBe('abandoned');
    expect(finishManualConcert(begin.state, run, 1000).ok).toBe(false);
    expect(begin.state.coins).toBe(0);
    expect(stageStatus(begin.state, 'room').cooldownLeftMs).toBe(BALANCE.concert.cooldownMs);
  });

  it('공연 자아는 시작 시점에 고정된다', () => {
    const s = base({ fans: 100, activePersona: 'dark' });
    const begin = beginManualConcert(s, 'room', 'p1');
    if (!begin.ok) throw new Error('begin failed');
    const switched = { ...begin.state, activePersona: 'normal' as const };
    const fin = finishManualConcert(switched, begin.run, 1000);
    expect(fin.ok && fin.outcome.coins).toBe(manualConcertReward(40, 1000, 'dark') + 200);
  });

  it('소형 공연장 이후 단콘→중형→중대형→대형→월클 순서로 열린다', () => {
    const order = ['hall', 'solo', 'medium', 'large', 'arena', 'world'] as const;
    expect(STAGES.map((d) => d.id)).toEqual(['room', 'club', ...order]);
    // 팬이 충분해도 앞 공연장을 클리어해야 열린다
    let s = fanned(1e6);
    expect(stageStatus(s, 'solo').unlocked).toBe(false);
    for (const id of ['room', 'club', ...order] as const) {
      expect(stageStatus(s, id).unlocked).toBe(true);
      const r = runAutoConcert(s, id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.concerts.world.cleared).toBe(true);
    // 팬 조건: 팬이 모자라면 열리지 않는다
    expect(stageStatus({ ...fanned(2999), concerts: { ...fanned(2999).concerts, hall: { cleared: true, bestScore: 0, cooldownUntil: 0 } } }, 'solo').unlocked).toBe(false);
    expect(stageDifficulty('world')).toBeCloseTo(1.3 * 1.1 ** 7, 9);
  });

  it('마지막 공연장 첫 클리어 → 첫 투어 완료, 자동 공연만으로도 가능', () => {
    let s = fanned(5000);
    for (const id of ['room', 'club', 'hall'] as const) {
      const r = runAutoConcert(s, id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(isTourComplete(s)).toBe(true);
    expect(s.coins).toBe(40 + 200 + 80 + 500 + 150 + 1200);
  });
});

describe('입력 상한', () => {
  it('초당 최대 3회만 인정', () => {
    const lim = new InputLimiter();
    const accepted = [0, 10, 20, 30, 40, 500, 999].map((t) => lim.accept(t));
    expect(accepted).toEqual([true, true, true, false, false, false, false]);
    expect(lim.accept(1001)).toBe(true);
  });

  it('작업하기는 지금 자아의 장비 생산배율만 곱한다', () => {
    const gear = { equipment: { mic: 2, studio: 0, promotion: 0 } };
    const normal = work(base({ ...gear, activePersona: 'normal' }));
    expect(normal.ok && normal.state.normalRhymes).toBeCloseTo(1.3, 9);
    expect(normal.ok && normal.state.darkRhymes).toBe(0);
    // 일반 장비는 어둠 작업하기에 적용되지 않는다
    const dark = work(base({ ...gear, activePersona: 'dark' }));
    expect(dark.ok && dark.state.darkRhymes).toBe(1);
    expect(dark.ok && dark.state.normalRhymes).toBe(0);
    // 어둠 장비는 어둠 작업하기에 적용된다
    const darkGear = work(base({ darkEquipment: { mic: 2, studio: 0, promotion: 0 }, activePersona: 'dark' }));
    expect(darkGear.ok && darkGear.state.darkRhymes).toBeCloseTo(1.3, 9);
  });
});

describe('콘텐츠', () => {
  it('대사는 자아·상황당 3개 이상, 총 48개 이상', () => {
    expect(dialogueCount()).toBeGreaterThanOrEqual(48);
    for (const p of ['normal', 'dark'] as const) for (const s of SITUATIONS) expect(DIALOGUE[p][s].length).toBeGreaterThanOrEqual(3);
  });

  it('같은 대사를 연속으로 고르지 않는다', () => {
    let last: string | null = null;
    for (let i = 0; i < 200; i++) {
      const picked = pickLine('dark', 'idle', 'original', last);
      expect(picked.key).not.toBe(last);
      last = picked.key;
    }
  });

  it('순화 톤은 욕설 대사만 교체하고 수치와 무관하다', () => {
    const original = pickLine('dark', 'heat', 'original', null, () => 0).text;
    const soft = pickLine('dark', 'heat', 'soft', null, () => 0).text;
    expect(original).toContain('씨발');
    expect(soft).not.toContain('씨발');
  });
});
