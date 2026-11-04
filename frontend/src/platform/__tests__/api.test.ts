import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorText } from '../api';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('읽기 요청은 네트워크 실패 뒤 한 번 더 시도한다', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(ok({ messages: [] }));
    vi.stubGlobal('fetch', fn);
    expect(await api('chat')).toEqual({ messages: [] });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('두 번 다 실패하면 연결 오류 문구', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fn);
    const err = await api('chat').catch((e: unknown) => e);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(errorText(err)).toBe('서버에 연결하지 못했어요.');
  });

  it('보내기·삭제는 실패해도 다시 보내지 않는다(두 번 실행 방지)', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fn);
    await expect(api('chat', { method: 'POST', body: { text: 'hi' } })).rejects.toThrow();
    await expect(api('chat/1', { method: 'DELETE' })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('서버가 준 오류 응답은 다시 시도하지 않고 그 문구를 쓴다', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: '로그인이 필요해요.' }) } as Response);
    vi.stubGlobal('fetch', fn);
    const err = await api('chat').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(errorText(err)).toBe('로그인이 필요해요.');
  });
});
