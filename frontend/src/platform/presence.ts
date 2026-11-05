/*
 * 접속 신호: 로그인한 채 화면을 보고 있는 동안 60초마다 서버에 보낸다. 서버가 마지막 신호 시각을 기억해
 * 다른 사람의 프로필(랭킹·챗방)에 「접속 중」·「n분 전 접속」으로 보여 준다. 실패해도 게임에는 영향이 없다.
 */
const PING_MS = 60_000;

export function startPresence(): () => void {
  const ping = () => {
    if (document.visibilityState !== 'visible') return;
    fetch('/api/auth/ping', { method: 'POST', signal: AbortSignal.timeout(8000), keepalive: true }).catch(() => {});
  };
  ping();
  const id = setInterval(ping, PING_MS);
  document.addEventListener('visibilitychange', ping);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', ping);
  };
}
