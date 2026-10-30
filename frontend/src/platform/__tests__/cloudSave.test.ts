import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_KEY, createInitialState, type StorageLike } from '../../game/persistence';
import { CloudSync, PUSH_MIN_INTERVAL_MS, reconcileOnBoot, scopedStorage } from '../cloudSave';

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
