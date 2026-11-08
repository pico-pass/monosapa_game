import { randomInt } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';

/*
 * 프로필 설정과 표시에 쓰는 순수 규칙. 닉네임·소개의 길이, 보여 줄 이름, 친구 코드, 제재(채팅 제한) 확인.
 */

/**
 * 코스튬 ID. 프런트 `game/types.ts`의 `CostumeId`(= `balance.ts`의 `BALANCE.shop.costumes` 키)와 같아야 한다.
 * 서버는 게임 저장을 검증하지 않으므로 산 코스튬인지는 확인하지 못하고(프런트가 가진 코스튬만 고르게 한다) 모양만 본다.
 */
export const COSTUME_IDS = [
  'jirai', 'hype', 'angry', 'maid', 'bunny', 'fallen', 'bear', 'nun', 'vampire', 'butler', 'bride',
  'dbunny', 'band', 'king', 'milk', 'dbear', 'postman', 'cultist', 'clown', 'dnurse', 'dbride',
] as const;
export type CostumeId = (typeof COSTUME_IDS)[number];

const BASE_AVATARS = ['google', 'normal', 'dark'] as const;
/** 프로필 사진: 구글 계정 사진, 일반·어둠 모노사파, 또는 `costume-{코스튬 ID}`(상점에서 산 코스튬) */
export type Avatar = (typeof BASE_AVATARS)[number] | `costume-${CostumeId}`;
/** 고를 수 있는 프로필 사진 값 전부 */
export const AVATARS: readonly Avatar[] = [...BASE_AVATARS, ...COSTUME_IDS.map((id) => `costume-${id}` as const)];
export const isAvatar = (v: unknown): v is Avatar => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;
export const BIO_MAX = 40;

/** 닉네임이 있으면 닉네임, 없으면 구글 이름, 그것도 없으면 '익명' */
export const displayNameOf = (u: { nickname?: string | null; name?: string | null }): string => u.nickname?.trim() || u.name?.trim() || '익명';

/** 헷갈리는 글자(0/O, 1/I)를 뺀 친구 코드 글자 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const FRIEND_CODE_LENGTH = 8;

export function newFriendCode(): string {
  let code = '';
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

/** 사람이 친 코드를 정리한다(공백 제거, 대문자). 형태가 맞지 않으면 null. */
export function normalizeFriendCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return code.length === FRIEND_CODE_LENGTH && [...code].every((c) => CODE_CHARS.includes(c)) ? code : null;
}

/** 제재 중이면 이 시각(ms), 아니면 null */
export const mutedUntilMs = (u: { mutedUntil?: Date | null }, now = Date.now()): number | null => {
  const t = u.mutedUntil ? u.mutedUntil.getTime() : 0;
  return t > now ? t : null;
};

/** 제재 중이면 막는다. `what`은 막힌 행동 이름(예: '챗방에 글을 쓸'). */
export function assertNotMuted(user: { mutedUntil: number | null }, what: string, now = Date.now()): void {
  if (user.mutedUntil && user.mutedUntil > now) {
    const until = new Date(user.mutedUntil + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
    throw new ForbiddenException(`이용이 제한된 계정이라 ${what} 수 없어요. (한국 시간 ${until}까지)`);
  }
}
