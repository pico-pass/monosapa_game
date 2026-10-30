import { useSyncExternalStore } from 'react';
import { bgm } from '../audio/bgm';
import { playWorkSample } from '../audio/sampler';
import { sfx, setMuted, unlockAudio } from '../audio/sfx';
import { fmt, fmtStreams } from '../components/format';
import { BALANCE, STAGES, TOUR_STAGE } from '../game/balance';
import {
  abandonConcert as abandonRun,
  beginManualConcert,
  buyDiamondUpgrade,
  buyEquipment,
  buyMusicPower,
  claimStreaming,
  clearSeizure,
  finishManualConcert,
  releaseAlbum,
  releaseSingle,
  runAutoConcert,
  skipConcertCooldown,
  switchPersona,
  work,
  type AlbumInfo,
  type ConcertOutcome,
  type ConcertRun,
  type ReleaseInfo,
} from '../game/commands';
import { abandonArcade, beginArcade, finishArcade, type ArcadeOutcome, type ArcadeRun, type RhythmLevel } from '../game/arcade';
import { evaluateAchievements, setTitle } from '../game/achievements';
import { featPull, toggleFeat, type FeatPullResult } from '../game/featuring';
import { addLyricCard, draftChoices, trimLyricCard } from '../game/lyricdeck';
import { claimPresent, feedMascot, giftMascot, playMascot } from '../game/mascot';
import { buyTickets, craftPhoto, dismantlePhoto, giveCard, photoPull, takeCard, type PhotoPullResult } from '../game/photocards';
import { applyChallengeClaim, applyChallengePosted, applyChartClaim } from '../game/serverRewards';
import { remasterCard, toggleDeck } from '../game/songcards';
import { climbTower, rollTower, type TowerOutcome } from '../game/tower';
import { ACHIEVEMENT_TEXT, CAMPAIGN_TEXT, SNACK_TEXT, STAGE_TEXT, THEME_TEXT, pickLine, type Situation } from '../game/content';
import { replyMail, rollMail } from '../game/fanmail';
import { claimAttendance, claimMission, rollMissions } from '../game/missions';
import { buySlot, collectPost, startPost } from '../game/monogram';
import { buyCampaign, buySnack, buyTheme, setTheme } from '../game/shop';
import { InputLimiter } from '../game/input';
import type { Judgement } from '../game/minigame';
import {
  createInitialState,
  discardCorrupt,
  loadGame,
  recoverFromBackup,
  saveGame,
  SAVE_KEY,
  type StorageLike,
} from '../game/persistence';
import { playerLevel, stageStatus } from '../game/selectors';
import { makeReport, settleOffline, settleOnline, type OfflineReport } from '../game/simulation';
import type {
  CampaignId,
  CommandResult,
  DiamondUpgradeKind,
  EngineEvent,
  EquipmentKind,
  FailReason,
  GameState,
  Persona,
  PostKind,
  Settings,
  SnackId,
  StageId,
  ThemeId,
} from '../game/types';
import { api, errorText } from '../platform/api';
import { CloudSync, reconcileOnBoot, scopedStorage, type RemoteSave } from '../platform/cloudSave';
import { initSampler } from '../platform/sampler';
import { acquireWriter, setGuardHandlers, takeOverWriter } from '../platform/tabGuard';

export type TabId =
  | 'studio'
  | 'release'
  | 'equip'
  | 'concert'
  | 'more'
  | 'stats'
  | 'ranking'
  | 'collection'
  | 'shop'
  | 'missions'
  | 'achievements'
  | 'mail'
  | 'monogram'
  | 'chat'
  | 'inquiry'
  | 'collect'
  | 'arcade'
  | 'challenge'
  | 'chart'
  | 'wrapped'
  | 'sampler';
/** 하단 탭의 「더보기」 안에 있는 화면들 */
export const MORE_TABS: readonly TabId[] = ['stats', 'ranking', 'collection', 'shop', 'missions', 'achievements', 'mail', 'monogram', 'chat', 'inquiry', 'collect', 'arcade', 'challenge', 'chart', 'wrapped', 'sampler'];
export type Phase = 'booting' | 'ready' | 'readonly' | 'corrupt';

export interface Bubble {
  id: number;
  text: string;
  persona: Persona;
  until: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'warn' | 'info';
}

export interface ReleaseResult extends ReleaseInfo {
  persona: Persona;
}

/** 모노사파런 결과 요약 */
export interface RunSummary {
  distanceM: number;
  goalM: number;
  jellies: number;
  totalJellies: number;
  heartsLeft: number;
  seconds: number;
}

export interface ConcertResult extends ConcertOutcome {
  tally?: Record<Judgement, number>;
  run?: RunSummary;
}

/** 공연 종류에 따라 붙는 결과 정보 */
export interface ConcertExtra {
  tally?: Record<Judgement, number>;
  run?: RunSummary;
  /** 점수와 별개로 클리어가 정해지는 공연(모노사파런: 완주)이면 넘긴다. */
  cleared?: boolean;
}

