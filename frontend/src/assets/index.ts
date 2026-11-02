import type { CostumeId, Persona } from '../game/types';

/**
 * 교체 가능한 자산 매니페스트.
 * 값을 null로 두면 코드로 그린 임시 SVG·합성음을 쓰고, 경로 문자열을 넣으면 그 자산으로 바뀐다.
 *
 *   characters.normal = '/assets/mono-normal.webp' → 일반속성 캐릭터 이미지 (현재 사용 중)
 *   null로 되돌리면 코드로 그린 임시 SVG 캐릭터를 쓴다
 *   costumes.maid     = '/assets/costume-maid.webp' → 코스튬 이미지 (일반·어둠 모두, 상점에서 다이아로 산다)
 *   pets.normal.young = '/assets/pet-normal-1.webp' → 마스코트(펫) 이미지. 자아마다 young(아기·청소년)·grown(어른·전설) 두 모습
 *   tracks['dark-love'] = '/assets/track-dark-love.mp3' → 리듬 모드의 음원 곡(game/songcharts.ts의 TRACKS id)
 *   rooms.dark        = '/assets/room-dark.png'    → 어둠속성 작업실 배경 교체
 *   sfx.release       = '/assets/release.mp3'      → 발매 효과음 교체
 *   bgm.normal / dark = '/assets/bgm-*.mp3'        → 자아별 배경음악 (현재 사용 중)
 *
 * 파일은 public/assets/ 아래에 두면 된다. (경로는 index.html 기준 상대 경로를 권장)
 */
export interface AssetManifest {
  characters: { normal: string | null; dark: string | null };
  /** 코스튬 이미지(일반·어둠). 모든 코스튬은 이미지가 있어야 한다(코드로 그린 SVG 대체본이 없다). */
  costumes: Record<CostumeId, string>;
  /** 마스코트(펫) 이미지. 알 단계는 이미지 없이 이모지를 쓴다(`petImage`). */
  pets: Record<Persona, { young: string; grown: string }>;
  /** 리듬 모드 음원 곡 파일. 키는 game/songcharts.ts의 TrackDef.id */
  tracks: Record<string, string>;
  rooms: { normal: string | null; dark: string | null };
  sfx: Partial<Record<'work' | 'switch' | 'release' | 'buy' | 'album' | 'micSeized', string>>;
  /** 자아별 배경음악. null이면 배경음악 없이 효과음만 난다. */
  bgm: { normal: string | null; dark: string | null };
}

export const ASSETS: AssetManifest = {
  characters: { normal: '/assets/mono-normal.webp', dark: '/assets/mono-dark.png' },
  costumes: {
    jirai: '/assets/costume-jirai.webp',
    hype: '/assets/costume-hype.webp',
    angry: '/assets/costume-angry.webp',
    maid: '/assets/costume-maid.webp',
    bunny: '/assets/costume-bunny.webp',
    fallen: '/assets/costume-fallen.webp',
    bear: '/assets/costume-bear.webp',
    nun: '/assets/costume-nun.webp',
    vampire: '/assets/costume-vampire.webp',
    butler: '/assets/costume-butler.webp',
    bride: '/assets/costume-bride.webp',
    dbunny: '/assets/costume-dbunny.webp',
    band: '/assets/costume-band.webp',
    king: '/assets/costume-king.webp',
    milk: '/assets/costume-milk.webp',
    dbear: '/assets/costume-dbear.webp',
    postman: '/assets/costume-postman.webp',
    cultist: '/assets/costume-cultist.webp',
    clown: '/assets/costume-clown.webp',
    dnurse: '/assets/costume-dnurse.webp',
    dbride: '/assets/costume-dbride.webp',
  },
  pets: {
    normal: { young: '/assets/pet-normal-1.webp', grown: '/assets/pet-normal-2.webp' },
    dark: { young: '/assets/pet-dark-1.webp', grown: '/assets/pet-dark-2.webp' },
  },
  tracks: { 'dark-love': '/assets/track-dark-love.mp3' },
  rooms: { normal: null, dark: null },
  sfx: {},
  bgm: { normal: '/assets/bgm-normal.mp3', dark: '/assets/bgm-dark.mp3' },
};

/** 마스코트가 어른(이 단계)부터 두 번째 모습으로 바뀐다. */
export const PET_GROWN_STAGE = 3;

/** 단계에 맞는 펫 이미지. 알 단계(0)는 이미지가 없어서 null이고, 화면은 이모지를 쓴다. */
export function petImage(persona: Persona, stage: number): string | null {
  if (stage < 1) return null;
  const pet = ASSETS.pets[persona];
  return stage >= PET_GROWN_STAGE ? pet.grown : pet.young;
}
