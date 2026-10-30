/* 로그인한 계정의 서버 API(챗방·문의함) 호출 도우미. 세션 쿠키는 같은 오리진이라 자동으로 붙는다. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8000;

function messageOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = (data as { message?: unknown }).message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}

export async function api<T = void>(path: string, opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = opts;
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback = res.status === 401 ? '로그인이 필요해요.' : res.status === 429 ? '너무 빨리 보내고 있어요. 잠시 뒤에 다시 해 주세요.' : '요청에 실패했어요. 잠시 뒤에 다시 해 주세요.';
    throw new ApiError(res.status, messageOf(data) ?? fallback);
  }
  return data as T;
}

export const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : '서버에 연결하지 못했어요.');
