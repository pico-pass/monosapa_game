import { BACKUP_KEY, CORRUPT_KEY, SAVE_KEY, type StorageLike } from '../game/persistence';

/*
 * 계정 저장(서버)과의 동기화. 게임은 계속 localStorage 에 먼저 저장하고(동기, 항상 성공 시도),
 * 이 모듈이 그 결과를 서버로 올린다. 서버에 닿지 않아도 게임은 멈추지 않고, 닿으면 다음 저장 때 따라잡는다.
 * 게임 규칙·검증은 여기 없다. 서버 저장도 불러올 때 persistence.ts 의 검증을 그대로 거친다.
 */

export interface RemoteSave {
  state: unknown;
  version: number;
  savedAt: number;
}

const VERSION_KEY = 'monosapa.sync.version';
/**
 * 저장 세대. 정식 출시 같은 전체 초기화마다 서버가 올린다. 이 기기의 세대가 서버와 다르면 로컬 저장은 초기화 전 진행이라 버린다
 * (버리지 않으면 서버로 올라가 초기화가 되돌려진다). 서버도 옛 세대의 저장은 받지 않는다.
 */
const EPOCH_KEY = 'monosapa.sync.epoch';
/** 계정 전용 저장이 생기기 전(이 기기에만 있던) 진행 데이터를 처음 로그인한 계정 하나에 넘겼는지 표시한다. */
const ADOPTED_KEY = 'monosapa.save.adoptedBy';
const TIMEOUT_MS = 8000;
/** 서버로 올리는 최소 간격. 로컬 저장은 이보다 자주 일어나도 된다. */
export const PUSH_MIN_INTERVAL_MS = 10_000;

/** 계정마다 로컬 저장 키가 겹치지 않게 접두사를 붙인다. (같은 브라우저를 여러 계정이 써도 진행이 섞이지 않는다) */
export function scopedStorage(base: StorageLike, userId: string): StorageLike {
  const k = (key: string) => `${userId}:${key}`;
  return { getItem: (key) => base.getItem(k(key)), setItem: (key, v) => base.setItem(k(key), v), removeItem: (key) => base.removeItem(k(key)) };
}

