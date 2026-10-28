import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEY,
  CORRUPT_KEY,
  SAVE_KEY,
  createInitialState,
  discardCorrupt,
  exportSave,
  importSave,
  loadGame,
  parseSave,
  recoverFromBackup,
  saveGame,
  validateState,
  type StorageLike,
} from '../persistence';
import {
  MinigameClock,
  createMinigame,
  currentTask,
  isFinished,
  judge,
  judgeWindows,
  taskDifficulty,
  pressAt,
  scoreOf,
  targetMs,
  durationMs,
  inputWindowMs,
  approachMs,
  tickTo,
} from '../minigame';
import type { GameState } from '../types';

const T0 = 1_700_000_000_000;

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const sampleState = (): GameState => ({
  ...createInitialState(T0),
  coins: 123.5,
  fans: 77,
  singles: [
    { id: 'single-1', persona: 'normal', title: 'a', releasedAt: T0 },
    { id: 'single-2', persona: 'dark', title: 'b', releasedAt: T0 },
  ],
  albums: [{ id: 'album-1', title: 'SAPA', type: 'normal', releasedAt: T0 }],
});

describe('저장·검증', () => {
  it('저장 → 불러오기 왕복', () => {
    const st = memoryStorage();
    expect(loadGame(st).status).toBe('new');
    const saved = saveGame(st, sampleState(), T0 + 10);
    expect(saved.ok).toBe(true);
    const loaded = loadGame(st);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.state.coins).toBe(123.5);
      expect(loaded.state.revision).toBe(1);
      expect(loaded.state.singles).toHaveLength(2);
    }
  });

  it('순수 음악력: 왕복 저장되고, 이 필드가 없는 예전 저장은 0레벨로 읽는다', () => {
    const st = memoryStorage();
    saveGame(st, { ...sampleState(), musicPower: 7 }, T0 + 10);
    const loaded = loadGame(st);
    expect(loaded.status === 'ok' && loaded.state.musicPower).toBe(7);

    const { musicPower: _omit, ...legacy } = sampleState();
    const old = validateState(legacy);
    expect(old.ok && old.state.musicPower).toBe(0);

    expect(validateState({ ...sampleState(), musicPower: -1 }).ok).toBe(false);
    expect(validateState({ ...sampleState(), musicPower: 1.5 }).ok).toBe(false);
    expect(validateState({ ...sampleState(), musicPower: 'many' }).ok).toBe(false);
    expect(validateState({ ...sampleState(), musicPower: 1001 }).ok).toBe(false);
  });

  it('어둠속성 장비·음지 드립력: 왕복 저장되고, 없는 예전 저장은 0레벨로 읽는다', () => {
    const st = memoryStorage();
    saveGame(st, { ...sampleState(), darkEquipment: { mic: 3, studio: 2, promotion: 1 }, dripPower: 4 }, T0 + 10);
    const loaded = loadGame(st);
    expect(loaded.status === 'ok' && loaded.state.darkEquipment).toEqual({ mic: 3, studio: 2, promotion: 1 });
    expect(loaded.status === 'ok' && loaded.state.dripPower).toBe(4);

    const { darkEquipment: _d, dripPower: _p, ...legacy } = sampleState();
    const old = validateState(legacy);
    expect(old.ok && old.state.darkEquipment).toEqual({ mic: 0, studio: 0, promotion: 0 });
    expect(old.ok && old.state.dripPower).toBe(0);

    expect(validateState({ ...sampleState(), darkEquipment: { mic: 21, studio: 0, promotion: 0 } }).ok).toBe(false);
    expect(validateState({ ...sampleState(), darkEquipment: { mic: 1.5, studio: 0, promotion: 0 } }).ok).toBe(false);
    expect(validateState({ ...sampleState(), darkEquipment: 'x' }).ok).toBe(false);
    expect(validateState({ ...sampleState(), dripPower: -1 }).ok).toBe(false);
  });

  it('다이아: 왕복 저장되고, 다이아가 없던 예전 저장은 지금까지 한 일만큼 한 번 소급 지급한다', () => {
    const st = memoryStorage();
    saveGame(st, { ...sampleState(), diamonds: 42, diamondUpgrades: { production: 3, royalty: 1 } }, T0 + 10);
    const loaded = loadGame(st);
    expect(loaded.status === 'ok' && loaded.state.diamonds).toBe(42);
    expect(loaded.status === 'ok' && loaded.state.diamondUpgrades).toEqual({ production: 3, royalty: 1 });

    // 예전 저장: 방구석 클리어(5) + 앨범 1장(30) + 팬 77(Lv.2 → +2)
    const { diamonds: _d, diamondUpgrades: _u, ...legacy } = sampleState();
    const withClear = {
      ...legacy,
      concerts: { ...legacy.concerts, room: { cleared: true, bestScore: 0, cooldownUntil: 0 } },
    };
    const old = validateState(withClear);
    expect(old.ok && old.state.diamonds).toBe(5 + 30 + 2);
    expect(old.ok && old.state.diamondUpgrades).toEqual({ production: 0, royalty: 0 });
    // 다이아 필드가 있으면 소급 지급하지 않는다 (0이어도 그대로)
    const zero = validateState({ ...withClear, diamonds: 0 });
    expect(zero.ok && zero.state.diamonds).toBe(0);

    expect(validateState({ ...sampleState(), diamonds: -1 }).ok).toBe(false);
    expect(validateState({ ...sampleState(), diamonds: Infinity }).ok).toBe(false);
    expect(validateState({ ...sampleState(), diamondUpgrades: { production: 21, royalty: 0 } }).ok).toBe(false);
    expect(validateState({ ...sampleState(), diamondUpgrades: { production: 1.5, royalty: 0 } }).ok).toBe(false);
    expect(validateState({ ...sampleState(), diamondUpgrades: 'x' }).ok).toBe(false);
  });

  it('10) 손상 JSON·이전/미래 스키마·음수·무한 수치를 거부한다', () => {
    expect(parseSave('{not json').ok).toBe(false);
    expect(parseSave('[]').ok).toBe(false);
    expect(parseSave('null').ok).toBe(false);
    const good = sampleState();
    expect(validateState({ ...good, schemaVersion: 99 })).toMatchObject({ ok: false });
    expect(validateState({ ...good, schemaVersion: 0 })).toMatchObject({ ok: false });
    const { schemaVersion: _omit, ...noVersion } = good;
    void _omit;
    expect(validateState(noVersion).ok).toBe(false);
    expect(validateState({ ...good, coins: -1 }).ok).toBe(false);
    expect(validateState({ ...good, coins: Infinity }).ok).toBe(false);
    expect(validateState({ ...good, fans: NaN }).ok).toBe(false);
    expect(validateState({ ...good, coins: 1e300 }).ok).toBe(false);
    expect(validateState({ ...good, heat: 101 }).ok).toBe(false);
    expect(validateState({ ...good, activePersona: 'evil' }).ok).toBe(false);
    expect(validateState({ ...good, equipment: { mic: 21, studio: 0, promotion: 0 } }).ok).toBe(false);
    expect(validateState({ ...good, equipment: { mic: 1.5, studio: 0, promotion: 0 } }).ok).toBe(false);
    // JSON에서 Infinity는 null로 바뀐다
    expect(parseSave(JSON.stringify({ ...good, coins: Infinity })).ok).toBe(false);
  });

  it('싱글 ID가 중복되면 거부', () => {
    const good = sampleState();
    expect(validateState({ ...good, singles: [good.singles[0], { ...good.singles[1], id: 'single-1' }] }).ok).toBe(false);
  });

  it('앨범은 카탈로그에서 읽는다: 저장된 제목·속성은 무시하고, 예전 저장도 앞 앨범으로 옮겨 읽는다', () => {
    const good = sampleState();
    const tampered = validateState({ ...good, albums: [{ id: 'x', title: '아무거나', type: 'dark', releasedAt: T0 }] });
    expect(tampered.ok && tampered.state.albums[0]).toMatchObject({ id: 'album-1', title: 'SAPA', type: 'normal', releasedAt: T0 });
    // 예전 형식(싱글 2개로 만든 앨범 5장, 싱글의 albumId 필드)
    const legacy = {
      ...good,
      singles: good.singles.map((s) => ({ ...s, albumId: 'album-1' })),
      albums: Array.from({ length: 5 }, (_, i) => ({ id: `album-${i + 1}`, title: 'al', singleIds: ['single-1', 'single-2'], type: 'dual', releasedAt: T0 + i })),
    };
    const migrated = validateState(legacy);
    expect(migrated.ok && migrated.state.albums.map((a) => a.title)).toEqual(['SAPA', 'MONO', 'cybergirl.vst3']);
    expect(validateState({ ...good, albums: [null] }).ok).toBe(false);
  });

  it('손상 저장은 자동으로 덮어쓰지 않는다 / 백업 복구 가능', () => {
    const st = memoryStorage();
    saveGame(st, sampleState(), T0);
    saveGame(st, { ...sampleState(), coins: 999 }, T0 + 120_000); // 백업 갱신(60초 이상 경과)
    expect(st.data.has(BACKUP_KEY)).toBe(true);

    st.data.set(SAVE_KEY, '{"broken": ');
    const loaded = loadGame(st);
    expect(loaded.status).toBe('corrupt');
    if (loaded.status === 'corrupt') expect(loaded.hasBackup).toBe(true);

    const attempt = saveGame(st, sampleState(), T0 + 200_000);
    expect(attempt.ok).toBe(false);
    expect(st.data.get(SAVE_KEY)).toBe('{"broken": ');

    const rec = recoverFromBackup(st);
    expect(rec.ok).toBe(true);
    expect(loadGame(st).status).toBe('ok');
  });

  it('초기화 선택 시 손상 원본은 별도 키에 보관', () => {
    const st = memoryStorage();
    st.data.set(SAVE_KEY, 'garbage');
    discardCorrupt(st);
    expect(st.data.has(SAVE_KEY)).toBe(false);
    expect(st.data.get(CORRUPT_KEY)).toBe('garbage');
  });

  it('검증 실패 상태는 저장하지 않는다', () => {
    const st = memoryStorage();
    expect(saveGame(st, { ...sampleState(), coins: NaN }, T0).ok).toBe(false);
    expect(st.data.has(SAVE_KEY)).toBe(false);
  });

  it('내보내기 → 불러오기, 불러오기는 lastSettledAt을 현재로 맞춘다', () => {
    const st = memoryStorage();
    const text = exportSave({ ...sampleState(), lastSettledAt: T0 - 10 * 3600_000 }, T0);
    const r = importSave(st, text, T0 + 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.lastSettledAt).toBe(T0 + 5);
    expect(importSave(st, '{bad', T0).ok).toBe(false);
    expect(loadGame(st).status).toBe('ok');
  });
});

