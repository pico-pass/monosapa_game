import { useCallback, useEffect, useState } from 'react';
import { ASSETS } from '../assets';
import { GoogleSignIn } from '../components/GoogleSignIn';
import type { Persona } from '../game/types';
import { retryAuth, useAuth } from '../store/authStore';

const SWAP_MS = 1000;

/** 일반사파·어둠사파 이미지를 1초마다 번갈아 보여 준다. 두 이미지를 겹쳐 두고 투명도만 바꿔서 교체할 때 깜빡이지 않는다. */
function PersonaSwap({ persona }: { persona: Persona }) {
  return (
    <div className="login-hero" aria-hidden>
      {(['normal', 'dark'] as const).map((p) => {
        const src = ASSETS.characters[p];
        return src ? <img key={p} className={`login-img${persona === p ? ' on' : ''}`} src={src} alt="" draggable={false} /> : null;
      })}
    </div>
  );
}

/** 게임에 들어가기 전 구글 로그인 화면. 로그인하지 않으면 게임은 시작(불러오기·틱)되지 않는다. */
export function LoginScreen() {
  const auth = useAuth();
  const [gsiFailed, setGsiFailed] = useState(false);
  const onGsiError = useCallback(() => setGsiFailed(true), []);
  const [persona, setPersona] = useState<Persona>('normal');

  useEffect(() => {
    const id = setInterval(() => setPersona((p) => (p === 'normal' ? 'dark' : 'normal')), SWAP_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="center-screen login" data-persona={persona}>
      <PersonaSwap persona={persona} />
      <h1>모노사파 키우기</h1>
      <p className="muted">두 자아의 믹스테이프</p>
      {auth.status === 'unavailable' ? (
        <>
          <p role="alert">로그인 서버에 연결하지 못했거나 구글 로그인이 아직 설정되지 않았어요.</p>
          <button type="button" className="btn btn-primary" onClick={() => void retryAuth()}>
            다시 시도
          </button>
        </>
      ) : (
        <>
          <p>게임을 시작하려면 구글 계정으로 로그인해 주세요.</p>
          {gsiFailed ? (
            <>
              <p role="alert">구글 로그인 버튼을 불러오지 못했어요. 네트워크를 확인해 주세요.</p>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                새로고침
              </button>
            </>
          ) : (
            <GoogleSignIn clientId={auth.clientId} onLoadError={onGsiError} />
          )}
          {auth.busy && <small className="muted">로그인 중…</small>}
        </>
      )}
      {auth.error && (
        <p className="muted" role="alert">
          {auth.error}
        </p>
      )}
    </div>
  );
}
