import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_KEY, createInitialState, type StorageLike } from '../../game/persistence';
import { CloudSync, PUSH_MIN_INTERVAL_MS, reconcileOnBoot, resetLocalProgress, scopedStorage } from '../cloudSave';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const T0 = 1_700_000_000_000;
const stateText = (coins: number) => JSON.stringify({ ...createInitialState(T0), coins });

/** fetch 대역: 요청을 기록하고, 큐에 넣어 둔 응답을 차례로 돌려준다. */
function mockFetch(...replies: { status: number; body?: unknown }[]) {
  const calls: { method: string; body: unknown }[] = [];
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = replies.shift() ?? { status: 200, body: { version: 99, savedAt: 0 } };
    return { status: r.status, json: async () => r.body ?? null } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('scopedStorage', () => {
  it('계정마다 키가 따로라 진행이 섞이지 않는다', () => {
    const base = memory();
    const a = scopedStorage(base, 'A');
    const b = scopedStorage(base, 'B');
    a.setItem(SAVE_KEY, 'a');
    expect(b.getItem(SAVE_KEY)).toBeNull();
    expect(base.getItem(`A:${SAVE_KEY}`)).toBe('a');
  });
});

describe('reconcileOnBoot', () => {
  it('서버에 저장이 있고 로컬이 없으면 서버 저장을 로컬에 쓴다', async () => {
    mockFetch({ status: 200, body: { save: { state: { coins: 7 }, version: 3, savedAt: T0 } } });
    const device = memory();
    const account = scopedStorage(device, 'A');
    await reconcileOnBoot(account, device, 'A');
    expect(JSON.parse(account.getItem(SAVE_KEY)!)).toEqual({ coins: 7 });
    expect(account.getItem('monosapa.sync.version')).toBe('3');
  });

  it('로컬이 서버 버전에서 이어진 것이면 로컬(아직 못 올린 진행)을 지키고, 버전이 다르면 서버가 이긴다', async () => {
    const device = memory();
    const account = scopedStorage(device, 'A');
    account.setItem(SAVE_KEY, stateText(500));
    account.setItem('monosapa.sync.version', '3');
    mockFetch({ status: 200, body: { save: { state: { coins: 7 }, version: 3, savedAt: T0 } } });
    await reconcileOnBoot(account, device, 'A');
    expect(JSON.parse(account.getItem(SAVE_KEY)!).coins).toBe(500);

    mockFetch({ status: 200, body: { save: { state: { coins: 7 }, version: 4, savedAt: T0 } } });
    await reconcileOnBoot(account, device, 'A');
    expect(JSON.parse(account.getItem(SAVE_KEY)!)).toEqual({ coins: 7 });
    expect(account.getItem('monosapa.sync.version')).toBe('4');
  });

  it('서버에 저장이 없으면 이 기기의 예전 저장을 처음 로그인한 계정 하나만 이어받는다', async () => {
    const device = memory();
    device.setItem(SAVE_KEY, stateText(123));
    mockFetch({ status: 200, body: { save: null } }, { status: 200, body: { save: null } });
    const a = scopedStorage(device, 'A');
    await reconcileOnBoot(a, device, 'A');
    expect(JSON.parse(a.getItem(SAVE_KEY)!).coins).toBe(123);
    expect(a.getItem('monosapa.sync.version')).toBe('0');

    const b = scopedStorage(device, 'B');
    await reconcileOnBoot(b, device, 'B');
    expect(b.getItem(SAVE_KEY)).toBeNull();
  });

  it('정식 출시 초기화: 서버 저장 세대가 올라갔으면 이 기기의 옛 진행(저장·백업·버전)과 기기 저장 이어받기를 버린다', async () => {
    const device = memory();
    device.setItem(SAVE_KEY, stateText(777)); // 계정 저장이 생기기 전의 기기 저장
    const account = scopedStorage(device, 'A');
    account.setItem(SAVE_KEY, stateText(500));
    account.setItem('monosapa.save.backup', stateText(400));
    account.setItem('monosapa.sync.version', '9');
    mockFetch({ status: 200, body: { save: null, epoch: 1 } });
    await reconcileOnBoot(account, device, 'A');
    expect(account.getItem(SAVE_KEY)).toBeNull(); // 되살아나면 초기화가 무효가 된다
    expect(account.getItem('monosapa.save.backup')).toBeNull();
    expect(account.getItem('monosapa.sync.version')).toBe('0');
    expect(account.getItem('monosapa.sync.epoch')).toBe('1');
    expect(device.getItem('monosapa.save.adoptedBy')).toBe('reset'); // 기기 저장이 새 게임으로 넘어오지 못한다
  });

  it('세대가 같으면 로컬을 지키고, 서버가 세대를 알려 주지 않아도 그대로 동작한다', async () => {
    const device = memory();
    const account = scopedStorage(device, 'A');
    account.setItem(SAVE_KEY, stateText(500));
    account.setItem('monosapa.sync.version', '3');
    account.setItem('monosapa.sync.epoch', '1');
    mockFetch({ status: 200, body: { save: { state: { coins: 7 }, version: 3, savedAt: T0 }, epoch: 1 } });
    await reconcileOnBoot(account, device, 'A');
    expect(JSON.parse(account.getItem(SAVE_KEY)!).coins).toBe(500);

    mockFetch({ status: 200, body: { save: { state: { coins: 7 }, version: 3, savedAt: T0 } } });
    await reconcileOnBoot(account, device, 'A');
    expect(JSON.parse(account.getItem(SAVE_KEY)!).coins).toBe(500);
  });

  it('세대가 올라간 뒤 다른 기기가 이미 새 저장을 올렸으면 그 저장을 따른다', async () => {
    const device = memory();
    const account = scopedStorage(device, 'A');
    account.setItem(SAVE_KEY, stateText(500));
    account.setItem('monosapa.sync.version', '3');
    mockFetch({ status: 200, body: { save: { state: { coins: 7 }, version: 3, savedAt: T0 }, epoch: 1 } });
    await reconcileOnBoot(account, device, 'A');
    expect(JSON.parse(account.getItem(SAVE_KEY)!)).toEqual({ coins: 7 });
    expect(account.getItem('monosapa.sync.epoch')).toBe('1');
  });

  it('서버에 닿지 않으면(오류·네트워크 실패) 로컬을 그대로 둔다', async () => {
    const device = memory();
    const account = scopedStorage(device, 'A');
    account.setItem(SAVE_KEY, stateText(5));
    mockFetch({ status: 502 });
    await reconcileOnBoot(account, device, 'A');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await reconcileOnBoot(account, device, 'A');
    expect(JSON.parse(account.getItem(SAVE_KEY)!).coins).toBe(5);
  });
});

describe('CloudSync', () => {
  beforeEach(() => vi.useFakeTimers());

  it('저장이 잦아도 최소 간격마다 가장 최근 상태 하나만 올리고, 성공하면 버전을 기억한다', async () => {
    const calls = mockFetch({ status: 200, body: { version: 1, savedAt: 0 } }, { status: 200, body: { version: 2, savedAt: 0 } });
    const storage = memory();
    const sync = new CloudSync();
    sync.start(storage, () => {});
    sync.submit({ n: 1 });
    sync.submit({ n: 2 });
    sync.submit({ n: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { state: { n: 3 }, baseVersion: 0 } });
    expect(storage.getItem('monosapa.sync.version')).toBe('1');

    sync.submit({ n: 4 });
    await vi.advanceTimersByTimeAsync(PUSH_MIN_INTERVAL_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ state: { n: 4 }, baseVersion: 1 });
  });

  it('immediate 는 간격을 기다리지 않고 바로 보낸다', async () => {
    const calls = mockFetch();
    const sync = new CloudSync();
    sync.start(memory(), () => {});
    sync.submit({ n: 1 });
    await vi.advanceTimersByTimeAsync(0);
    sync.submit({ n: 2 }, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
  });

  it('충돌(409)이면 서버 저장을 넘겨 주고 더 보내지 않는다', async () => {
    mockFetch({ status: 409, body: { save: { state: { coins: 9 }, version: 5, savedAt: T0 } } });
    const onConflict = vi.fn();
    const sync = new CloudSync();
    sync.start(memory(), onConflict);
    sync.submit({ n: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onConflict).toHaveBeenCalledWith({ state: { coins: 9 }, version: 5, savedAt: T0 });
    await vi.advanceTimersByTimeAsync(PUSH_MIN_INTERVAL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('저장을 올릴 때 이 기기가 아는 저장 세대를 함께 보낸다', async () => {
    const calls = mockFetch({ status: 200, body: { version: 1, savedAt: 0 } });
    const storage = memory();
    storage.setItem('monosapa.sync.epoch', '2');
    const sync = new CloudSync();
    sync.start(storage, () => {});
    sync.submit({ n: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[0].body).toMatchObject({ epoch: 2 });
    const fresh = mockFetch({ status: 200, body: { version: 1, savedAt: 0 } });
    const other = new CloudSync();
    other.start(memory(), () => {});
    other.submit({ n: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh[0].body).toMatchObject({ epoch: 0 }); // 기억이 없으면 0
  });

  it('서버가 초기화됐다고(409 reset) 하면 올리지 않고 알려 준다. 충돌 처리와는 다르다', async () => {
    mockFetch({ status: 409, body: { reset: true, epoch: 3, message: '초기화' } });
    const onConflict = vi.fn();
    const onReset = vi.fn();
    const sync = new CloudSync();
    sync.start(memory(), onConflict, onReset);
    sync.submit({ n: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onReset).toHaveBeenCalledWith(3);
    expect(onConflict).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PUSH_MIN_INTERVAL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(1); // 옛 진행을 계속 올리려 하지 않는다
  });

  it('resetLocalProgress 는 저장·백업·손상본·버전을 지우고 세대를 기록한다', () => {
    const storage = memory();
    for (const k of [SAVE_KEY, 'monosapa.save.backup', 'monosapa.save.corrupt', 'monosapa.sync.version']) storage.setItem(k, 'x');
    resetLocalProgress(storage, 4);
    expect([...storage.data.keys()]).toEqual(['monosapa.sync.epoch']);
    expect(storage.getItem('monosapa.sync.epoch')).toBe('4');
  });

  it('서버 오류면 같은 상태를 간격 뒤에 다시 보낸다', async () => {
    const calls = mockFetch({ status: 502 }, { status: 200, body: { version: 1, savedAt: 0 } });
    const sync = new CloudSync();
    sync.start(memory(), () => {});
    sync.submit({ n: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PUSH_MIN_INTERVAL_MS);
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ state: { n: 1 } });
  });

  it('stop 이후에는 아무것도 보내지 않는다', async () => {
    const calls = mockFetch();
    const sync = new CloudSync();
    sync.start(memory(), () => {});
    sync.stop();
    sync.submit({ n: 1 }, true);
    await vi.advanceTimersByTimeAsync(PUSH_MIN_INTERVAL_MS);
    expect(calls).toHaveLength(0);
  });
});
