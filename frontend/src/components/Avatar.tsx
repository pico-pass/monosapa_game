import { ASSETS } from '../assets';
import type { CostumeId } from '../game/types';

/** 구글 계정 사진 · 일반/어둠 모노사파 · 상점에서 산 코스튬(`costume-{코스튬 ID}`) */
export type AvatarKind = 'google' | 'normal' | 'dark' | `costume-${CostumeId}`;

interface Props {
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  /** 크기 클래스(기본은 랭킹 줄의 작은 동그라미) */
  className?: string;
}

const FALLBACK: Record<'normal' | 'dark', string> = { normal: '🎤', dark: '🌑' };
const COSTUME_PREFIX = 'costume-';

/** 프로필 사진 값에서 코스튬 ID를 꺼낸다. 코스튬이 아니거나 이미지를 모르는 ID(서버가 더 새로울 때)면 null. */
export const costumeOfAvatar = (avatar: string): CostumeId | null => {
  if (!avatar.startsWith(COSTUME_PREFIX)) return null;
  const id = avatar.slice(COSTUME_PREFIX.length) as CostumeId;
  return ASSETS.costumes[id] ? id : null;
};

/**
 * 프로필 사진. 프로필 설정에서 고른 종류에 따라 구글 계정 사진, 일반·어둠 모노사파 그림, 또는 코스튬 그림이고,
 * 이미지가 없으면 이름 첫 글자(또는 이모지)로 대신한다.
 */
export function Avatar({ name, picture, avatar, className = 'rank-avatar' }: Props) {
  const costume = costumeOfAvatar(avatar);
  if (costume) return <img className={`${className} avatar-char`} src={ASSETS.costumes[costume]} alt="" draggable={false} width={32} height={32} loading="lazy" />;
  if (avatar === 'normal' || avatar === 'dark') {
    const src = ASSETS.characters[avatar];
    if (src) return <img className={`${className} avatar-char`} src={src} alt="" draggable={false} width={32} height={32} loading="lazy" />;
    return (
      <span className={`${className} rank-avatar-none`} aria-hidden>
        {FALLBACK[avatar]}
      </span>
    );
  }
  if (picture) return <img className={className} src={picture} alt="" referrerPolicy="no-referrer" width={32} height={32} loading="lazy" />;
  return (
    <span className={`${className} rank-avatar-none`} aria-hidden>
      {[...name][0] ?? '?'}
    </span>
  );
}
