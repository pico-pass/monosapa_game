import { BALANCE } from './balance';
import { mulberry32 } from './runner';
import { mix } from './streaming';
import type { Persona } from './types';

/*
 * 후원 채팅 스와이프: 비밀 공연장 「다크웹 라이브공연」의 직접 공연. 방송 채팅에 올라오는 글을 받을지(수락) 막을지(차단) 정한다.
 * 곡마다 검열 규칙이 하나씩 늘어나고, 아직 적용되지 않은 규칙의 특징은 멀쩡한 글에 일부러 섞여 있다.
 * 규칙은 React·DOM과 무관하고 글은 씨앗 난수 순서로만 만들어진다. 수치와 규칙 설명은 balance.ts의 BALANCE.swipe.
 */

const B = BALANCE.swipe;

export type RuleId = 'toxic' | 'link' | 'small' | 'fake';
export type Badge = 'none' | 'fan' | 'fake';

export interface ChatMsg {
  id: number;
  nick: string;
  text: string;
  tone: 'cheer' | 'hate';
  /** 링크가 들어 있다 */
  link: boolean;
  /** 후원 금액(원), 후원이 아니면 0 */
  amount: number;
  /** 공식 마크: fan = 팬클럽, fake = 미인증 공식 마크(사칭) */
  badge: Badge;
  /** 지금 곡의 규칙으로 막아야 하는 글이면 true */
  block: boolean;
  /** 막아야 하는 이유(규칙) */
  why: RuleId | null;
}

export type SwipeStatus = 'running' | 'finished';

export type SwipeEvent =
  | { type: 'msg'; msg: ChatMsg }
  | { type: 'right'; combo: number; accepted: boolean }
  | { type: 'wrong'; accepted: boolean; why: RuleId | null }
  | { type: 'timeout' }
  | { type: 'wave'; index: number }
  | { type: 'waveEnd'; index: number; ratio: number }
  | { type: 'end' };

export interface SwipeSummary {
  /** 넘긴 글 수 */
  handled: number;
  right: number;
  wrong: number;
  timeouts: number;
  /** 막은 글 / 받은 글 */
  blocked: number;
  accepted: number;
  bestCombo: number;
  /** 곡별 열기 달성률(%, 100이 상한) */
  waves: number[];
  seconds: number;
}

export const NICKS = ['익명#3921', 'ghost_07', '새벽의_구독자', 'void.kim', '밤샘러', 'mono_fan_1', '404_not_found', '야행성', 'deep_blue', 'noname', '스트림봇', 'a_lurker', '지나가던_사람', 'x_x_x', '심야시청', 'null'];
export const CHEER_TEXTS = ['오늘 무대 최고예요!', '노래 계속 듣고 있어요', '앵콜 가자!!', '목소리 미쳤다', '믹스테이프 또 내주세요', '가사가 너무 좋아요', '라이브가 음원보다 낫다', '끝까지 볼게요', '이 곡 뭐예요? 소름', '응원합니다 항상'];
export const HATE_TEXTS = ['노잼 접어라', '이걸 노래라고?', '표절 아님?', '목소리 별로', '시간 아깝다', '왜 뜬 거야 진짜', '재능 없어 보임', '다 거품이다'];
export const LINK_TEXTS = ['공짜 티켓 나눔 → 링크', '이벤트 당첨! 여기 눌러요', '구독자 늘려 드려요 링크 확인', '무료 굿즈 받아가세요 링크'];
export const FAKE_TEXTS = ['공식 계정입니다. DM 주세요', '운영진입니다 인증 필요해요', '공식 팬클럽 가입 안내드려요'];
export const RULE_TEXT: Record<RuleId, string> = {
  toxic: '악플은 차단',
  link: '링크가 든 글은 차단',
  small: `${B.minDonation.toLocaleString()}원 미만 소액 후원은 차단`,
  fake: '미인증 공식 마크(사칭)는 차단',
};

/** 곡 번호에 적용되는 규칙 */
export const rulesOf = (wave: number): readonly RuleId[] => B.rules[wave] as readonly RuleId[];

const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

/**
 * 글 하나를 만든다. 규칙을 어기는 글(badRate)은 규칙 하나만 어기고, 규칙에 걸리지 않는 글은 멀쩡하다.
 * 멀쩡한 글에는 아직 적용되지 않은 규칙의 특징(링크·소액 후원·사칭 마크)이 일부러 섞이기도 한다(decoyRate).
 */
