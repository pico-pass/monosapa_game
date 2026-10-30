import { useEffect, useRef } from 'react';
import { signInWithGoogle } from '../store/authStore';

/* Google Identity Services. https://developers.google.com/identity/gsi/web */
interface GoogleId {
  initialize(config: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, options: Record<string, string | number>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SRC = 'https://accounts.google.com/gsi/client';
let loading: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('gsi'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** 구글 공식 로그인 버튼. 성공하면 ID 토큰을 서버로 보낸다. */
export function GoogleSignIn({ clientId, onLoadError }: { clientId: string; onLoadError: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadGsi().then(
      () => {
        const el = ref.current;
        if (cancelled || !el || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => void signInWithGoogle(r.credential) });
        window.google.accounts.id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ko', width: 260 });
      },
      () => {
        if (!cancelled) onLoadError();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [clientId, onLoadError]);

  return <div ref={ref} className="google-signin" />;
}
