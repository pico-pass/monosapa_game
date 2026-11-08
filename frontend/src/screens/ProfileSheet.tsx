import { useCallback, useEffect, useState } from 'react';
import { Avatar, type AvatarKind } from '../components/Avatar';
import { fmt } from '../components/format';
import { Modal } from '../components/Modal';
import { Presence } from '../components/parts';
import { COSTUME_IDS_OF } from '../game/balance';
import { COSTUME_TEXT } from '../game/content';
import type { CostumeId } from '../game/types';
import { api, errorText } from '../platform/api';
import { patchAuthUser } from '../store/authStore';
import { toast, useUi } from '../store/gameStore';
import { closeProfile, openDm, openReport, refreshSummary } from '../store/socialStore';

type Relation = 'self' | 'none' | 'friend' | 'outgoing' | 'incoming';

interface Profile {
  uid: string;
  name: string;
  picture: string | null;
  avatar: AvatarKind;
  bio: string | null;
  seenAgoMs: number | null;
  level: number;
  fans: number;
  towerBest: number;
  nurtureNormal: number;
  nurtureDark: number;
  joinedAt: number;
  relation: Relation;
  giftedToday: boolean;
  friendCode: string | null;
}

interface MyProfile {
  googleName: string | null;
  nickname: string | null;
  bio: string | null;
  avatar: AvatarKind;
  picture: string | null;
  name: string;
  friendCode: string | null;
  mutedUntil: number | null;
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;
export const BIO_MAX = 40;
const AVATAR_CHOICES: [AvatarKind, string][] = [
  ['google', '구글 사진'],
  ['normal', '일반 사파'],
  ['dark', '어둠 사파'],
];

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('ko-KR');

/** 사람의 프로필 창. 랭킹·챗방·친구 목록에서 열고, 내 프로필이면 설정(닉네임·한 줄 소개·프로필 사진)을 바꿀 수 있어요. */
export function ProfileSheet({ uid, edit }: { uid: string; edit: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(edit);

  const load = useCallback(async () => {
    try {
      setProfile(await api<Profile>(`profiles/${uid}`));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [uid]);

  useEffect(() => {
    setProfile(null);
    void load();
  }, [load]);

  return (
    <Modal title={editing ? '프로필 설정' : '프로필'} onClose={closeProfile}>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {!profile && !error && <p className="muted">불러오는 중…</p>}
      {profile && editing && (
        <ProfileEditor
          onDone={(saved) => {
            setEditing(false);
            if (saved) void load();
          }}
        />
      )}
      {profile && !editing && <ProfileView p={profile} reload={load} onEdit={() => setEditing(true)} />}
    </Modal>
  );
}

function ProfileView({ p, reload, onEdit }: { p: Profile; reload: () => Promise<void>; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const self = p.relation === 'self';

  /** 서버 요청 하나를 하고 프로필과 알림 개수를 새로 불러온다. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([reload(), refreshSummary()]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(p.friendCode ?? '');
      toast('친구 코드를 복사했어요.', 'good');
    } catch {
      toast('복사하지 못했어요. 코드를 직접 알려 주세요.', 'warn');
    }
  };

  return (
    <div className="pf">
      <div className="pf-head">
        <Avatar name={p.name} picture={p.picture} avatar={p.avatar} className="avatar-lg" />
        <div>
          <h3 className="pf-name">
            {p.name}
            {self && <em>나</em>}
          </h3>
          <Presence agoMs={self ? 0 : p.seenAgoMs} />
        </div>
      </div>
      <p className="pf-bio">{p.bio ?? <span className="muted">{self ? '한 줄 소개를 적어 보세요.' : '한 줄 소개가 없어요.'}</span>}</p>
      <ul className="pf-stats">
        <li>
          <b>Lv.{p.level}</b>
          <small>레벨</small>
        </li>
        <li>
          <b>{fmt(Math.floor(p.fans))}</b>
          <small>팬</small>
        </li>
        <li>
          <b>{p.towerBest > 0 ? `${p.towerBest}층` : '-'}</b>
          <small>무한의 계단</small>
        </li>
        <li>
          <b>
            {p.nurtureNormal} · {p.nurtureDark}
          </b>
          <small>육성 일반 · 어둠</small>
        </li>
      </ul>
      <small className="fineprint">가입 {fmtDate(p.joinedAt)}</small>

      {self && p.friendCode && (
        <div className="pf-code">
          <span>
            내 친구 코드 <b>{p.friendCode}</b>
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => void copyCode()}>
            복사
          </button>
        </div>
      )}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <div className="pf-actions">
        {self && (
          <button type="button" className="btn btn-primary" onClick={onEdit}>
            ✏️ 프로필 설정
          </button>
        )}
        {p.relation === 'none' && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => api('friends/requests', { method: 'POST', body: { uid: p.uid } }).then(() => undefined))}>
            🤝 친구 추가
          </button>
        )}
        {p.relation === 'outgoing' && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => api(`friends/requests/${p.uid}`, { method: 'DELETE' }))}>
            친구 요청 취소
          </button>
        )}
        {p.relation === 'incoming' && (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => api(`friends/requests/${p.uid}/accept`, { method: 'POST' }))}>
              ✅ 요청 수락
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => api(`friends/requests/${p.uid}`, { method: 'DELETE' }))}>
              거절
            </button>
          </>
        )}
        {p.relation === 'friend' && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => openDm(p.uid)}>
              💬 채팅
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || p.giftedToday}
              onClick={() =>
                void run(async () => {
                  await api('friends/' + p.uid + '/gift', { method: 'POST' });
                  toast('💎 선물을 보냈어요. 친구 우편함에 도착해요.', 'good');
                })
              }
            >
              {p.giftedToday ? '오늘 선물 보냄' : '💎 선물 보내기'}
            </button>
            {confirmRemove ? (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => api(`friends/${p.uid}`, { method: 'DELETE' }))}>
                정말 삭제
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(true)}>
                친구 삭제
              </button>
            )}
          </>
        )}
        {!self && (
          <button type="button" className="btn btn-ghost" onClick={() => openReport({ kind: 'profile', uid: p.uid, label: p.name })}>
            🚩 신고
          </button>
        )}
      </div>
      {confirmRemove && <small className="fineprint">친구를 삭제하면 둘 사이의 개인채팅 기록도 지워져요.</small>}
    </div>
  );
}

/** 상점에서 산 코스튬만 프로필 사진으로 고를 수 있다(일반 → 어둠 순서). 서버는 산 코스튬인지 모르므로 여기서 걸러야 한다. */
export function CostumePicker({ owned, value, onPick }: { owned: readonly CostumeId[]; value: AvatarKind; onPick: (kind: AvatarKind) => void }) {
  const ids = [...COSTUME_IDS_OF.normal, ...COSTUME_IDS_OF.dark].filter((id) => owned.includes(id));
  return (
    <div className="field">
      <span>코스튬 사진 — 상점에서 산 코스튬</span>
      {ids.length > 0 ? (
        <div className="pf-costumes" role="group" aria-label="코스튬 프로필 사진">
          {ids.map((id) => {
            const kind: AvatarKind = `costume-${id}`;
            return (
              <button key={id} type="button" className="pf-costume" aria-pressed={value === kind} aria-label={COSTUME_TEXT[id].name} onClick={() => onPick(kind)}>
                <Avatar name={COSTUME_TEXT[id].name} picture={null} avatar={kind} className="avatar-pick" />
                <small>{COSTUME_TEXT[id].name}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <small className="muted">아직 산 코스튬이 없어요. 상점에서 코스튬을 사면 여기서 프로필 사진으로 고를 수 있어요.</small>
      )}
    </div>
  );
}

function ProfileEditor({ onDone }: { onDone: (saved: boolean) => void }) {
  const { game } = useUi();
  const [mine, setMine] = useState<MyProfile | null>(null);
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<AvatarKind>('google');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<MyProfile>('profiles/me')
      .then((m) => {
        if (!alive) return;
        setMine(m);
        setNickname(m.nickname ?? '');
        setBio(m.bio ?? '');
        setAvatar(m.avatar);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);

  const nickLen = [...nickname.trim()].length;
  const invalid = nickLen > 0 && (nickLen < NICKNAME_MIN || nickLen > NICKNAME_MAX);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<MyProfile>('profiles/me', { method: 'PUT', body: { nickname, bio, avatar } });
      patchAuthUser({ nickname: saved.nickname, bio: saved.bio, avatar: saved.avatar, displayName: saved.name });
      toast('프로필을 저장했어요.', 'good');
      onDone(true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (!mine) {
    return error ? (
      <p className="chat-error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">불러오는 중…</p>
    );
  }
  const shownName = nickname.trim() || mine.googleName || '익명';
  return (
    <div className="pf">
      <div className="pf-head">
        <Avatar name={shownName} picture={mine.picture} avatar={avatar} className="avatar-lg" />
        <div>
          <h3 className="pf-name">{shownName}</h3>
          <small className="muted">다른 사람에게 이렇게 보여요</small>
        </div>
      </div>
      <label className="field">
        <span>
          닉네임 ({nickLen}/{NICKNAME_MAX}) · 비우면 구글 이름 「{mine.googleName ?? '익명'}」을 써요
        </span>
        <input value={nickname} maxLength={NICKNAME_MAX} onChange={(e) => setNickname(e.target.value)} placeholder={`${NICKNAME_MIN}~${NICKNAME_MAX}자`} />
      </label>
      <label className="field">
        <span>
          한 줄 소개 ({[...bio].length}/{BIO_MAX})
        </span>
        <input value={bio} maxLength={BIO_MAX} onChange={(e) => setBio(e.target.value)} placeholder="나를 한 줄로 소개해 보세요" />
      </label>
      <div className="field">
        <span>프로필 사진</span>
        <div className="seg" role="group" aria-label="프로필 사진">
          {AVATAR_CHOICES.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={avatar === id} onClick={() => setAvatar(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <CostumePicker owned={game.cosmetics.costumes} value={avatar} onPick={setAvatar} />
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <div className="pf-actions">
        <button type="button" className="btn btn-primary" disabled={busy || invalid} onClick={() => void save()}>
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDone(false)}>
          취소
        </button>
      </div>
      <small className="fineprint">닉네임과 한 줄 소개는 랭킹·챗방·친구 목록에 보여요. 운영 규칙에 어긋나면 신고로 지워질 수 있어요.</small>
    </div>
  );
}
