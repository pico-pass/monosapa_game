export type Persona = 'normal' | 'dark';
export type EquipmentKind = 'mic' | 'studio' | 'promotion';
/** 다이아로만 올리는 영구 업그레이드. 두 자아 모두에 적용된다. */
export type DiamondUpgradeKind = 'production' | 'royalty' | 'offline';
export type StageId =
  | 'room'
  | 'club'
  | 'hall'
  | 'solo'
  | 'medium'
  | 'large'
  | 'arena'
  | 'world'
  | 'universe'
  // 유니버스 페스티벌을 클리어하면 열리는 비밀 공연장. 어둠속성으로만 입장한다.
  | 'rooftop'
  | 'ruins'
  | 'garage';
export type AlbumType = 'normal' | 'dark';
export type DialogueTone = 'original' | 'soft';

export interface Equipment {
  mic: number;
  studio: number;
  promotion: number;
}

export type DiamondUpgrades = Record<DiamondUpgradeKind, number>;

/** 스트리밍이 기록되는 음원 플랫폼 */
export type StreamPlatform = 'spotify' | 'ytmusic' | 'melon' | 'applemusic';

/** 스트리밍 기록. 팬 수에 비례해 쌓이는 스트리밍이 플랫폼별로 나뉘어 저장되고, 일정 간격마다 코인으로 정산한다. */
export interface Streaming {
  /** 플랫폼별 누적 스트리밍(내부는 소수 유지, 표시할 때만 내림) */
  totals: Record<StreamPlatform, number>;
  /** 지금까지 코인으로 정산한 스트리밍 수. 쌓인 합계에서 이 값을 뺀 것이 정산 대기분이다. */
  settled: number;
  /** 마지막 정산 시각. 이 시각에서 정산 간격이 지나야 다시 정산할 수 있다. */
  lastClaimAt: number;
  /** 플랫폼 분배를 정하는 씨앗. 같은 씨앗·같은 시각이면 분배가 항상 같다. */
  seed: number;
}

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

/** 편의점 간식(작업하기 라임 버프)과 홍보 캠페인(팬 획득 버프) */
export type SnackId = 'kimbap' | 'coffee' | 'energy' | 'lunchbox';
export type CampaignId = 'flyer' | 'insta' | 'billboard';
export type ThemeId = 'default' | 'pastel' | 'mono' | 'neon';
/** 일반속성 모노사파의 코스튬(다이아로 산다. 모양만 바뀐다). 지뢰·텐션업·화난·메이드·토끼·타락천사·곰도리·수녀·뱀파이어·냥집사·유령신부 */
export type NormalCostumeId = 'jirai' | 'hype' | 'angry' | 'maid' | 'bunny' | 'fallen' | 'bear' | 'nun' | 'vampire' | 'butler' | 'bride';
/** 어둠속성 모노사파의 코스튬. 검은토끼·지뢰밴드·어둠의왕·딸기우유·곰도리어둠·편지배달부·어둠의교주·삐에로·어둠의간호사·어둠의신부 */
export type DarkCostumeId = 'dbunny' | 'band' | 'king' | 'milk' | 'dbear' | 'postman' | 'cultist' | 'clown' | 'dnurse' | 'dbride';
export type CostumeId = NormalCostumeId | DarkCostumeId;

export interface Buffs {
  /** 작업하기 라임 +N%. until(ms)까지. 하나만 켤 수 있다. */
  snack: { id: SnackId; until: number } | null;
  /** 싱글·앨범·모노그램으로 얻는 팬 ×N. until(ms)까지. 하나만 켤 수 있다. */
  campaign: { id: CampaignId; until: number } | null;
}

/** 다이아로 사는 꾸미기. 효과는 모양뿐이다. */
export interface Cosmetics {
  /** 가진 테마(기본은 항상 있다) */
  themes: ThemeId[];
  theme: ThemeId;
  /** 가진 코스튬(두 자아 것을 함께) */
  costumes: CostumeId[];
  /** 일반속성 모노사파가 입고 있는 코스튬. 없으면(null) 기본 옷이다. */
  costume: NormalCostumeId | null;
  /** 어둠속성 모노사파가 입고 있는 코스튬. 없으면(null) 기본 옷이다. */
  darkCostume: DarkCostumeId | null;
  /** 달고 있는 칭호(업적 ID). 없으면 null. */
  title: string | null;
}

