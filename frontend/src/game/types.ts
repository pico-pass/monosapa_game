export type Persona = 'normal' | 'dark';
export type EquipmentKind = 'mic' | 'studio' | 'promotion';
/** 다이아로만 올리는 영구 업그레이드. 두 자아 모두에 적용된다. */
export type DiamondUpgradeKind = 'production' | 'royalty';
export type StageId = 'room' | 'club' | 'hall' | 'solo' | 'medium' | 'large' | 'arena' | 'world';
export type AlbumType = 'normal' | 'dark';
export type DialogueTone = 'original' | 'soft';

export interface Equipment {
  mic: number;
  studio: number;
  promotion: number;
}

export type DiamondUpgrades = Record<DiamondUpgradeKind, number>;

export interface Single {
  id: string;
  persona: Persona;
  title: string;
  releasedAt: number;
}

/** 발매한 앨범. 수록곡·제목은 content.ts의 ALBUM_CATALOG에서 id로 찾는다. */
export interface Album {
  id: string;
  title: string;
  type: AlbumType;
  releasedAt: number;
}

export interface ConcertRecord {
  cleared: boolean;
  bestScore: number;
  cooldownUntil: number;
}

export interface Settings {
  muted: boolean;
  /** 배경음악만 끈다. muted가 켜져 있으면 효과음과 함께 모두 꺼진다. */
  bgmMuted: boolean;
  dialogueTone: DialogueTone;
  reducedMotion: boolean;
}

/** 저장되는 원본 데이터. 레벨·누적 수·생산 배율은 여기서 계산한다. */
export interface GameState {
  schemaVersion: number;
  revision: number;
  savedAt: number;
  lastSettledAt: number;
  coins: number;
  fans: number;
  normalRhymes: number;
  darkRhymes: number;
  activePersona: Persona;
  heat: number;
  switchLockedUntil: number;
  recoveryPenaltyUntil: number;
  recoveryReentryRequired: boolean;
  /** 일반속성 장비. 일반속성에서만 효과가 난다. */
  equipment: Equipment;
  /** 어둠속성 장비. 어둠속성에서만 효과가 난다. */
  darkEquipment: Equipment;
  /** 순수 음악력 업그레이드 레벨(일반속성). 레벨당 작업하기 한 번에 얻는 기본 라임이 늘어난다. */
  musicPower: number;
  /** 음지 드립력 업그레이드 레벨(어둠속성). 효과는 같은 방식이다. */
  dripPower: number;
  /** 다이아 재화. 공연장 첫 클리어·앨범 발매·플레이어 레벨업으로 얻는다. */
  diamonds: number;
  /** 다이아 전용 영구 업그레이드 레벨 */
  diamondUpgrades: DiamondUpgrades;
  singles: Single[];
  albums: Album[];
  concerts: Record<StageId, ConcertRecord>;
  tutorialFlags: Record<string, boolean>;
  settings: Settings;
}

export interface VirtualComment {
  nick: string;
  text: string;
}

/** advance()가 내보내는 엔진 이벤트. UI는 이것만 보고 연출한다. */
export type EngineEvent = { type: 'heatHigh' } | { type: 'micSeized' };

export interface AdvanceContext {
  /** 라임·인세 생산 효율. 온라인 1, 오프라인 0.7. 과열·잠금 시간은 항상 100%. */
  efficiency: number;
}

export interface AdvanceResult {
  state: GameState;
  events: EngineEvent[];
}

export type FailReason =
  | 'insufficient_rhymes'
  | 'insufficient_coins'
  | 'insufficient_diamonds'
  | 'nothing_to_skip'
  | 'max_level'
  | 'locked'
  | 'cooldown'
  | 'same_persona'
  | 'switch_lock'
  | 'heat_too_high'
  | 'recovery'
  | 'no_more_albums'
  | 'not_found'
  | 'session_closed'
  | 'input_limited';

export type Fail = { ok: false; reason: FailReason; state: GameState };
export type Ok<T = object> = { ok: true; state: GameState } & T;
export type CommandResult<T = object> = Ok<T> | Fail;