export function makeMessage(rng: () => number, id: number, rules: readonly RuleId[]): ChatMsg {
  const nick = pick(rng, NICKS);
  const base: ChatMsg = { id, nick, text: '', tone: 'cheer', link: false, amount: 0, badge: 'none', block: false, why: null };
  const bad = rng() < B.badRate;
  if (bad) {
    const why = pick(rng, rules);
    base.block = true;
    base.why = why;
    if (why === 'toxic') {
      base.tone = 'hate';
      base.text = pick(rng, HATE_TEXTS);
      if (rng() < 0.3) base.badge = 'fan';
    } else if (why === 'link') {
      base.link = true;
      base.text = pick(rng, LINK_TEXTS);
    } else if (why === 'small') {
      base.amount = 1000 + 500 * Math.floor(rng() * 8);
      base.text = `${base.amount.toLocaleString()}원 후원합니다!`;
    } else {
      base.badge = 'fake';
      base.text = pick(rng, FAKE_TEXTS);
    }
    return base;
  }
  // 멀쩡한 글: 규칙에 걸리지 않게 만들되, 꺼져 있는 규칙의 특징이 섞일 수 있다.
  base.text = pick(rng, CHEER_TEXTS);
  if (rng() < 0.3) base.badge = 'fan';
  if (rng() < B.decoyRate) {
    const off = (['link', 'small', 'fake'] as const).filter((r) => !rules.includes(r));
    if (off.length > 0) {
      const decoy = pick(rng, off);
      if (decoy === 'link') {
        base.link = true;
        base.text = pick(rng, ['방송 다시보기 링크 올려요', '가사 정리했어요 링크', '클립 모음 링크 공유해요']);
      } else if (decoy === 'small') {
        base.amount = 1000 + 500 * Math.floor(rng() * 8);
        base.text = `${base.amount.toLocaleString()}원 후원합니다!`;
      } else {
        base.badge = 'fake';
        base.text = pick(rng, ['공식 마크 달았어요 ㅎㅎ', '인증 신청 중이에요 응원해요']);
      }
      return base;
    }
  }
  // 규칙이 허락하는 큰 후원이 섞일 수 있다.
  if (rng() < 0.3) {
    base.amount = B.minDonation * (1 + Math.floor(rng() * 6));
    base.text = `${base.amount.toLocaleString()}원 후원합니다!`;
  }
  return base;
}

export class ChatSwipeGame {
  readonly persona: Persona;
  readonly seed: number;
  status: SwipeStatus = 'running';
  waveIdx = 0;
  waveMs = 0;
  elapsedMs = 0;
  /** 지금 넘겨야 하는 글. 글과 글 사이(gapLeftMs)에는 null */
  msg: ChatMsg | null = null;
  /** 지금 글의 남은 제한 시간 */
  leftMs = 0;
  /** 다음 글이 나오기까지 남은 시간 */
  gapLeftMs: number = B.introMs;
  combo = 0;
  bestCombo = 0;
  right = 0;
  wrong = 0;
  timeouts = 0;
  blocked = 0;
  accepted = 0;
  /** 곡별 열기(0 아래로는 안 내려간다) */
  heat: number[] = B.waves.map(() => 0);
  /** 끝난 곡의 열기 달성률 */
  ratios: number[] = [];
  /** 바뀔 때마다 오르는 번호 */
  rev = 0;
  /** 화면·효과음용 사건. 읽는 쪽이 비운다. */
  events: SwipeEvent[] = [];
  private rng: () => number;
  private nextId = 1;

  constructor(persona: Persona, seed: number) {
    this.persona = persona;
    this.seed = seed >>> 0;
    this.rng = mulberry32(mix(this.seed, 2024));
  }