/** 가챠 결과 창에 보여 줄 내용 */
export type GachaResult =
  | { kind: 'photo'; results: PhotoPullResult[]; sets: number[]; diamonds: number }
  | { kind: 'feat'; results: FeatPullResult[]; refund: number };

export interface ArcadeResultView {
  outcome: ArcadeOutcome;
  run: ArcadeRun;
}

export interface UiState {
  phase: Phase;
  game: GameState;
  loadError: { message: string; hasBackup: boolean } | null;
  saveError: string | null;
  offlineReport: OfflineReport | null;
  bubble: Bubble | null;
  toasts: Toast[];
  releaseResult: ReleaseResult | null;
  albumResult: AlbumInfo | null;
  concertRun: ConcertRun | null;
  concertResult: ConcertResult | null;
  tourCardOpen: boolean;
  tab: TabId;
  settingsOpen: boolean;
  basisOpen: boolean;
  /** 마이크 압수 직후 UI 연출용 시각 */
  seizedAt: number;
  /** 작업 입력이 인정될 때마다 증가. 캐릭터 애니메이션 트리거 */
  workPulse: number;
  /** 진행 중인 아케이드(리듬·생존·가사 덱·피켓팅). 전체화면이라 이 동안은 다른 탭으로 나갈 수 없다. */
  arcadeRun: ArcadeRun | null;
  arcadeResult: ArcadeResultView | null;
  /** 가사 덱을 끝낸 뒤 고를 수 있는 카드 후보 */
  lyricDraft: string[] | null;
  gachaResult: GachaResult | null;
  towerResult: TowerOutcome | null;
}

const FAIL_TEXT: Record<FailReason, string> = {
  insufficient_rhymes: '라임이 부족해요.',
  insufficient_coins: '코인이 부족해요.',
  insufficient_diamonds: '다이아가 부족해요.',
  nothing_to_skip: '지금은 쓸 필요가 없어요.',
  streaming_wait: '아직 정산할 수 없어요. 정산 간격이 지나야 해요.',
  nothing_to_claim: '정산할 스트리밍이 아직 없어요.',
  max_level: '이미 최대 레벨이에요.',
  locked: '아직 열리지 않은 공연장이에요.',
  cooldown: '공연장 쿨다운 중이에요.',
  same_persona: '이미 그 자아예요.',
  switch_lock: '전환 직후에는 잠시 재전환할 수 없어요.',
  heat_too_high: '과열이 높아서 어둠으로 전환할 수 없어요.',
  recovery: '마이크 압수 회복 중이라 어둠으로 돌아갈 수 없어요.',
  no_more_albums: '발매할 수 있는 앨범을 모두 냈어요.',
  not_found: '곡을 찾을 수 없어요.',
  session_closed: '이미 끝난 공연이에요.',
  input_limited: '',
  dark_only: '어둠속성으로만 입장할 수 있어요.',
  already_done: '이미 받았거나 더 쌓을 수 없어요.',
  not_ready: '아직 받을 수 없어요.',
  slots_full: '게시물 슬롯이 가득 찼어요.',
  owned: '이미 가지고 있어요.',
  not_owned: '아직 가지고 있지 않아요.',
  need_single: '첫 싱글을 발매한 뒤에 쓸 수 있어요.',
  no_ticket: '티켓이 부족해요.',
  need_duplicate: '중복으로 가진 카드만 쓸 수 있어요.',
  full_slots: '자리가 가득 찼어요.',
  too_few_cards: '덱은 이보다 줄일 수 없어요.',
};

/* ---------- 런타임(저장하지 않는) 변수 ---------- */

const memoryStore = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (k) => memoryStore.get(k) ?? null,
  setItem: (k, v) => void memoryStore.set(k, v),
  removeItem: (k) => void memoryStore.delete(k),
};
let storageBlocked = false;

/** 이 기기의 저장소(localStorage, 막혔으면 메모리). 계정 저장은 여기에 계정 ID 접두사를 붙여 쓴다. */
function deviceStorage(): StorageLike {
  try {
    const ls = window.localStorage;
    ls.getItem('__probe__');
    return ls;
  } catch {
    storageBlocked = true;
    return memoryStorage;
  }
}

/** 로그인한 계정의 로컬 저장소. boot(userId)에서 정해진다. */
let accountStorage: StorageLike | null = null;
let accountId: string | null = null;
const cloud = new CloudSync();

function getStorage(): StorageLike {
  if (!accountStorage) throw new Error('로그인 없이 저장소를 열 수 없어요.');
  return accountStorage;
}