/** 평생 누적 횟수. 업적과 일일·주간 미션이 여기서 읽는다. */
export type CounterKey =
  | 'works'
  | 'dawnWorks'
  | 'seizures'
  | 'buys'
  | 'concerts'
  | 'claims'
  | 'snacks'
  | 'campaigns'
  | 'posts'
  | 'virals'
  | 'mails'
  | 'antiMails'
  | 'missions'
  | 'attendances'
  | 'bestStreak'
  // 콘텐츠 팩 2
  | 'arcades'
  | 'rhythms'
  | 'survivals'
  | 'lyrics'
  | 'ticketings'
  | 'towerClears'
  | 'pulls'
  | 'pets'
  | 'challenges'
  | 'chartTop10'
  | 'chartNo1'
  | 'trades';
export type Counters = Record<CounterKey, number>;

/* ---------- 수집·육성 ---------- */

/** 곡 카드: 발매한 싱글이 카드가 된다. 등급·바이브는 싱글 번호와 씨앗으로 정해진다. */
export type CardRarity = 'N' | 'R' | 'SR' | 'SSR';
/** 보너스 갈래. rhyme 라임 생산 · coin 인세 · fan 팬 획득 · power 미니게임·계단 전투력 */
export type Vibe = 'rhyme' | 'coin' | 'fan' | 'power';

export interface SongCards {
  seed: number;
  /** 덱에 장착한 곡 카드(싱글 ID). 최대 deckSlots장 */
  deck: string[];
  /** 곡별 리마스터 레벨 (0이면 항목 없음) */
  remaster: Record<string, number>;
}

/** 포토카드 도감: 카드 ID는 `p{세트}-{등급}` (세트 1~6, 등급 1~6) */
export interface PhotoBook {
  seed: number;
  /** 지금까지 뽑은 횟수(결과를 정하는 번호) */
  pulls: number;
  /** 5등급 이상이 나오지 않고 지나간 횟수. 천장에서 확정으로 나온다. */
  pity: number;
  tickets: number;
  owned: Record<string, number>;
  /** 중복으로 모인 조각. 원하는 카드를 만드는 데 쓴다. */
  shards: number;
  /** 완성 보상을 이미 받은 세트 번호 */
  claimedSets: number[];
}

/** 피처링 NPC 래퍼 카드 뽑기 */
export interface Featuring {
  seed: number;
  pulls: number;
  pity: number;
  /** 지난 SSR이 픽업이 아니었다면 다음 SSR은 픽업이 확정이다. */
  guaranteed: boolean;
  /** NPC ID → 별 개수(1~maxStar) */
  owned: Record<string, number>;
  /** 장착한 NPC (최대 slots명) */
  slots: string[];
}

export interface Mascot {
  xp: number;
  /** 이 시각까지 배부르다. 지나면 배고픔 → 오래 지나면 삐짐 */
  fullUntil: number;
  playReadyAt: number;
  giftReadyAt: number;
  /** 간식을 준 횟수. 간식 값이 줄 때마다 오르고(상한 있음) 횟수 자체는 계속 센다. */
  fed: number;
}
export type Mascots = Record<Persona, Mascot>;

/* ---------- 모노사파 육성 ---------- */

/** 육성 게이지 네 가지. mood는 일반속성에서는 「기분」, 어둠속성에서는 「쾌락지수」다. tired는 높을수록 지친 것이다. */
export type NurtureGauge = 'full' | 'mood' | 'tired' | 'clean';

/** 자아 하나의 육성 상태. 게이지 값은 `at` 시각의 값이고, 지금 값은 시간이 흐른 만큼 계산한다(nurturedata.ts). */
export interface NurtureSide {
  /** 성장도. 레벨은 여기서 계산한다. */
  xp: number;
  full: number;
  mood: number;
  tired: number;
  clean: number;
  /** 게이지 값이 기록된 시각. 0이면 아직 한 번도 돌보지 않아 시간이 흐르지 않은 처음 값이다. */
  at: number;
  /** 이 시각까지 자는 중이다(지났으면 깨어 있음). */
  sleepUntil: number;
  /** 행동별로 이 시각까지는 그 행동을 다시 할 수 없다(행동 ID → 시각). 행동마다 1분에 한 번이고 서로 따로 센다. */
  readyAt: Record<string, number>;
  /** 행동별로 해 준 횟수 (행동 ID → 횟수) */
  uses: Record<string, number>;
}
export type Nurtures = Record<Persona, NurtureSide>;

/* ---------- 아케이드 ---------- */

export type ArcadeKind = 'rhythm' | 'survival' | 'lyric' | 'ticketing';

export interface ArcadeRecord {
  cooldownUntil: number;
  /** 최고 점수(0~1000) */
  best: number;
  plays: number;
}

