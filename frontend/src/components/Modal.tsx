import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  /** 닫기 버튼 대신 화면 하단 행동 버튼을 직접 넣는 경우 */
  footer?: ReactNode;
  tone?: 'normal' | 'dark' | 'gold';
}

export function Modal({ title, children, onClose, footer, tone = 'normal' }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${tone}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer ?? (onClose && (
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={onClose}>
              확인
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
