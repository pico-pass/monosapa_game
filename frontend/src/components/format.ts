/** 화면 표시용 포맷. 내부 계산은 소수를 유지하고, 표시할 때만 자릿수를 줄인다. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs < 1000) return Number.isInteger(n) ? String(n) : n.toFixed(abs < 10 ? 1 : 0).replace(/\.0$/, '');
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [v, u] of units) {
    if (abs >= v) return `${(n / v).toFixed(abs / v < 10 ? 2 : abs / v < 100 ? 1 : 0)}${u}`;
  }
  return String(Math.floor(n));
}

/** 보유량은 내림해서 보여준다. (3.9개 보유인데 4개로 보이면 발매가 안 될 때 혼란스럽다) */
export const fmtHave = (n: number) => fmt(Math.floor(n + 1e-9));

export const fmtRate = (n: number) => (n >= 100 ? fmt(Math.round(n)) : n.toFixed(2).replace(/0$/, '').replace(/\.0$/, ''));

/** 스트리밍은 K·M 약어나 소수 없이 1회 단위 정수로 보여준다. 쌓이는 중인 소수는 내림. */
export const fmtStreams = (n: number) => Math.floor(n + 1e-9).toLocaleString('en-US');

/** 초당 스트리밍도 1회 단위. 1 미만이면 0으로 보이지 않게 '1 미만'으로 적는다. */
export const fmtStreamRate = (n: number) => (n > 0 && n < 1 ? '1 미만' : fmtStreams(n));

export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

export const fmtCountdown = (ms: number) => {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const two = (n: number) => String(n).padStart(2, '0');

/** HH:MM (기기 시간대) */
export const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** M/D HH:MM (기기 시간대) */
export const fmtDateTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(ms)}`;
};