export interface Arcade {
  /** songs: 곡(싱글 ID)별 최고 점수 */
  rhythm: ArcadeRecord & { songs: Record<string, number> };
  survival: ArcadeRecord;
  /** cards: 가사 카드 보유량 · bonus: 다음 싱글에 붙는 팬 보너스(비율, 쓰면 0) */
  lyric: ArcadeRecord & { cards: Record<string, number>; bonus: number };
  /** boost: 다음 공연 코인 배율(until까지, 한 번 쓰면 사라진다) */
  ticketing: ArcadeRecord & { boost: { mult: number; until: number } | null };
  /** week: 이번 주 월요일 날짜 · floor: 이번 주에 도전할 다음 층 · best: 역대 최고 클리어 층 · claimed: 이번 주 보상을 받은 층 */
  tower: { week: string; floor: number; best: number; claimed: number[]; cooldownUntil: number; attempts: number };
}

/** 결산(Wrapped)의 재료와 챌린지로 얻은 가사 노트 */
export interface Stats {
  /** 자아별로 쓴 시간(ms, 생산이 지급된 시간만) */
  normalMs: number;
  darkMs: number;
  /** 팬 DM에 답장한 팬별 횟수 (상위 30명까지만 남긴다) */
  nicks: Record<string, number>;
  /** 챌린지 상위 입상작 (최대 20줄) */
  notes: string[];
}

/** 일일·주간 미션과 출석. 진행도는 "지금 지표 − 그날(그 주) 시작할 때의 지표"라 따로 센 값이 없다. */
export interface MissionState {
  /** 오늘 날짜(YYYY-MM-DD, 기기 시간대) */
  day: string;
  /** 이번 주 월요일 날짜 */
  week: string;
  dayBase: Record<string, number>;
  weekBase: Record<string, number>;
  /** 오늘·이번 주에 보상을 받은 미션 ID (날짜·주가 바뀌면 해당 범위가 지워진다) */
  claimed: string[];
  /** 연속 출석일 수와 마지막 출석 날짜 */
  streak: number;
  lastAttend: string;
}

/** 팬 DM. 내용은 content.ts의 템플릿(tpl)에서 찾는다. */
export interface Mail {
  id: string;
  tpl: string;
  nick: string;
  at: number;
}

export interface FanMail {
  seed: number;
  /** 지금까지 받은 DM 수(ID를 매기는 데 쓴다) */
  seq: number;
  /** 다음 DM이 도착하는 시각 */
  nextAt: number;
  inbox: Mail[];
}

export type PostKind = 'lyric' | 'selfie' | 'reels';

/** 모노그램에 올린 게시물. 끝나는 시각이 지나면 결과를 확인(수확)할 수 있다. */
export interface Post {
  id: string;
  kind: PostKind;
  persona: Persona;
  at: number;
  endsAt: number;
}

export interface Monogram {
  seed: number;
  seq: number;
  /** 동시에 올려 둘 수 있는 게시물 수 */
  slots: number;
  posts: Post[];
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
  /** 유통사 호감도 레벨. 레벨당 스트리밍 정산 코인이 늘어난다(최대 레벨 없음). */
  distributor: number;
  /** 다이아 재화. 공연장 첫 클리어·앨범 발매·플레이어 레벨업으로 얻는다. */
  diamonds: number;
  /** 다이아 전용 영구 업그레이드 레벨 */
  diamondUpgrades: DiamondUpgrades;
  /** 간식·홍보 캠페인 버프 */
  buffs: Buffs;
  cosmetics: Cosmetics;
  counters: Counters;
  /** 달성한 업적: ID → 달성 시각 */
  achievements: Record<string, number>;
  missions: MissionState;
  fanMail: FanMail;
  monogram: Monogram;
  cards: SongCards;
  photo: PhotoBook;
  feat: Featuring;
  mascot: Mascots;
  nurture: Nurtures;
  arcade: Arcade;
  stats: Stats;
  /** 음원 플랫폼별 스트리밍 기록과 정산 상태 */
  streaming: Streaming;
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
  | 'streaming_wait'
  | 'nothing_to_claim'
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
  | 'input_limited'
  | 'dark_only'
  | 'already_done'
  | 'not_ready'
  | 'slots_full'
  | 'owned'
  | 'not_owned'
  | 'need_single'
  | 'need_track'
  | 'no_ticket'
  | 'need_duplicate'
  | 'full_slots'
  | 'too_few_cards'
  // 모노사파 육성
  | 'nurture_locked'
  | 'level_low'
  | 'sleeping'
  | 'gauge_high'
  | 'too_tired'
  | 'not_sleepy'
  | 'care_cooldown';

export type Fail = { ok: false; reason: FailReason; state: GameState };
export type Ok<T = object> = { ok: true; state: GameState } & T;
export type CommandResult<T = object> = Ok<T> | Fail;
