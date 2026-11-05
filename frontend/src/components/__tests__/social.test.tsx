import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../../assets';
import { friendBadge, mailBadge, socialTotal, type SocialSummary } from '../../store/socialStore';
import { Avatar } from '../Avatar';

const html = (props: Parameters<typeof Avatar>[0]) => renderToString(createElement(Avatar, props));

describe('프로필 사진', () => {
  it('구글 사진을 고르면 사진 주소를 쓰고, 사진이 없으면 이름 첫 글자를 쓴다', () => {
    expect(html({ name: '사파', picture: 'https://x/y.png', avatar: 'google' })).toContain('https://x/y.png');
    const none = html({ name: '사파', picture: null, avatar: 'google' });
    expect(none).toContain('rank-avatar-none');
    expect(none).toContain('사');
  });

  it('일반·어둠 모노사파를 고르면 구글 사진이 있어도 캐릭터 그림을 쓴다', () => {
    const normal = html({ name: '사파', picture: 'https://x/y.png', avatar: 'normal' });
    expect(normal).toContain(ASSETS.characters.normal);
    expect(normal).not.toContain('https://x/y.png');
    expect(html({ name: '사파', picture: null, avatar: 'dark' })).toContain(ASSETS.characters.dark);
  });

  it('크기 클래스를 바꿀 수 있다', () => {
    expect(html({ name: '사파', picture: null, avatar: 'google', className: 'avatar-lg' })).toContain('avatar-lg');
  });
});

describe('새 소식 알림 점', () => {
  const s = (patch: Partial<SocialSummary>): SocialSummary => ({ mailUnread: 0, mailClaimable: 0, friendRequests: 0, dmUnread: 0, ...patch });

  it('우편함은 안 읽은 우편과 받을 다이아 우편 중 큰 쪽이다', () => {
    expect(mailBadge(s({ mailUnread: 3, mailClaimable: 1 }))).toBe(3);
    expect(mailBadge(s({ mailUnread: 0, mailClaimable: 2 }))).toBe(2);
    expect(mailBadge(s({}))).toBe(0);
  });

  it('친구는 받은 요청과 안 읽은 메시지의 합이고, 더보기 점은 둘을 더한다', () => {
    expect(friendBadge(s({ friendRequests: 2, dmUnread: 5 }))).toBe(7);
    expect(socialTotal(s({ mailUnread: 1, friendRequests: 2, dmUnread: 5 }))).toBe(8);
    expect(socialTotal(s({}))).toBe(0);
  });
});
