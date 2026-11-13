/* 라이브 미니게임 내 기록 조회(메인 서버 `GET /api/live/records/me`). 기록은 판이 끝날 때 소켓 서버가 메인 서버에 쌓는다. */
import type { LyricRecord } from '../../../realtime/src/protocol';
import { api } from './api';

export type { LyricRecord };

export interface MyLiveRecords {
  lyric: LyricRecord;
}

/** 내 기록을 가져온다. 실패하면 null(기록 표시만 빠지고 게임에는 영향이 없다). */
export async function fetchMyRecords(): Promise<MyLiveRecords | null> {
  try {
    return await api<MyLiveRecords>('live/records/me');
  } catch {
    return null;
  }
}
