/* 배포된 최신 화면과 지금 열린 화면이 다른지 확인한다. index.html 은 캐시 헤더가 없어 브라우저가 옛 파일을 한동안 그대로 쓸 수 있다. */

const BUNDLE = /assets\/index-[\w-]+\.js/;
const RELOAD_FLAG = 'monosapa:update-reload';

/** 지금 열린 화면의 번들 경로. 개발 서버(해시 없음)에서는 null. */
export function runningBundle(doc: Document = document): string | null {
  for (const el of Array.from(doc.querySelectorAll('script[type="module"][src]'))) {
    const m = BUNDLE.exec(el.getAttribute('src') ?? '');
    if (m) return m[0];
  }
  return null;
}

/** 서버가 지금 내려주는 index.html 의 번들 경로. 네트워크 실패면 null. */
export async function liveBundle(): Promise<string | null> {
  try {
    // 'reload': 캐시를 건너뛰고 받아 오고, 받은 걸로 캐시도 새로 채운다. (뒤따르는 새로고침이 최신 index.html 을 쓰게 하려는 것)
    const res = await fetch('/', { cache: 'reload', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return BUNDLE.exec(await res.text())?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 시작할 때 한 번 확인해 옛 화면이면 새로고침한다. 같은 최신 번들로는 이 탭에서 한 번만 시도해, 새로고침 뒤에도 달라 보이면
 * (캐시·DNS 문제 등) 무한 반복하지 않는다. 새로고침했으면 true.
 */
export async function reloadIfOutdated(): Promise<boolean> {
  const mine = runningBundle();
  if (!mine) return false;
  const live = await liveBundle();
  if (live === null || live === mine) return false;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === live) return false;
    sessionStorage.setItem(RELOAD_FLAG, live);
  } catch {
    // 저장소를 못 쓰면 반복 방지 표시를 못 하므로 새로고침하지 않는다.
    return false;
  }
  location.reload();
  return true;
}
