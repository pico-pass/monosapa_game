import type { Persona } from './types';

/* 저장 검증 도우미. persistence.ts와 pack-state.ts가 같이 쓴다. 숫자는 엄격하게, 알 수 없는 ID는 호출자가 조용히 버린다. */

export class Invalid extends Error {}
export const bad = (msg: string): never => {
  throw new Invalid(msg);
};

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const MAX_TIME = 8.64e15;

export function num(o: Obj, key: string, min: number, max: number, label = key): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${label}: 숫자가 아니거나 비정상 값입니다.`);
  if (v < min || v > max) return bad(`${label}: 허용 범위(${min}~${max})를 벗어났습니다.`);
  return v;
}

export function int(o: Obj, key: string, min: number, max: number, label = key): number {
  const v = num(o, key, min, max, label);
  if (!Number.isInteger(v)) return bad(`${label}: 정수여야 합니다.`);
  return v;
}

export function str(o: Obj, key: string, maxLen = 200, label = key): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) return bad(`${label}: 문자열이 올바르지 않습니다.`);
  return v;
}

export function bool(o: Obj, key: string, label = key): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') return bad(`${label}: true/false 값이어야 합니다.`);
  return v;
}

export function persona(o: Obj, key: string, label = key): Persona {
  const v = o[key];
  if (v !== 'normal' && v !== 'dark') return bad(`${label}: 알 수 없는 자아입니다.`);
  return v;
}

/** ID → 정수 개수 표. 허용 ID에 없는 항목은 버리고 값은 엄격하게 본다. */
export function countMap(raw: unknown, allowed: (id: string) => boolean, max: number, label: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === undefined) return out;
  if (!isObj(raw)) return bad(`${label}가 올바르지 않습니다.`);
  for (const [id, v] of Object.entries(raw)) {
    if (!allowed(id)) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) return bad(`${label}.${id}: 허용 범위를 벗어났습니다.`);
    if (v > 0) out[id] = v;
  }
  return out;
}
