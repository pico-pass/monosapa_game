import { useCallback, useState } from 'react';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { Modal } from '../components/Modal';
import { signOut, useAuth } from '../store/authStore';
import { setSettingsOpen, updateSettings, useUi } from '../store/gameStore';

export function SettingsSheet() {
  const { game } = useUi();
  const s = game.settings;
  const auth = useAuth();
  const [gsiFailed, setGsiFailed] = useState(false);
  const onGsiError = useCallback(() => setGsiFailed(true), []);

  return (
    <Modal title="설정" onClose={() => setSettingsOpen(false)}>
      <div className="settings">
        {auth.status === 'ready' && (
          <div className="setting-block account">
            <strong>계정</strong>
            {auth.user ? (
              <div className="account-row">
                {auth.user.picture && <img className="account-avatar" src={auth.user.picture} alt="" referrerPolicy="no-referrer" width={40} height={40} />}
                <span>
                  <b>{auth.user.name ?? '구글 계정'}</b>
                  {auth.user.email && <small>{auth.user.email}</small>}
                </span>
                <button type="button" className="btn btn-ghost" disabled={auth.busy} onClick={() => void signOut()}>
                  로그아웃
                </button>
              </div>
            ) : (
              <>
                <small>구글 계정으로 로그인하면 진행 데이터가 계정에 자동 저장돼요.</small>
                {gsiFailed ? <small>구글 로그인 버튼을 불러오지 못했어요. 네트워크를 확인해 주세요.</small> : <GoogleSignIn clientId={auth.clientId} onLoadError={onGsiError} />}
              </>
            )}
            {auth.error && (
              <p className="muted" role="alert">
                {auth.error}
              </p>
            )}
          </div>
        )}

        <label className="setting-row">
          <span>
            <strong>소리</strong>
            <small>효과음·공연 비트·배경음악. 첫 입력 이후에만 켜져요.</small>
          </span>
          <input type="checkbox" checked={!s.muted} onChange={(e) => updateSettings({ muted: !e.target.checked })} />
        </label>

        <label className="setting-row">
          <span>
            <strong>배경음악</strong>
            <small>일반·어둠 자아마다 다른 곡이 나와요. 직접 공연 중에는 작게 깔려요.</small>
          </span>
          <input type="checkbox" checked={!s.bgmMuted} disabled={s.muted} onChange={(e) => updateSettings({ bgmMuted: !e.target.checked })} />
        </label>

        <div className="setting-row">
          <span>
            <strong>대사 톤</strong>
            <small>보상·성장 수치는 같고 대사만 바뀌어요.</small>
          </span>
          <div className="seg" role="group" aria-label="대사 톤">
            <button type="button" aria-pressed={s.dialogueTone === 'original'} onClick={() => updateSettings({ dialogueTone: 'original' })}>
              원래 톤
            </button>
            <button type="button" aria-pressed={s.dialogueTone === 'soft'} onClick={() => updateSettings({ dialogueTone: 'soft' })}>
              순화
            </button>
          </div>
        </div>

        <label className="setting-row">
          <span>
            <strong>모션 감소</strong>
            <small>흔들림·펄스·깜빡임을 줄여요.</small>
          </span>
          <input type="checkbox" checked={s.reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
        </label>

        <div className="setting-block">
          <strong>저장 데이터</strong>
          <small>진행 데이터는 구글 계정에 자동으로 저장돼요. 같은 계정으로 로그인하면 어느 기기에서든 이어서 할 수 있어요.</small>
        </div>
      </div>
    </Modal>
  );
}
