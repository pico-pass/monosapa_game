import { TEMP_OPEN_STAGES } from '../balance';
import type { StageId } from '../types';

/*
 * 임시 개방(TEMP_OPEN_STAGES) 중에도 공연장의 원래 팬·앞 공연장 클리어 조건을 검사하려는 테스트용.
 * closeTempOpenStages()로 목록을 비우고, afterEach(reopenTempOpenStages)로 되돌린다.
 */
let saved: StageId[] | null = null;

export function closeTempOpenStages(): void {
  if (saved) return;
  saved = (TEMP_OPEN_STAGES as StageId[]).splice(0);
}

export function reopenTempOpenStages(): void {
  if (!saved) return;
  (TEMP_OPEN_STAGES as StageId[]).push(...saved);
  saved = null;
}
