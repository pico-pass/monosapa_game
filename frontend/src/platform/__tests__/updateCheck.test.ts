import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveBundle, reloadIfOutdated, runningBundle } from '../updateCheck';

const page = (bundle: string) => `<!doctype html><html><head><script type="module" crossorigin src="./${bundle}"></script></head><body></body></html>`;

/** 열린 화면 대역: script 태그의 src 목록만 흉내 낸다. (테스트 환경이 node 라 DOM 이 없다.) */
function openPage(bundle: string | null) {
  const scripts = bundle ? [{ getAttribute: (n: string) => (n === 'src' ? `./${bundle}` : null) }] : [{ getAttribute: () => '/src/main.tsx' }];
  vi.stubGlobal('document', { querySelectorAll: () => scripts });
}

/** fetch 대역: 서버가 내려주는 index.html 본문을 정한다. */
function mockLive(html: string | null, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (html === null) throw new TypeError('network');
    return { ok: status < 400, status, text: async () => html } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  const data = new Map<string, string>();
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
});

afterEach(() => vi.unstubAllGlobals());

describe('runningBundle', () => {
  it('열린 화면의 번들 경로를 읽는다', () => {
    openPage('assets/index-Cw0Rvo5m.js');
    expect(runningBundle()).toBe('assets/index-Cw0Rvo5m.js');
  });

  it('해시 번들이 없으면(개발 서버) null', () => {
    openPage(null);
    expect(runningBundle()).toBeNull();
  });
});

describe('liveBundle', () => {
  it('캐시를 건너뛰고 index.html 을 받아 번들 경로를 돌려준다', async () => {
    const fn = mockLive(page('assets/index-New123.js'));
    expect(await liveBundle()).toBe('assets/index-New123.js');
    expect(fn.mock.calls[0][1]?.cache).toBe('reload');
  });

  it('네트워크 실패·오류 응답·번들이 안 보이면 null', async () => {
    mockLive(null);
    expect(await liveBundle()).toBeNull();
    mockLive('', 503);
    expect(await liveBundle()).toBeNull();
    mockLive('<html></html>');
    expect(await liveBundle()).toBeNull();
  });
});

describe('reloadIfOutdated', () => {
  it('최신 번들과 다르면 새로고침한다', async () => {
    openPage('assets/index-Old.js');
    mockLive(page('assets/index-New.js'));
    expect(await reloadIfOutdated()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('같으면 새로고침하지 않는다', async () => {
    openPage('assets/index-Same.js');
    mockLive(page('assets/index-Same.js'));
    expect(await reloadIfOutdated()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('확인하지 못하면(서버에 못 닿음) 그대로 둔다', async () => {
    openPage('assets/index-Old.js');
    mockLive(null);
    expect(await reloadIfOutdated()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('개발 서버에서는 요청도 하지 않는다', async () => {
    openPage(null);
    const fn = mockLive(page('assets/index-New.js'));
    expect(await reloadIfOutdated()).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('같은 최신 번들로는 이 탭에서 한 번만 새로고침한다(무한 반복 방지)', async () => {
    openPage('assets/index-Old.js');
    mockLive(page('assets/index-New.js'));
    expect(await reloadIfOutdated()).toBe(true);
    expect(await reloadIfOutdated()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // 더 새로운 배포가 또 나오면 다시 시도한다
    mockLive(page('assets/index-Newer.js'));
    expect(await reloadIfOutdated()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
