import { claimableMissions, attendanceStatus } from './missions';
import { presentsReady } from './mascot';
import { readyPosts } from './monogram';
import type { GameState } from './types';

/** 「더보기」 안에서 지금 할 일이 있는 화면별 개수. 하단 탭과 메뉴의 알림 점에 쓴다. */
export interface MoreAlerts {
  missions: number;
  mail: number;
  monogram: number;
  /** 마스코트가 가져온 선물 + 쓰지 않은 포토카드 티켓이 있으면 1 */
  collect: number;
  total: number;
}

export function moreAlerts(s: GameState): MoreAlerts {
  const missions = claimableMissions(s) + (attendanceStatus(s).claimedToday ? 0 : 1);
  const mail = s.fanMail.inbox.length;
  const monogram = readyPosts(s);
  const collect = presentsReady(s) + (s.photo.tickets > 0 ? 1 : 0);
  return { missions, mail, monogram, collect, total: missions + mail + monogram + collect };
}
