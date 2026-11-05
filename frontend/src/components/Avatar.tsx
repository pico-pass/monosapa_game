import { ASSETS } from '../assets';

export type AvatarKind = 'google' | 'normal' | 'dark';

interface Props {
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  /** 크기 클래스(기본은 랭킹 줄의 작은 동그라미) */
  className?: string;
}

const FALLBACK: Record<'normal' | 'dark', string> = { normal: '🎤', dark: '🌑' };

/**
 * 프로필 사진. 프로필 설정에서 고른 종류에 따라 구글 계정 사진 또는 일반·어둠 모노사파 그림이고,
 * 이미지가 없으면 이름 첫 글자(또는 이모지)로 대신한다.
 */
export function Avatar({ name, picture, avatar, className = 'rank-avatar' }: Props) {
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