const limiter = new InputLimiter();
let bubbleSeq = 0;
let toastSeq = 0;
let runSeq = 0;
let lastBubbleAt = 0;
let workAccepted = 0;
const lastLineKeys = new Map<string, string>();
let knownUnlocked = new Set<StageId>();
let hiddenSince: number | null = null;
let lastSaveAt = 0;
let lastUnlockCheck = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let listenersInstalled = false;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let ui: UiState = {
  phase: 'booting',
  game: createInitialState(Date.now()),
  loadError: null,
  saveError: null,
  offlineReport: null,
  bubble: null,
  toasts: [],
  releaseResult: null,
  albumResult: null,
  concertRun: null,
  concertResult: null,
  tourCardOpen: false,
  tab: 'studio',
  settingsOpen: false,
  basisOpen: false,
  seizedAt: 0,
  workPulse: 0,
  arcadeRun: null,
  arcadeResult: null,
  lyricDraft: null,
  gachaResult: null,
  towerResult: null,
};

const listeners = new Set<() => void>();
function set(patch: Partial<UiState>): void {
  ui = { ...ui, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getUi = () => ui;
export const useUi = (): UiState => useSyncExternalStore(subscribe, getUi);

/* ---------- 토스트·말풍선 ---------- */

export function toast(text: string, tone: Toast['tone'] = 'info'): void {
  if (!text) return;
  const t: Toast = { id: ++toastSeq, text, tone };
  set({ toasts: [...ui.toasts.slice(-2), t] });
  setTimeout(() => {
    ui = { ...ui, toasts: ui.toasts.filter((x) => x.id !== t.id) };
    listeners.forEach((l) => l());
  }, 3600);
}

function say(situation: Situation, event: boolean): void {
  const now = Date.now();
  if (!event && now - lastBubbleAt < 15_000) return;
  const persona = ui.game.activePersona;
  const mapKey = `${persona}.${situation}`;
  const picked = pickLine(persona, situation, ui.game.settings.dialogueTone, lastLineKeys.get(mapKey) ?? null);
  lastLineKeys.set(mapKey, picked.key);
  lastBubbleAt = now;
  set({ bubble: { id: ++bubbleSeq, text: picked.text, persona, until: now + (event ? 6500 : 5500) } });
}

/* ---------- 저장 ---------- */

/** immediate: 탭을 숨기거나 닫을 때처럼 서버에도 바로 올려야 할 때 */
function saveNow(immediate = false): void {
  if (ui.phase !== 'ready') return;
  const r = saveGame(getStorage(), ui.game, Date.now());
  lastSaveAt = Date.now();
  if (r.ok) {
    cloud.submit(r.state, immediate);
    ui = { ...ui, game: r.state, saveError: storageBlocked ? '브라우저가 저장을 막고 있어요. 새로고침하면 진행이 사라져요.' : null };
  } else {
    ui = { ...ui, saveError: r.error };
  }
  listeners.forEach((l) => l());
}

/* ---------- 정산 ---------- */

function handleEvents(events: EngineEvent[], offline: boolean): void {
  if (offline) return;
  for (const e of events) {
    if (e.type === 'heatHigh') say('heat', true);
    if (e.type === 'micSeized') {
      set({ seizedAt: Date.now() });
      say('micSeized', true);
      toast('🎤 마이크 압수! 일반속성으로 전환 — 20초간 생산 50%', 'warn');
      sfx.micSeized();
    }
  }
}

function mergeReport(prev: OfflineReport | null, next: OfflineReport): OfflineReport {
  if (!prev) return next;
  return {
    ...next,
    elapsedMs: prev.elapsedMs + next.elapsedMs,
    paidMs: prev.paidMs + next.paidMs,
    capped: prev.capped || next.capped,
    coins: prev.coins + next.coins,
    normalRhymes: prev.normalRhymes + next.normalRhymes,
    darkRhymes: prev.darkRhymes + next.darkRhymes,
    streams: prev.streams + next.streams,
    micSeized: prev.micSeized || next.micSeized,
    startedPersona: prev.startedPersona,
  };
}

/** 마지막 정산 시각부터 now까지 한 번 전진시킨다. 간격이 비정상적으로 길면 오프라인으로 본다. */
function settle(now: number, forceOffline = false): void {
  if (ui.phase !== 'ready') return;
  const g = ui.game;
  const gap = now - g.lastSettledAt;
  if (forceOffline || gap > BALANCE.offline.onlineMaxGapMs) {
    const r = settleOffline(g, now);
    const patch: Partial<UiState> = { game: r.state };
    if (r.elapsedMs >= BALANCE.offline.reportMinMs) {
      patch.offlineReport = mergeReport(ui.offlineReport, makeReport(g, r));
    }
    set(patch);
    handleEvents(r.events, true);
    return;
  }
  const r = settleOnline(g, now);
  if (r.state !== g) set({ game: r.state });
  handleEvents(r.events, false);
}

function checkUnlocks(): void {
  const g = ui.game;
  for (const def of STAGES) {
    const st = stageStatus(g, def.id);
    if (st.unlocked && !knownUnlocked.has(def.id)) {
      knownUnlocked.add(def.id);
      toast(`🎪 ${STAGE_TEXT[def.id].name} 해금!`, 'good');
      sfx.unlock();
    }
  }
}

function tick(): void {
  if (ui.phase !== 'ready' || document.hidden) return;
  const now = Date.now();
  settle(now);
  const b = ui.bubble;
  if (b && now > b.until) set({ bubble: null });
  if (now - lastBubbleAt > 15_000 && !ui.concertRun) say('idle', false);
  if (now - lastUnlockCheck > 1000) {
    lastUnlockCheck = now;
    checkUnlocks();
    rollDaily();
    checkAchievements();
  }
  if (now - lastSaveAt >= BALANCE.save.autosaveMs) saveNow();
}

/* ---------- 시작·종료 ---------- */

function startTicker(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, 200);
}

function stopTicker(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

function initKnownUnlocks(): void {
  knownUnlocked = new Set(STAGES.filter((d) => stageStatus(ui.game, d.id).unlocked).map((d) => d.id));
}

function beginSession(): void {
  const storage = getStorage();
  cloud.start(storage, adoptRemote);
  const loaded = loadGame(storage);
  if (loaded.status === 'corrupt') {
    set({ phase: 'corrupt', loadError: { message: loaded.error, hasBackup: loaded.hasBackup } });
    return;
  }
  const now = Date.now();
  const game = loaded.status === 'ok' ? loaded.state : createInitialState(now, prefersReducedMotion());
  setMuted(game.settings.muted);
  set({ phase: 'ready', game, loadError: null, offlineReport: null });
  initKnownUnlocks();
  if (loaded.status === 'ok') {
    settle(now, true); // 저장 이후 흐른 시간은 복귀 정산(오프라인)으로 한 번만 반영
    initKnownUnlocks();
  }
  if (accountId) void initSampler(accountId);
  rollDaily();
  checkAchievements(true); // 업적이 없던 예전 저장은 이미 달성한 것이 한꺼번에 열린다
  lastBubbleAt = Date.now() - 9000; // 첫 인사는 몇 초 뒤에
  saveNow();
  startTicker();
}

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener('visibilitychange', () => {
    bgm.setHidden(document.hidden);
    if (ui.phase !== 'ready') return;
    if (document.hidden) {
      settle(Date.now());
      saveNow(true);
      hiddenSince = Date.now();
    } else if (hiddenSince !== null) {
      hiddenSince = null;
      settle(Date.now(), true);
      initKnownUnlocks();
      saveNow();
    }
  });
  const flush = () => {
    if (ui.phase === 'ready') {
      settle(Date.now());
      saveNow(true);
    }
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  const unlockOnce = () => {
    unlockAudio();
    bgm.unlock();
    window.removeEventListener('pointerdown', unlockOnce);
    window.removeEventListener('keydown', unlockOnce);
  };
  window.addEventListener('pointerdown', unlockOnce);
  window.addEventListener('keydown', unlockOnce);
  setGuardHandlers({
    onTakeoverRequest: () => {
      if (ui.phase === 'ready') {
        settle(Date.now());
        saveNow(true);
      }
    },
    onLost: () => {
      stopTicker();
      cloud.stop();
      set({ phase: 'readonly' });
    },
  });
}

/** 로그인한 계정으로 게임을 시작한다. 서버 저장과 이 기기의 저장을 맞춘 뒤 불러온다. */
export async function boot(userId: string): Promise<void> {
  installListeners();
  const device = deviceStorage();
  accountId = userId;
  accountStorage = scopedStorage(device, userId);
  const writer = await acquireWriter();
  if (!writer) {
    set({ phase: 'readonly' });
    return;
  }
  await reconcileOnBoot(accountStorage, device, userId);
  beginSession();
}

export async function takeOver(): Promise<void> {
  const ok = await takeOverWriter();
  if (!ok || !accountStorage || !accountId) return;
  await reconcileOnBoot(accountStorage, deviceStorage(), accountId);
  beginSession();
}

/** 다른 기기가 더 최근에 저장했다. 이 기기의 게임을 서버 저장으로 바꿔 이어간다. */
function adoptRemote(remote: RemoteSave): void {
  if (ui.phase !== 'ready') return;
  try {
    getStorage().setItem(SAVE_KEY, JSON.stringify(remote.state));
  } catch {
    return;
  }
  cloud.adopt(remote.version);
  resetRuntime();
  stopTicker();
  beginSession();
  toast('다른 기기에서 더 최근에 저장해서 그 진행을 불러왔어요.', 'warn');
}

/** 로그아웃 전에: 지금 진행을 저장하고 서버에 올린다. */
export async function syncBeforeLeave(): Promise<void> {
  if (ui.phase !== 'ready') return;
  settle(Date.now());
  saveNow();
  await cloud.drain();
}

/* ---------- 명령 실행 ---------- */

/** 날짜·주가 바뀌었으면 미션 기준을 새로 잡고, 도착할 때가 된 팬 DM을 받은편지함에 넣는다. */
function rollDaily(): void {
  const g = ui.game;
  const rolled = rollTower(rollMail(rollMissions(g)));
  if (rolled !== g) set({ game: rolled });
}

/** 새로 달성한 업적을 열고 알린다. aggregate면 한꺼번에 하나의 토스트로 알린다(예전 저장을 처음 불러올 때). */
function checkAchievements(aggregate = false): void {
  const r = evaluateAchievements(ui.game);
  if (r.unlocked.length === 0) return;
  set({ game: r.state });
  if (aggregate || r.unlocked.length > 2) {
    const diamonds = r.unlocked.reduce((a, d) => a + d.diamonds, 0);
    toast(`🏅 업적 ${r.unlocked.length}개 달성! 💎 +${diamonds}`, 'good');
  } else {
    for (const d of r.unlocked) toast(`🏅 업적 달성: ${ACHIEVEMENT_TEXT[d.id]?.name ?? d.id} · 💎 +${d.diamonds}`, 'good');
  }
  sfx.unlock();
}

function exec<T extends object>(fn: (s: GameState) => CommandResult<T>): CommandResult<T> | null {
  if (ui.phase !== 'ready') return null;
  settle(Date.now());
  rollDaily();
  const r = fn(ui.game);
  if (r.ok) {
    set({ game: r.state });
    checkAchievements();
  }
  return r;
}

function failToast(reason: FailReason): void {
  const text = FAIL_TEXT[reason];
  if (text) toast(text, 'warn');
  sfx.fail();
}

/** 작업하기: 터치·포인터·키보드가 모두 이 함수를 통과하며 초당 상한이 공통 적용된다. */
export function doWork(): void {
  if (ui.phase !== 'ready') return;
  if (!limiter.accept(performance.now())) return;
  const r = exec(work);
  if (!r?.ok) return;
  workAccepted++;
  set({ workPulse: ui.workPulse + 1 });
  if (!playWorkSample()) sfx.work(ui.game.activePersona);
  if (workAccepted % 12 === 0) say('work', false);
}

export function doSwitch(target: Persona): void {
  const r = exec((s) => switchPersona(s, target));
  if (!r) return;
  if (!r.ok) {
    if (r.reason !== 'same_persona') failToast(r.reason);
    return;
  }
  sfx.switch(target);
  say('idle', true);
  saveNow();
}

export function doRelease(): void {
  const persona = ui.game.activePersona;
  const r = exec(releaseSingle);
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  set({ releaseResult: { ...r, persona } });
  say('release', true);
  sfx.release();
  saveNow();
}

export function doBuy(kind: EquipmentKind, persona: Persona = 'normal'): void {
  const r = exec((s) => buyEquipment(s, kind, persona));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  say('buy', true);
  sfx.buy();
  saveNow();
}

export function doBuyMusicPower(persona: Persona = 'normal'): void {
  const r = exec((s) => buyMusicPower(s, persona));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  say('buy', true);
  sfx.buy();
  saveNow();
}

/** 다이아로 공연 쿨다운을 바로 끝낸다. */
export function doSkipCooldown(stageId: StageId): void {
  const r = exec((s) => skipConcertCooldown(s, stageId));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`💎 ${r.cost}로 쿨다운을 건너뛰었어요.`, 'good');
  saveNow();
}

/** 다이아로 마이크 압수를 바로 해제한다 (과열도 식는다). */
export function doClearSeizure(): void {
  const r = exec(clearSeizure);
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  say('idle', true);
  toast(`💎 ${r.cost}로 마이크 압수를 풀었어요. 과열도 식었어요.`, 'good');
  saveNow();
}

/** 쌓인 스트리밍을 코인으로 정산한다. */
export function doClaimStreaming(): void {
  const r = exec(claimStreaming);
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`🎧 스트리밍 ${fmtStreams(r.streams)}회를 정산해서 🪙 ${fmt(r.coins)} 받았어요.`, 'good');
  saveNow();
}

