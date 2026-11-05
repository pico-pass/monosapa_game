import { displayNameOf, type Avatar } from './profile.js';
import { seenAgoMs } from './presence.js';
import type { UserDocument } from './user.schema.js';

/** 다른 사람에게 보여 주는 계정의 가장 작은 모습. 이메일은 담지 않는다. */
export class PersonDto {
  uid!: string;
  /** 닉네임이 있으면 닉네임, 없으면 구글 이름 */
  name!: string;
  /** 구글 프로필 사진 주소(없으면 null). avatar 가 google 일 때만 쓴다. */
  picture!: string | null;
  avatar!: Avatar;
  bio!: string | null;
  /** 마지막 접속이 몇 ms 전인지(모르면 null) */
  seenAgoMs!: number | null;
}

/** `User.find(..., PERSON_FIELDS)` 로 읽어 오는 필드 */
export const PERSON_FIELDS = 'name nickname picture avatar bio lastSeenAt lastLoginAt';

export const toPerson = (u: Pick<UserDocument, '_id' | 'name' | 'nickname' | 'picture' | 'avatar' | 'bio' | 'lastSeenAt' | 'lastLoginAt'>, now = Date.now()): PersonDto => ({
  uid: String(u._id),
  name: displayNameOf(u),
  picture: u.picture ?? null,
  avatar: u.avatar ?? 'google',
  bio: u.bio ?? null,
  seenAgoMs: seenAgoMs(u, now),
});