describe('마이크 타이밍 미니게임', () => {
  const perfectRun = (persona: 'normal' | 'dark', offsetMs: number) => {
    let mg = createMinigame(persona);
    for (let i = 0; i < 10; i++) mg = pressAt(mg, targetMs(i) + offsetMs);
    return tickTo(mg, durationMs);
  };

  it('목표 간격은 2초에서 시작해 ×1.08씩 빨라진다', () => {
    const ts = Array.from({ length: 10 }, (_, i) => targetMs(i));
    expect(ts.slice(0, 3)).toEqual([1000, 3000, 4852]);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    expect(gaps[0]).toBe(2000);
    expect(gaps[8]).toBeGreaterThanOrEqual(1000);
    expect(durationMs).toBe(ts[9] + 1000);
    // 입력 구간은 이웃과 겹치지 않는다
    for (let i = 0; i < 9; i++) expect(targetMs(i) + inputWindowMs(i)).toBeLessThan(targetMs(i + 1) - inputWindowMs(i + 1));
    // 접근 링도 뒤로 갈수록 짧아진다
    expect(approachMs(0)).toBe(1000);
    expect(approachMs(9)).toBeLessThan(approachMs(1));
  });

  it('판정 경계: 일반 ±120/±300, 어둠 ±120/±220', () => {
    expect(judge('normal', 120)).toBe('perfect');
    expect(judge('normal', -121)).toBe('good');
    expect(judge('normal', 300)).toBe('good');
    expect(judge('normal', 301)).toBe('miss');
    expect(judge('dark', 220)).toBe('good');
    expect(judge('dark', 221)).toBe('miss');
    expect(judge('dark', -120)).toBe('perfect');
  });

  it('난이도: 판정 폭이 난이도에 반비례해 좁아진다', () => {
    expect(judgeWindows('normal', 1)).toEqual({ perfectMs: 120, goodMs: 300 });
    expect(judgeWindows('normal', 1.3)).toEqual({ perfectMs: 92, goodMs: 231 });
    expect(judgeWindows('dark', 1.3)).toEqual({ perfectMs: 92, goodMs: 169 });
    // 난이도 1에서는 Good이던 250ms 오차가 방구석(×1.3)에서는 Miss
    expect(judge('normal', 250, 1)).toBe('good');
    expect(judge('normal', 250, 1.3)).toBe('miss');
    expect(judge('normal', 100, 1.3)).toBe('good');
    let mg = createMinigame('normal', 1.3);
    mg = pressAt(mg, targetMs(0) + 250);
    expect(mg.results[0]).toBe('miss');
  });

  it('과제를 맞출 때마다 난이도가 1.25배씩 쌓여 판정 폭이 좁아진다', () => {
    expect(taskDifficulty(1, 0)).toBe(1);
    expect(taskDifficulty(1.3, 9)).toBeCloseTo(1.3 * 1.25 ** 9, 9);
    // 난이도 1 공연: 1번째 과제는 ±300 Good, 10번째 과제는 ±40 Good(Perfect ±16)
    const slow = (i: number, delta: number) => pressAt(createMinigame('normal', 1), targetMs(i) + delta).results[i];
    expect(slow(0, 250)).toBe('good');
    expect(slow(9, 250)).toBe('miss');
    expect(slow(9, 10)).toBe('perfect');
    expect(slow(9, 30)).toBe('good');
    expect(slow(9, 41)).toBe('miss');
    // 같은 오차(100ms)도 뒤로 갈수록 등급이 떨어진다
    expect(slow(0, 100)).toBe('perfect');
    expect(slow(9, 100)).toBe('miss');
  });

  it('전부 Perfect면 1000점, 오차가 있으면 감점', () => {
    expect(scoreOf(perfectRun('normal', 0))).toBe(1000);
    // 마지막 과제 Perfect 폭(±16ms)보다 큰 오차는 Good, Good 폭(±40ms)을 넘으면 Miss
    expect(scoreOf(perfectRun('normal', 100))).toBeLessThan(1000);
    expect(scoreOf(perfectRun('normal', 200))).toBeLessThan(scoreOf(perfectRun('normal', 100)));
    expect(scoreOf(perfectRun('dark', 250))).toBe(0);
  });

  it('첫 유효 입력으로 판정이 확정되고 추가 입력은 영향이 없다', () => {
    let mg = createMinigame('normal');
    mg = pressAt(mg, 1400); // 400ms 오차 → Miss로 확정
    mg = pressAt(mg, 1000); // 이미 확정, 무시
    mg = pressAt(mg, 1001);
    expect(mg.results[0]).toBe('miss');
    expect(scoreOf(mg)).toBe(0);
  });

  it('구간 바깥 연타는 점수에 영향이 없다', () => {
    let mg = createMinigame('normal');
    for (const t of [100, 300, 480, 1600, 2100, 2400]) mg = pressAt(mg, t);
    expect(mg.results.every((r) => r === null || r === 'miss')).toBe(true);
    // 1600은 첫 과제 구간(500~1500) 밖, 2400은 두 번째(2500~3500) 밖
    expect(mg.results[0]).toBe('miss'); // 1600 시점에 구간 종료 → Miss
    expect(mg.results[1]).toBeNull();
  });

  it('무입력은 구간 종료 시 Miss, 종료 후 600점 이상이 클리어', () => {
    const mg = tickTo(createMinigame('normal'), durationMs);
    expect(isFinished(mg)).toBe(true);
    expect(mg.results.every((r) => r === 'miss')).toBe(true);
    let six = createMinigame('normal');
    for (let i = 0; i < 6; i++) six = pressAt(six, targetMs(i));
    six = tickTo(six, durationMs);
    expect(scoreOf(six)).toBe(600);
  });

  it('currentTask는 입력 가능한 다음 과제를 가리킨다', () => {
    let mg = createMinigame('normal');
    expect(currentTask(mg)).toBe(0);
    mg = pressAt(mg, 1000);
    expect(currentTask(mg)).toBe(1);
  });

  it('9) 탭 숨김·복귀: 일시정지 중에는 시계가 흐르지 않아 가짜 Miss가 없다', () => {
    const clock = new MinigameClock();
    clock.start(0);
    for (let t = 100; t < 1000; t += 100) clock.read(t);
    expect(clock.read(1000)).toBe(1000);
    clock.pause(1200); // 숨김
    expect(clock.read(60_000)).toBe(1200); // 1분 지나도 그대로
    clock.resume(60_000); // 복귀
    expect(clock.read(60_100)).toBe(1300);
    let mg = tickTo(createMinigame('normal'), clock.read(60_100));
    expect(mg.results.filter((r) => r === 'miss')).toHaveLength(0);
    mg = pressAt(mg, 3000);
    expect(mg.results[1]).toBe('perfect');
  });

  it('9) 복귀 직후 거대한 프레임 간격도 한 프레임 한도만 진행', () => {
    const clock = new MinigameClock(250);
    clock.start(0);
    clock.read(100);
    expect(clock.read(100 + 30_000)).toBe(350);
    const mg = tickTo(createMinigame('normal'), clock.read(30_200));
    expect(mg.results.filter((r) => r === 'miss')).toHaveLength(0);
  });
});
