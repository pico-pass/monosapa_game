import { ACHIEVEMENTS, FEAT_NPCS, PHOTO_CARD_IDS } from './balance';
import { mascotStage, photoDistinct, songCardOf } from './packdata';
import { playerLevel, streamTotal } from './selectors';
import type { CardRarity, GameState } from './types';

/*
 * Wrapped(결산): 저장된 기록에서만 계산하는 슬라이드. 올해 것만 따로 세는 기록은 없어서 "플레이를 시작한 뒤 지금까지"의 결산이다.
 * 슬라이드는 데이터만 만들고, 화면과 공유 카드(그림)는 UI가 그린다.
 */

export interface WrappedSlide {
  id: string;
  icon: string;
  label: string;
  big: string;
  sub: string;
}

export interface Wrapped {
  year: number;
  headline: string;
  /** 일반 비율(0~1). 쓴 시간이 없으면 null */
  normalShare: number | null;
  slides: WrappedSlide[];
}

const n = (x: number): string => Math.floor(x).toLocaleString('ko-KR');
const hours = (ms: number): string => (ms / 3_600_000).toFixed(1);
const RANK: Record<CardRarity, number> = { N: 0, R: 1, SR: 2, SSR: 3 };

export function wrappedHeadline(normalShare: number | null): string {
  if (normalShare === null) return '이제 막 시작한 래퍼';
  if (normalShare < 0.35) return '어둠 속에서 더 빛나는 사람';
  if (normalShare > 0.65) return '다정한 햇빛형 래퍼';
  return '두 자아의 균형형 래퍼';
}

export function buildWrapped(s: GameState, now: number): Wrapped {
  const c = s.counters;
  const total = s.stats.normalMs + s.stats.darkMs;
  const normalShare = total > 0 ? s.stats.normalMs / total : null;
  const darkPct = normalShare === null ? 0 : Math.round((1 - normalShare) * 100);

  const best = s.singles
    .map((x) => songCardOf(s.cards, x))
    .sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || b.remaster - a.remaster)[0];
  const topFan = Object.entries(s.stats.nicks).sort((a, b) => b[1] - a[1])[0];
  const done = ACHIEVEMENTS.filter((d) => s.achievements[d.id] !== undefined).length;

  const slides: WrappedSlide[] = [
    {
      id: 'works',
      icon: '✍️',
      label: '작업하기',
      big: `${n(c.works)}번`,
      sub: c.dawnWorks > 0 ? `그중 새벽 3시대에 ${n(c.dawnWorks)}번` : '새벽 3시에는 아직 자고 있었어요',
    },
    {
      id: 'persona',
      icon: normalShare !== null && normalShare < 0.5 ? '🖤' : '🤍',
      label: '더 오래 쓴 자아',
      big: normalShare === null ? '아직 기록이 없어요' : normalShare < 0.5 ? `어둠 ${darkPct}%` : `일반 ${100 - darkPct}%`,
      sub: `일반 ${hours(s.stats.normalMs)}시간 · 어둠 ${hours(s.stats.darkMs)}시간`,
    },
    {
      id: 'songs',
      icon: '💿',
      label: '발매한 곡',
      big: `싱글 ${n(s.singles.length)}곡 · 앨범 ${n(s.albums.length)}장`,
      sub: best ? `가장 빛나는 곡은 「${best.title}」 (${best.rarity})` : '첫 싱글을 기다리고 있어요',
    },
    {
      id: 'fans',
      icon: '👥',
      label: '팬',
      big: `${n(s.fans)}명 · Lv.${playerLevel(s.fans)}`,
      sub: `누적 스트리밍 ${n(streamTotal(s.streaming))}회`,
    },
    {
      id: 'seized',
      icon: '🎤',
      label: '마이크 압수',
      big: `${n(c.seizures)}번`,
      sub: c.seizures === 0 ? '한 번도 안 걸렸어요' : c.seizures >= 10 ? '이쯤 되면 단골 용의자' : '그래도 매번 돌아왔어요',
    },
    {
      id: 'topfan',
      icon: '💌',
      label: '가장 많이 답장한 팬',
      big: topFan ? topFan[0] : '아직 없어요',
      sub: topFan ? `${n(topFan[1])}번 답장했어요 (전체 ${n(c.mails)}통)` : 'DM에 답장하면 여기에 남아요',
    },
    {
      id: 'viral',
      icon: '🔥',
      label: '모노그램',
      big: `게시물 ${n(c.posts)}개`,
      sub: c.virals > 0 ? `그중 ${n(c.virals)}개가 바이럴을 탔어요` : '바이럴은 아직이에요',
    },
    {
      id: 'collection',
      icon: '🃏',
      label: '수집',
      big: `포토카드 ${photoDistinct(s.photo.owned)}/${PHOTO_CARD_IDS.length} · 피처링 ${Object.keys(s.feat.owned).length}/${FEAT_NPCS.length}`,
      sub: `마스코트 ${Math.max(mascotStage(s.mascot.normal.xp), mascotStage(s.mascot.dark.xp)) + 1}단계까지 키웠어요`,
    },
    {
      id: 'arcade',
      icon: '🎮',
      label: '아케이드',
      big: s.arcade.tower.best > 0 ? `계단 ${n(s.arcade.tower.best)}층` : '계단은 아직 1층 앞',
      sub: `아케이드 ${n(c.arcades)}판 · 생존 최고 ${n(s.arcade.survival.best)}점`,
    },
    {
      id: 'achievements',
      icon: '🏅',
      label: '업적',
      big: `${done}/${ACHIEVEMENTS.length}`,
      sub: s.stats.notes.length > 0 ? `가사 노트 ${s.stats.notes.length}줄이 쌓였어요` : '아직 가사 노트는 비어 있어요',
    },
  ];
  return { year: new Date(now).getFullYear(), headline: wrappedHeadline(normalShare), normalShare, slides };
}
