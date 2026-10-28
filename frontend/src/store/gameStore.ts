import { useSyncExternalStore } from 'react';
import { bgm } from '../audio/bgm';
import { sfx, setMuted, unlockAudio } from '../audio/sfx';
import { BALANCE, STAGES, TOUR_STAGE } from '../game/balance';
import {
  abandonConcert as abandonRun,
  beginManualConcert,
  buyDiamondUpgrade,
  buyEquipment,
  buyMusicPower,
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
import { STAGE_TEXT, pickLine, type Situation } from '../game/content';
import { InputLimiter } from '../game/input';
import type { Judgement } from '../game/minigame';
import {
  createInitialState,
  discardCorrupt,
  exportSave,
  importSave,
  loadGame,
  recoverFromBackup,
  resetSave,
  saveGame,
  type StorageLike,
} from '../game/persistence';
import { stageStatus } from '../game/selectors';
import { makeReport, settleOffline, settleOnline, type OfflineReport } from '../game/simulation';
import type {
  CommandResult,
  DiamondUpgradeKind,
  EngineEvent,
  EquipmentKind,
  FailReason,
  GameState,
  Persona,
  Settings,
  StageId,
} from '../game/types';
import { acquireWriter, setGuardHandlers, takeOverWriter } from '../platform/tabGuard';

export type TabId = 'studio' | 'release' | 'equip' | 'concert' | 'collection';
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
}

const FAIL_TEXT: Record<FailReason, string> = {
  insufficient_rhymes: '라임이 부족해요.',
  insufficient_coins: '코인이 부족해요.',
  insufficient_diamonds: '다이아가 부족해요.',
  nothing_to_skip: '지금은 쓸 필요가 없어요.',
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
};

/* ---------- 런타임(저장하지 않는) 변수 ---------- */

const memoryStore = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (k) => memoryStore.get(k) ?? null,
  setItem: (k, v) => void memoryStore.set(k, v),
  removeItem: (k) => void memoryStore.delete(k),
};
let storageBlocked = false;

function getStorage(): StorageLike {
  try {
    const ls = window.localStorage;
    ls.getItem('__probe__');
    return ls;
  } catch {
    storageBlocked = true;
    return memoryStorage;
  }
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

function saveNow(): void {
  if (ui.phase !== 'ready') return;
  const r = saveGame(getStorage(), ui.game, Date.now());
  lastSaveAt = Date.now();
  if (r.ok) {
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
      saveNow();
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
      saveNow();
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
        saveNow();
      }
    },
    onLost: () => {
      stopTicker();
      set({ phase: 'readonly' });
    },
  });
}

export async function boot(): Promise<void> {
  installListeners();
  const writer = await acquireWriter();
  if (!writer) {
    set({ phase: 'readonly' });
    return;
  }
  beginSession();
}

export async function takeOver(): Promise<void> {
  const ok = await takeOverWriter();
  if (ok) beginSession();
}

/* ---------- 명령 실행 ---------- */

function exec<T extends object>(fn: (s: GameState) => CommandResult<T>): CommandResult<T> | null {
  if (ui.phase !== 'ready') return null;
  settle(Date.now());
  const r = fn(ui.game);
  if (r.ok) set({ game: r.state });
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
  sfx.work(ui.game.activePersona);
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

export function doBuyDiamondUpgrade(kind: DiamondUpgradeKind): void {
  const r = exec((s) => buyDiamondUpgrade(s, kind));
  if (!r) return;
  if (!r.ok) return failToast(r.reason);
  sfx.buy();
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

export function exportText(): string {
  if (ui.phase === 'ready') settle(Date.now());
  return exportSave(ui.game, Date.now());
}

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
    tab: 'studio',
  });
}

export function importFromText(text: string): { ok: boolean; message: string } {
  const r = importSave(getStorage(), text, Date.now());
  if (!r.ok) return { ok: false, message: r.error };
  resetRuntime();
  stopTicker();
  beginSession();
  toast('저장을 불러왔어요. (불러온 시점부터 이어서 진행)', 'good');
  return { ok: true, message: '불러왔어요.' };
}

export function resetAll(): void {
  resetSave(getStorage());
  resetRuntime();
  stopTicker();
  set({ settingsOpen: false });
  beginSession();
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