export function doBuyDiamondUpgrade(kind: DiamondUpgradeKind): void {
  const r = exec((s) => buyDiamondUpgrade(s, kind));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  saveNow();
}

/* ---------- 상점·꾸미기 ---------- */

export function doBuySnack(id: SnackId): void {
  const r = exec((s) => buySnack(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`${SNACK_TEXT[id].icon} ${SNACK_TEXT[id].name} ${r.extended ? '시간이 늘었어요' : '효과 시작'}! 🪙 ${fmt(r.cost)}`, 'good');
  saveNow();
}

export function doBuyCampaign(id: CampaignId): void {
  const r = exec((s) => buyCampaign(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`${CAMPAIGN_TEXT[id].icon} ${CAMPAIGN_TEXT[id].name} ${r.extended ? '기간이 늘었어요' : '시작'}! 🪙 ${fmt(r.cost)}`, 'good');
  saveNow();
}

export function doBuyTheme(id: ThemeId): void {
  const r = exec((s) => buyTheme(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`${THEME_TEXT[id].icon} ${THEME_TEXT[id].name} 테마를 샀어요. 💎 ${r.cost}`, 'good');
  saveNow();
}

export function doSetTheme(id: ThemeId): void {
  const r = exec((s) => setTheme(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  saveNow();
}

export function doSetTitle(id: string | null): void {
  const r = exec((s) => setTitle(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  saveNow();
}

/* ---------- 미션·출석 ---------- */

export function doClaimMission(id: string): void {
  const r = exec((s) => claimMission(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`📅 미션 보상 💎 +${r.diamonds}`, 'good');
  saveNow();
}

export function doClaimAttendance(): void {
  const r = exec(claimAttendance);
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`📆 ${r.streak}일 연속 출석! 💎 +${r.diamonds}`, 'good');
  saveNow();
}

/* ---------- 팬 DM · 모노그램 ---------- */

export function doReplyMail(mailId: string, replyIndex: number): void {
  const r = exec((s) => replyMail(s, mailId, replyIndex));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  const gains = [
    r.fans !== 0 ? `👥 ${r.fans > 0 ? '+' : ''}${fmt(r.fans)}` : '',
    r.coins > 0 ? `🪙 +${fmt(r.coins)}` : '',
    r.diamonds > 0 ? `💎 +${r.diamonds}` : '',
  ].filter(Boolean);
  if (r.outcome === 'lose') sfx.fail();
  else sfx.buy();
  toast(`${r.reaction}${gains.length ? ` (${gains.join(' · ')})` : ''}`, r.outcome === 'lose' ? 'warn' : 'good');
  saveNow();
}

export function doStartPost(kind: PostKind): void {
  const r = exec((s) => startPost(s, kind));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  saveNow();
}

export function doCollectPost(id: string): void {
  const r = exec((s) => collectPost(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  if (r.outcome === 'viral') sfx.album();
  else sfx.buy();
  toast(`${r.comment} 👥 +${fmt(r.fans)}${r.diamonds > 0 ? ` · 💎 +${r.diamonds}` : ''}`, r.outcome === 'hate' ? 'warn' : 'good');
  saveNow();
}

export function doBuySlot(): void {
  const r = exec(buySlot);
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`📸 게시물 슬롯 ${r.slots}개! 💎 ${r.cost}`, 'good');
  saveNow();
}

export function doAlbum(): void {
  const r = exec(releaseAlbum);
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  set({ albumResult: r });
  sfx.album();
  saveNow();
}

export function doAutoConcert(stageId: StageId): void {
  const r = exec((s) => runAutoConcert(s, stageId));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  onConcertDone(r.outcome);
}

export function startManualConcert(stageId: StageId): void {
  if (ui.concertRun) return;
  const r = exec((s) => beginManualConcert(s, stageId, `run-${Date.now().toString(36)}-${++runSeq}`));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  set({ concertRun: r.run, concertResult: null });
  saveNow(); // 쿨다운 확정 즉시 저장: 새로고침으로 쿨다운을 되돌릴 수 없다
}

/** 공연 종료. 같은 run은 한 번만 보상을 받는다. */
export function finishManualConcertRun(runId: string, score: number, extra: ConcertExtra = {}): void {
  const run = ui.concertRun;
  if (!run || run.id !== runId || run.status !== 'running') return;
  const r = exec((s) => finishManualConcert(s, run, score, extra.cleared));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  set({ concertRun: r.run });
  onConcertDone({ ...r.outcome }, extra);
}

function onConcertDone(outcome: ConcertOutcome, extra: ConcertExtra = {}): void {
  set({ concertResult: { ...outcome, tally: extra.tally, run: extra.run } });
  sfx.finish(outcome.cleared);
  say(outcome.cleared ? 'concertWin' : 'concertLose', true);
  if (outcome.stageId === TOUR_STAGE && outcome.firstClear && !ui.game.tutorialFlags.tourCardSeen) {
    set({ game: { ...ui.game, tutorialFlags: { ...ui.game.tutorialFlags, tourCardSeen: true } }, tourCardOpen: true });
  }
  saveNow();
}

export function abandonManualConcert(): void {
  const run = ui.concertRun;
  if (!run) return;
  if (run.status === 'running') {
    abandonRun(run);
    toast('공연을 포기했어요. 쿨다운은 그대로 유지돼요.', 'warn');
  }
  set({ concertRun: null, concertResult: null });
}

export function closeConcertResult(): void {
  set({ concertResult: null, concertRun: null });
}

/* ---------- 수집·육성 (곡 카드·포토카드·피처링·마스코트) ---------- */

export function doToggleDeck(singleId: string): void {
  const r = exec((s) => toggleDeck(s, singleId));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  saveNow();
}

export function doRemaster(singleId: string): void {
  const r = exec((s) => remasterCard(s, singleId));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.album();
  toast(`✨ 리마스터 Lv.${r.level}! 🪙 ${fmt(r.cost)}`, 'good');
  saveNow();
}

export function doPhotoPull(count: number): void {
  const r = exec((s) => photoPull(s, count));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.pull(r.results.some((x) => x.grade >= BALANCE.photo.pityGrade));
  set({ gachaResult: { kind: 'photo', results: r.results, sets: r.sets, diamonds: r.diamonds } });
  saveNow();
}

export function doBuyTickets(n: number): void {
  const r = exec((s) => buyTickets(s, n));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`🎟️ 티켓 ${Math.round(r.cost / BALANCE.photo.ticketDiamonds)}장 구매 · 💎 ${r.cost}`, 'good');
  saveNow();
}

export function doDismantle(id: string): void {
  const r = exec((s) => dismantlePhoto(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`🔹 조각 +${r.shards}`, 'good');
  saveNow();
}

export function doCraft(id: string): void {
  const r = exec((s) => craftPhoto(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.album();
  if (r.diamonds > 0) toast(`🗂️ 세트 완성! 💎 +${r.diamonds}`, 'good');
  saveNow();
}

export function doFeatPull(count: 1 | 10): void {
  const r = exec((s) => featPull(s, count));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.pull(r.results.some((x) => x.rarity === 'SSR'));
  set({ gachaResult: { kind: 'feat', results: r.results, refund: r.refund } });
  saveNow();
}

export function doToggleFeat(id: string): void {
  const r = exec((s) => toggleFeat(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  saveNow();
}

export function doFeedMascot(persona: Persona): void {
  const r = exec((s) => feedMascot(s, persona, playerLevel(s.fans)));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.mascot();
  saveNow();
}

export function doPlayMascot(persona: Persona): void {
  const r = exec((s) => playMascot(s, persona));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.mascot();
  saveNow();
}

export function doGiftMascot(persona: Persona): void {
  const r = exec((s) => giftMascot(s, persona));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.album();
  saveNow();
}

export function doClaimPresent(persona: Persona): void {
  const r = exec((s) => claimPresent(s, persona));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  toast(`🎁 마스코트의 선물 🪙 +${fmt(r.coins)}${r.diamonds > 0 ? ` · 💎 +${r.diamonds}` : ''}`, 'good');
  saveNow();
}

export const closeGacha = () => set({ gachaResult: null });

/* ---------- 아케이드 ---------- */

let arcadeSeq = 0;

/** 아케이드 시작: 쿨다운은 이 시점에 확정된다. 포기해도 돌아오지 않는다. */
export function startArcade(kind: ArcadeRun['kind'], opts: { target?: string; level?: RhythmLevel } = {}): void {
  if (ui.arcadeRun) return;
  const r = exec((s) => beginArcade(s, kind, `arc-${Date.now().toString(36)}-${++arcadeSeq}`, opts));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  set({ arcadeRun: r.run, arcadeResult: null, lyricDraft: null });
  saveNow();
}

/** 아케이드 종료. 같은 실행은 한 번만 보상을 받는다. */
export function finishArcadeRun(runId: string, score: number): void {
  const run = ui.arcadeRun;
  if (!run || run.id !== runId || run.status !== 'running') return;
  const r = exec((s) => finishArcade(s, run, score));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  set({ arcadeRun: r.run, arcadeResult: { outcome: r.outcome, run: r.run }, lyricDraft: run.kind === 'lyric' ? draftChoices(run.seed) : null });
  sfx.finish(r.outcome.grade !== 'C');
  saveNow();
}

export function abandonArcadeRun(): void {
  const run = ui.arcadeRun;
  if (!run) return;
  if (run.status === 'running') {
    abandonArcade(run);
    toast('중간에 나갔어요. 쿨다운은 그대로 유지돼요.', 'warn');
  }
  set({ arcadeRun: null, arcadeResult: null, lyricDraft: null });
}

export const closeArcadeResult = () => set({ arcadeRun: null, arcadeResult: null, lyricDraft: null });

/** 가사 덱 보상 카드를 덱에 넣는다. */
export function doPickLyricCard(id: string): void {
  const r = exec((s) => addLyricCard(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
  set({ lyricDraft: null });
  saveNow();
}

export const skipLyricDraft = () => set({ lyricDraft: null });

export function doTrimLyricCard(id: string): void {
  const r = exec((s) => trimLyricCard(s, id));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  saveNow();
}

export function doClimbTower(persona: Persona): void {
  const r = exec((s) => climbTower(s, persona));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.finish(r.outcome.win);
  set({ towerResult: r.outcome });
  saveNow();
}

export const closeTowerResult = () => set({ towerResult: null });

/* ---------- 서버가 계산해 준 보상·교환 ---------- */

/** 챌린지에 한 줄을 올렸다고 알린다 (카운터). */
export function notifyChallengePosted(): void {
  exec(applyChallengePosted);
  saveNow();
}

export async function doClaimChallenge(): Promise<boolean> {
  try {
    const res = await api<{ week: number; rank: number; diamonds: number; text: string }>('challenge/claim', { method: 'POST' });
    const r = exec((s) => applyChallengeClaim(s, res.diamonds, res.rank, res.text));
    if (r?.ok) {
      sfx.album();
      toast(`🏆 챌린지 ${res.rank}위! 💎 +${r.diamonds}${r.noted ? ' · 가사 노트에 남겼어요' : ''}`, 'good');
      saveNow(true);
    }
    return true;
  } catch (e) {
    toast(errorText(e), 'warn');
    return false;
  }
}

export async function doClaimChart(): Promise<boolean> {
  try {
    const res = await api<{ rank: number; title: string; diamonds: number; no1: boolean }>('chart/claim', { method: 'POST' });
    const r = exec((s) => applyChartClaim(s, res.diamonds, res.no1));
    if (r?.ok) {
      sfx.album();
      toast(`📈 「${res.title}」 차트 ${res.rank}위! 💎 +${r.diamonds}`, 'good');
      saveNow(true);
    }
    return true;
  } catch (e) {
    toast(errorText(e), 'warn');
    return false;
  }
}

/** 중복 카드를 교환소에 맡긴다. 서버가 거절하면 카드를 돌려받는다. */
export async function doPostTrade(give: string, want: string): Promise<boolean> {
  const taken = exec((s) => takeCard(s, give));
  if (!taken) return false;
  if (!taken.ok) {
    failToast(taken.reason);
    return false;
  }
  saveNow(true);
  try {
    await api('trades', { method: 'POST', body: { give, want } });
    toast('🔁 교환을 올렸어요.', 'good');
    return true;
  } catch (e) {
    exec((s) => giveCard(s, give));
    saveNow(true);
    toast(errorText(e), 'warn');
    return false;
  }
}

/** 다른 사람이 올린 교환을 가져간다: 내 중복 카드(want)를 내고 그 사람의 카드(give)를 받는다. */
export async function doAcceptTrade(id: string, give: string, want: string): Promise<boolean> {
  const paid = exec((s) => takeCard(s, want));
  if (!paid) return false;
  if (!paid.ok) {
    failToast(paid.reason);
    return false;
  }
  saveNow(true);
  try {
    await api('trades/' + id + '/accept', { method: 'POST' });
  } catch (e) {
    exec((s) => giveCard(s, want));
    saveNow(true);
    toast(errorText(e), 'warn');
    return false;
  }
  const got = exec((s) => giveCard(s, give, true));
  if (got?.ok) {
    sfx.album();
    toast(`🔁 교환 완료! 💎 ${got.diamonds > 0 ? `세트 완성 +${got.diamonds}` : ''}`.trim(), 'good');
  }
  saveNow(true);
  return true;
}

/** 내 교환이 가져가졌으면 원하던 카드를 받는다. */
export async function doCollectTrade(id: string): Promise<boolean> {
  try {
    const res = await api<{ card: string }>('trades/' + id + '/collect', { method: 'POST' });
    const got = exec((s) => giveCard(s, res.card, true));
    if (got?.ok) {
      sfx.album();
      toast('🔁 원하던 카드를 받았어요!', 'good');
    }
    saveNow(true);
    return true;
  } catch (e) {
    toast(errorText(e), 'warn');
    return false;
  }
}

/** 아직 아무도 가져가지 않은 교환을 거두고 카드를 돌려받는다. */
export async function doCancelTrade(id: string): Promise<boolean> {
  try {
    const res = await api<{ card: string }>('trades/' + id + '/cancel', { method: 'POST' });
    exec((s) => giveCard(s, res.card));
    saveNow(true);
    toast('교환을 거두고 카드를 돌려받았어요.', 'info');
    return true;
  } catch (e) {
    toast(errorText(e), 'warn');
    return false;
  }
}

/* ---------- 화면 상태 ---------- */

export const setTab = (tab: TabId) => set({ tab });
export const dismissOfflineReport = () => set({ offlineReport: null });
export const dismissRelease = () => set({ releaseResult: null });
export const dismissAlbum = () => set({ albumResult: null });
export const setSettingsOpen = (open: boolean) => set({ settingsOpen: open });
export const setBasisOpen = (open: boolean) => set({ basisOpen: open });
export const setTourCardOpen = (open: boolean) => set({ tourCardOpen: open });

export function updateSettings(patch: Partial<Settings>): void {
  if (ui.phase !== 'ready') return;
  const settings = { ...ui.game.settings, ...patch };
  set({ game: { ...ui.game, settings } });
  if (patch.muted !== undefined) setMuted(patch.muted);
  saveNow();
}

/* ---------- 저장 내보내기·불러오기·초기화·복구 ---------- */

function resetRuntime(): void {
  lastLineKeys.clear();
  workAccepted = 0;
  limiter.reset();
  set({
    bubble: null,
    toasts: [],
    releaseResult: null,
    albumResult: null,
    concertRun: null,
    concertResult: null,
    tourCardOpen: false,
    offlineReport: null,
    arcadeRun: null,
    arcadeResult: null,
    lyricDraft: null,
    gachaResult: null,
    towerResult: null,
    tab: 'studio',
  });
}

export function recoverBackup(): { ok: boolean; message: string } {
  const r = recoverFromBackup(getStorage());
  if (!r.ok) return { ok: false, message: r.error };
  beginSession();
  toast('백업에서 복구했어요.', 'good');
  return { ok: true, message: '복구했어요.' };
}

export function startNewAfterCorrupt(): void {
  discardCorrupt(getStorage());
  beginSession();
}