  get over(): boolean {
    return this.status === 'finished';
  }
  get rules(): readonly RuleId[] {
    return rulesOf(this.waveIdx);
  }
  get limitMs(): number {
    return B.limitMs[this.waveIdx];
  }
  get goal(): number {
    return B.goals[this.waveIdx];
  }
  get remainingMs(): number {
    return Math.max(0, B.waves[this.waveIdx].ms - this.waveMs);
  }
  get handled(): number {
    return this.right + this.wrong + this.timeouts;
  }
  waveRatio(i: number): number {
    if (i < this.ratios.length) return this.ratios[i];
    if (i > this.waveIdx || this.status === 'finished') return 0;
    return Math.max(0, Math.min(1, this.heat[i] / B.goals[i]));
  }
  get score(): number {
    let sum = 0;
    for (let i = 0; i < B.waves.length; i++) sum += B.waveScore * this.waveRatio(i);
    return Math.round(sum);
  }
  get cleared(): boolean {
    return this.score >= BALANCE.concert.clearScore;
  }
  get summary(): SwipeSummary {
    return {
      handled: this.handled,
      right: this.right,
      wrong: this.wrong,
      timeouts: this.timeouts,
      blocked: this.blocked,
      accepted: this.accepted,
      bestCombo: this.bestCombo,
      waves: B.waves.map((_, i) => Math.round(this.waveRatio(i) * 100)),
      seconds: Math.round(this.elapsedMs / 1000),
    };
  }

  private emit(e: SwipeEvent): void {
    this.events.push(e);
    this.rev++;
  }

  private addHeat(delta: number): void {
    this.heat[this.waveIdx] = Math.max(0, this.heat[this.waveIdx] + delta);
  }

  private next(): void {
    this.msg = null;
    this.gapLeftMs = B.gapMs;
  }

  /** 지금 글을 넘긴다. 오른쪽(수락) = true, 왼쪽(차단) = false. 글이 없으면 아무 일도 없다. */
  answer(accept: boolean): boolean {
    const m = this.msg;
    if (this.status !== 'running' || !m) return false;
    if (accept) this.accepted++;
    else this.blocked++;
    if (accept === !m.block) {
      this.right++;
      this.addHeat(B.heat.right + B.heat.combo * Math.min(this.combo, B.heat.comboCap));
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.emit({ type: 'right', combo: this.combo, accepted: accept });
    } else {
      this.wrong++;
      this.addHeat(-B.heat.wrong);
      this.combo = 0;
      this.emit({ type: 'wrong', accepted: accept, why: m.why });
    }
    this.next();
    return true;
  }

  private endWave(): void {
    const ratio = this.waveRatio(this.waveIdx);
    this.ratios.push(ratio);
    this.msg = null;
    this.emit({ type: 'waveEnd', index: this.waveIdx, ratio });
    if (this.waveIdx + 1 >= B.waves.length) {
      this.status = 'finished';
      this.emit({ type: 'end' });
    } else {
      this.waveIdx++;
      this.waveMs = 0;
      this.gapLeftMs = B.introMs;
      this.emit({ type: 'wave', index: this.waveIdx });
    }
  }

  /** 실제 경과 시간을 넣는다. 글 제한 시간, 다음 글 대기, 곡 전환을 시간 순서대로 처리한다. */
  advance(dtMs: number): void {
    let left = Math.max(0, dtMs);
    while (left > 0 && this.status === 'running') {
      const room = B.waves[this.waveIdx].ms - this.waveMs;
      // 이번 걸음: 곡 끝, 글 제한 시간, 대기 시간 중 가장 가까운 것까지
      let step = Math.min(left, room);
      if (this.msg) step = Math.min(step, this.leftMs);
      else step = Math.min(step, this.gapLeftMs);
      this.waveMs += step;
      this.elapsedMs += step;
      left -= step;
      if (this.msg) {
        this.leftMs -= step;
        if (this.leftMs <= 1e-9 && this.waveMs < B.waves[this.waveIdx].ms) {
          this.timeouts++;
          this.addHeat(-B.heat.timeout);
          this.combo = 0;
          this.emit({ type: 'timeout' });
          this.next();
        }
      } else {
        this.gapLeftMs -= step;
        if (this.gapLeftMs <= 1e-9 && this.waveMs < B.waves[this.waveIdx].ms) {
          this.msg = makeMessage(this.rng, this.nextId++, this.rules);
          this.leftMs = this.limitMs;
          this.emit({ type: 'msg', msg: this.msg });
        }
      }
      if (this.waveMs >= B.waves[this.waveIdx].ms - 1e-9) this.endWave();
    }
  }
}
