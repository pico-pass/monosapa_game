/**
 * 교체 가능한 자산 매니페스트.
 * 값을 null로 두면 코드로 그린 임시 SVG·합성음을 쓰고, 경로 문자열을 넣으면 그 자산으로 바뀐다.
 *
 *   characters.normal = '/assets/mono-normal.webp' → 일반속성 캐릭터 이미지 (현재 사용 중)
 *   null로 되돌리면 코드로 그린 임시 SVG 캐릭터를 쓴다
 *   rooms.dark        = '/assets/room-dark.png'    → 어둠속성 작업실 배경 교체
 *   sfx.release       = '/assets/release.mp3'      → 발매 효과음 교체
 *   bgm.normal / dark = '/assets/bgm-*.mp3'        → 자아별 배경음악 (현재 사용 중)
 *
 * 파일은 public/assets/ 아래에 두면 된다. (경로는 index.html 기준 상대 경로를 권장)
 */
export interface AssetManifest {
  characters: { normal: string | null; dark: string | null };
  rooms: { normal: string | null; dark: string | null };
  sfx: Partial<Record<'work' | 'switch' | 'release' | 'buy' | 'album' | 'micSeized', string>>;
  /** 자아별 배경음악. null이면 배경음악 없이 효과음만 난다. */
  bgm: { normal: string | null; dark: string | null };
}

export const ASSETS: AssetManifest = {
  characters: { normal: '/assets/mono-normal.webp', dark: '/assets/mono-dark.png' },
  rooms: { normal: null, dark: null },
  sfx: {},
  bgm: { normal: '/assets/bgm-normal.mp3', dark: '/assets/bgm-dark.mp3' },
};
