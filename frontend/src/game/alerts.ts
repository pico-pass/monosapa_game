import { certsClaimable } from './certs';
import { claimableMissions, attendanceStatus } from './missions';
import { presentsReady } from './mascot';
import { readyPosts } from './monogram';
import { nurtureAlerts } from './nurture';
import { skillPointsFree } from './skills';
import { villageAlerts } from './village';
import type { GameState } from './types';

/** 「더보기」 안에서 지금 할 일이 있는 화면별 개수. 하단 탭과 메뉴의 알림 점에 쓴다. */
export interface MoreAlerts {
  missions: number;
  mail: number;
  monogram: number;
  /** 마스코트가 가져온 선물 + 쓰지 않은 포토카드 티켓이 있으면 1 */
  collect: number;
  /** 돌봐 줘야 하는 모노사파(자아) 수 */
  nurture: number;
  /** 아직 안 찍은 레벨 스킬 포인트가 있으면 1 */
  skills: number;
  /** 받을 수 있는 스트리밍 인증이 있는 플랫폼 수 */
  stats: number;
  /** 고르지 않은 마을 소식 + 수확할 ❤️가 가득 차 가는 마을 */
  village: number;
  total: number;
}

export function moreAlerts(s: GameState): MoreAlerts {
  const missions = claimableMissions(s) + (attendanceStatus(s).claimedToday ? 0 : 1);
  const mail = s.fanMail.inbox.length;
  const monogram = readyPosts(s);
  const collect = presentsReady(s) + (s.photo.tickets > 0 ? 1 : 0);
  const nurture = nurtureAlerts(s);
  const skills = skillPointsFree(s) > 0 ? 1 : 0;
  const stats = certsClaimable(s);
  const village = villageAlerts(s);
  return { missions, mail, monogram, collect, nurture, skills, stats, village, total: missions + mail + monogram + collect + nurture + skills + stats + village };
}
