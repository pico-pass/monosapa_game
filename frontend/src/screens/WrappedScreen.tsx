import { useEffect, useMemo, useRef, useState } from 'react';
import { buildWrapped } from '../game/wrapped';
import { drawCard, shareCard } from '../platform/shareCard';
import { toast, useUi } from '../store/gameStore';

/** 결산(Wrapped): 지금까지의 기록을 슬라이드로 넘겨 보고, 공유 카드(이미지)로 저장해요. */
export function WrappedScreen() {
  const { game: g } = useUi();
  const w = useMemo(() => buildWrapped(g, g.lastSettledAt), [g]);
  const [i, setI] = useState(0);
  const slide = w.slides[Math.min(i, w.slides.length - 1)];
  const preview = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preview.current) drawCard(preview.current, w);
  }, [w]);

  return (
    <section className="screen" aria-label="결산">
      <h2 className="section-title">{w.year} 모노사파 Wrapped</h2>
      <p className="muted">플레이를 시작한 뒤 지금까지의 기록이에요. 올해만 따로 세지는 않아요.</p>
      <div className={`card wr-slide wr-${slide.id}`} aria-live="polite">
        <small className="wr-label">
          <span aria-hidden>{slide.icon}</span> {slide.label}
        </small>
        <strong className="wr-big">{slide.big}</strong>
        <small className="wr-sub">{slide.sub}</small>
      </div>
      <div className="wr-nav">
        <button type="button" className="btn btn-ghost" disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))}>
          ← 이전
        </button>
        <span className="wr-dots" aria-hidden>
          {w.slides.map((s, k) => (
            <i key={s.id} className={k === i ? 'wr-dot-on' : ''} />
          ))}
        </span>
        <button type="button" className="btn btn-primary" disabled={i >= w.slides.length - 1} onClick={() => setI(Math.min(w.slides.length - 1, i + 1))}>
          다음 →
        </button>
      </div>

      <h3 className="sub-title">공유 카드</h3>
      <div className="card">
        <strong className="wr-head">{w.headline}</strong>
        <canvas ref={preview} className="wr-canvas" aria-label="공유 카드 미리보기" />
        <button
          type="button"
          className="btn btn-accent btn-wide"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            toast(await shareCard(w), 'info');
            setBusy(false);
          }}
        >
          이미지로 공유·저장
        </button>
        <p className="fineprint">이미지는 이 기기에서 만들어지고 어디에도 올라가지 않아요.</p>
      </div>
    </section>
  );
}
