/** 두 계정 ID를 순서와 상관없이 같은 문자열 하나로 묶는다(친구 관계·개인채팅 방의 키). */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