function readVersion(storage: StorageLike): number {
  const n = Number(storage.getItem(VERSION_KEY));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
function readEpoch(storage: StorageLike): number {
  const n = Number(storage.getItem(EPOCH_KEY));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** 초기화 전 로컬 진행(저장·백업·손상본·서버 버전)을 지우고 새 세대를 기록한다. */
export function resetLocalProgress(storage: StorageLike, epoch: number): void {
  for (const key of [SAVE_KEY, BACKUP_KEY, CORRUPT_KEY, VERSION_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      /* 못 지우면 다음에 다시 시도된다. 세대가 기록되지 않으므로 다시 지우려 한다. */
      return;
    }
  }
  try {
    storage.setItem(EPOCH_KEY, String(epoch));
  } catch {
    /* 세대를 기록하지 못하면 다음 시작 때 다시 지운다(서버 저장이 있으면 그걸 따른다). */
  }
}

function writeVersion(storage: StorageLike, version: number): void {
  try {
    storage.setItem(VERSION_KEY, String(version));
  } catch {
    /* 저장소가 막혔으면 버전을 기억하지 못할 뿐이다. 다음 불러오기 때 서버 저장을 따른다. */
  }
}

async function request(method: 'GET' | 'PUT', body?: unknown, keepalive = false): Promise<{ status: number; body: unknown }> {
  const res = await fetch('/api/saves/me', {
    method,
    keepalive,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

type Json = Record<string, unknown>;
const asRemote = (v: unknown): RemoteSave | null => {
  const s = v as Json | null;
  return s && typeof s.version === 'number' && typeof s.savedAt === 'number' && s.state !== undefined ? (s as unknown as RemoteSave) : null;
};

/**
 * 게임을 시작하기 전에 서버 저장과 로컬 저장을 맞춘다.
 * - 서버에 저장이 있고 로컬이 그 버전에서 이어진 것이면 로컬을 쓴다(아직 못 올린 진행이 있을 수 있다).
 * - 그 외에는 서버 저장으로 로컬을 덮어쓴다.
 * - 서버에 저장이 없으면 로컬을 쓰고, 이 기기에만 있던 예전 저장은 첫 로그인 계정이 이어받는다.
 * - 서버에 닿지 않으면 로컬 그대로 시작한다.
 */
export async function reconcileOnBoot(account: StorageLike, device: StorageLike, userId: string): Promise<void> {
  let remote: RemoteSave | null;
  let epoch: number | null;
  try {
    const r = await request('GET');
    if (r.status !== 200) return;
    remote = asRemote((r.body as Json | null)?.save);
    const e = (r.body as Json | null)?.epoch;
    epoch = typeof e === 'number' && Number.isInteger(e) && e >= 0 ? e : null;
  } catch {
    return;
  }

  // 서버가 초기화된 뒤(세대가 올라감)의 첫 시작: 이 기기에 남은 초기화 전 진행은 버린다.
  if (epoch !== null && epoch !== readEpoch(account)) {
    resetLocalProgress(account, epoch);
    // 계정 저장이 생기기 전의 기기 저장(옛 진행)이 새 게임으로 넘어오지 못하게 한다.
    try {
      if (device.getItem(ADOPTED_KEY) === null) device.setItem(ADOPTED_KEY, 'reset');
    } catch {
      /* 막혀 있으면 기기 저장이 없는 것과 같다 */
    }
  }

  if (remote) {
    const localAhead = account.getItem(SAVE_KEY) !== null && readVersion(account) === remote.version;
    if (!localAhead) {
      try {
        account.setItem(SAVE_KEY, JSON.stringify(remote.state));
      } catch {
        return;
      }
      writeVersion(account, remote.version);
    }
    return;
  }

  writeVersion(account, 0);
  if (account.getItem(SAVE_KEY) !== null) return;
  const legacy = device.getItem(SAVE_KEY);
  if (legacy !== null && device.getItem(ADOPTED_KEY) === null) {
    try {
      account.setItem(SAVE_KEY, legacy);
      device.setItem(ADOPTED_KEY, userId);
    } catch {
      /* 못 옮기면 새 게임으로 시작한다. 예전 저장은 그대로 남는다. */
    }
  }
}

export type PushResult = { status: 'ok'; version: number } | { status: 'conflict'; remote: RemoteSave } | { status: 'reset'; epoch: number } | { status: 'error' };

/** 로컬 저장이 끝날 때마다 불러 준다. 한 번에 하나만 보내고, 보내는 동안 쌓인 저장은 가장 최근 것 하나로 합친다. */
export class CloudSync {
  private storage: StorageLike | null = null;
  private onConflict: (remote: RemoteSave) => void = () => {};
  private onReset: (epoch: number) => void = () => {};
  private writerId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  private latest: unknown = null;
  private dirty = false;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPushAt = 0;
  private stopped = true;

  /** 로그인한 계정의 로컬 저장소를 연결하고 동기화를 시작한다. */
  start(storage: StorageLike, onConflict: (remote: RemoteSave) => void, onReset: (epoch: number) => void = () => {}): void {
    this.storage = storage;
    this.onConflict = onConflict;
    this.onReset = onReset;
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
    this.dirty = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 방금 저장한 상태를 올릴 대상으로 등록한다. immediate 는 탭을 숨기거나 닫을 때처럼 지금 보내야 할 때. */
  submit(state: unknown, immediate = false): void {
    if (this.stopped) return;
    this.latest = state;
    this.dirty = true;
    if (immediate) void this.flush(true);
    else this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.inFlight) return;
    const wait = Math.max(0, this.lastPushAt + PUSH_MIN_INTERVAL_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush(false);
    }, wait);
  }

  private async flush(keepalive: boolean): Promise<void> {
    if (this.stopped || this.inFlight || !this.dirty || !this.storage) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const storage = this.storage;
    const state = this.latest;
    this.dirty = false;
    this.inFlight = true;
    this.lastPushAt = Date.now();
    let result: PushResult;
    try {
      result = await this.push(storage, state, keepalive);
    } catch {
      result = { status: 'error' };
    }
    this.inFlight = false;
    if (this.stopped) return;
    if (result.status === 'conflict') {
      this.dirty = false;
      this.onConflict(result.remote);
      return;
    }
    if (result.status === 'reset') {
      // 서버가 초기화됐다. 이 기기의 진행은 옛 세대라 올리지 않고 버린다.
      this.dirty = false;
      this.onReset(result.epoch);
      return;
    }
    if (result.status === 'error') this.dirty = true; // 다음 저장 때, 없으면 일정 시간 뒤 다시 보낸다.
    if (this.dirty) this.schedule();
  }

  private async push(storage: StorageLike, state: unknown, keepalive: boolean): Promise<PushResult> {
    const r = await request('PUT', { state, baseVersion: readVersion(storage), writerId: this.writerId, epoch: readEpoch(storage) }, keepalive);
    if (r.status === 200) {
      const version = (r.body as Json | null)?.version;
      if (typeof version !== 'number') return { status: 'error' };
      writeVersion(storage, version);
      return { status: 'ok', version };
    }
    if (r.status === 409) {
      const body = r.body as Json | null;
      if (body?.reset === true && typeof body.epoch === 'number' && Number.isInteger(body.epoch)) return { status: 'reset', epoch: body.epoch };
      const remote = asRemote(body?.save);
      if (remote) return { status: 'conflict', remote };
    }
    return { status: 'error' };
  }

  /** 아직 못 올린 저장이 있으면 올릴 때까지 기다린다. (로그아웃 전에 쓴다. 서버에 닿지 않으면 몇 번 시도하고 포기한다) */
  async drain(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      while (this.inFlight) await new Promise((r) => setTimeout(r, 50));
      if (this.stopped || !this.dirty) return;
      await this.flush(false);
    }
  }

  /** 충돌로 서버 저장을 받아들인 뒤, 그 버전을 기준으로 이어가도록 기록한다. */
  adopt(version: number): void {
    if (this.storage) writeVersion(this.storage, version);
  }
}
