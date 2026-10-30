import type { Wrapped } from '../game/wrapped';

/*
 * Wrapped 공유 카드: 캔버스로 그린 이미지(PNG)를 만들고, 공유를 지원하면 공유 시트로, 아니면 파일로 내려받게 한다.
 * 이미지는 이 기기에서 만들어지고 어디에도 올라가지 않는다.
 */

const W = 1080;
const H = 1350;

/** 카드에 싣는 줄들(제목 아래 큰 글씨 5개) */
export const cardLines = (w: Wrapped): { label: string; big: string }[] => {
  const pick = ['works', 'persona', 'songs', 'fans', 'seized'];
  return pick.map((id) => w.slides.find((s) => s.id === id)).filter((s): s is Wrapped['slides'][number] => !!s).map((s) => ({ label: `${s.icon} ${s.label}`, big: s.big }));
};

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = 800): void {
  let px = size;
  do {
    ctx.font = `${weight} ${px}px system-ui, -apple-system, 'Noto Sans KR', sans-serif`;
    px -= 2;
  } while (ctx.measureText(text).width > maxWidth && px > 24);
}

export function drawCard(canvas: HTMLCanvasElement, w: Wrapped): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#201a3c');
  bg.addColorStop(0.55, '#4a1d52');
  bg.addColorStop(1, '#101022');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = "600 38px system-ui, -apple-system, 'Noto Sans KR', sans-serif";
  ctx.fillText('모노사파 키우기', 90, 130);
  ctx.fillStyle = '#fff';
  fit(ctx, `${w.year} Wrapped`, W - 180, 110, 900);
  ctx.fillText(`${w.year} Wrapped`, 90, 260);
  ctx.fillStyle = '#ffd9f0';
  fit(ctx, w.headline, W - 180, 54, 700);
  ctx.fillText(w.headline, 90, 340);

  let y = 470;
  for (const line of cardLines(w)) {
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = "600 34px system-ui, -apple-system, 'Noto Sans KR', sans-serif";
    ctx.fillText(line.label, 90, y);
    ctx.fillStyle = '#fff';
    fit(ctx, line.big, W - 180, 64, 800);
    ctx.fillText(line.big, 90, y + 74);
    y += 170;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = "500 28px system-ui, -apple-system, 'Noto Sans KR', sans-serif";
  ctx.fillText('게임 속 가상의 기록이에요', 90, H - 70);
}

export function cardBlob(w: Wrapped): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  drawCard(canvas, w);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** 공유 시트가 파일 공유를 지원하면 그걸 쓰고, 아니면 내려받는다. 결과 문구를 돌려준다. */
export async function shareCard(w: Wrapped): Promise<string> {
  const blob = await cardBlob(w);
  if (!blob) return '이미지를 만들지 못했어요.';
  const file = new File([blob], `monosapa-wrapped-${w.year}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${w.year} 모노사파 Wrapped` });
      return '공유했어요.';
    }
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return '공유를 취소했어요.';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return '이미지를 저장했어요.';
}
