import { setSample, setWorkSfx, type Sample } from '../audio/sampler';

/*
 * 샘플러 녹음의 기기 저장소. 녹음은 IndexedDB에, "작업하기 효과음으로 쓰기" 선택은 localStorage에 둔다.
 * 둘 다 이 기기 안에만 있고 서버·게임 저장으로 올라가지 않는다. 막혀 있으면 메모리에만 두고 새로고침하면 사라진다.
 */

const DB = 'monosapa-sampler';
const STORE = 'samples';
const memory = new Map<string, { rate: number; data: ArrayBuffer }>();
const flagKey = (account: string) => `monosapa.sampler.workSfx:${account}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('indexedDB 없음'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSample(account: string, s: Sample): Promise<void> {
  // 버퍼를 복사해서 저장한다: 원본 배열은 재생에 계속 쓰인다.
  const record = { rate: s.sampleRate, data: s.data.slice().buffer as ArrayBuffer };
  memory.set(account, record);
  try {
    await idb('readwrite', (st) => st.put(record, account));
  } catch {
    /* 저장소가 막혀 있으면 메모리에만 둔다 */
  }
}

export async function loadSample(account: string): Promise<Sample | null> {
  let record = memory.get(account) ?? null;
  if (!record) {
    try {
      record = ((await idb('readonly', (st) => st.get(account))) as { rate: number; data: ArrayBuffer } | undefined) ?? null;
    } catch {
      record = null;
    }
  }
  if (!record || !(record.data instanceof ArrayBuffer) || !Number.isFinite(record.rate)) return null;
  return { data: new Float32Array(record.data), sampleRate: record.rate };
}

export async function deleteSample(account: string): Promise<void> {
  memory.delete(account);
  try {
    await idb('readwrite', (st) => st.delete(account));
  } catch {
    /* 무시 */
  }
}

export function readWorkSfx(account: string): boolean {
  try {
    return window.localStorage.getItem(flagKey(account)) === '1';
  } catch {
    return false;
  }
}

export function writeWorkSfx(account: string, on: boolean): void {
  setWorkSfx(on);
  try {
    window.localStorage.setItem(flagKey(account), on ? '1' : '0');
  } catch {
    /* 무시 */
  }
}

/** 로그인한 계정의 샘플과 설정을 불러와 오디오 모듈에 올린다. 게임을 시작할 때 한 번 부른다. */
export async function initSampler(account: string): Promise<void> {
  setWorkSfx(readWorkSfx(account));
  setSample(await loadSample(account));
}
