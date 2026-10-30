import { BALANCE } from './balance';
import { CLAP_REACTION, MAIL_NICKS, MAIL_TEMPLATES, mailTemplateById, type MailKind, type MailReply } from './content';
import { NICK_LIMIT } from './pack-state';
import { mulberry32 } from './runner';
import { clampResource, levelUpDiamonds, royaltyBreakdown } from './selectors';
import { mix } from './streaming';
import { track } from './tracking';
import type { CommandResult, Fail, FailReason, FanMail, GameState, Mail } from './types';

/*
 * 팬 DM. 일정 간격마다 한 통씩 도착하고, 내용·보낸 사람은 씨앗과 번호로만 정해진다(순수 함수).
 * 답장은 템플릿의 등급(tier)에 따라 팬·코인·다이아가 바뀐다. 받아치기만 씨앗으로 이기고 지는 도박이다.
 */

const M = BALANCE.fanMail;
const MAIL_SALT = 0x6d61696c;
const GAP_SALT = 0x67617073;
/** 한 번 굴릴 때 따라잡는 DM 수의 상한. 기기 시계가 아주 앞서가도 오래 멈추지 않게 한다(받은편지함은 어차피 cap통까지다). */
const MAX_CATCH_UP = 500;

const fail = (state: GameState, reason: FailReason): Fail => ({ ok: false, reason, state });

export function emptyFanMail(now: number, seed: number): FanMail {
  return { seed, seq: 0, nextAt: now + M.firstDelayMs, inbox: [] };
}

function pickKind(r: number): MailKind {
  const w = M.weights;
  const total = w.support + w.empathy + w.anti;
  const x = r * total;
  return x < w.support ? 'support' : x < w.support + w.empathy ? 'empathy' : 'anti';
}

function makeMail(seed: number, seq: number, at: number): Mail {
  const rng = mulberry32(mix(seed ^ MAIL_SALT, seq));
  rng(); // 첫 값은 씨앗과 닮기 쉬워 버린다
  const kind = pickKind(rng());
  const pool = MAIL_TEMPLATES.filter((t) => t.kind === kind);
  const tpl = pool[Math.floor(rng() * pool.length)];
  const nick = MAIL_NICKS[Math.floor(rng() * MAIL_NICKS.length)];
  return { id: `mail-${seq}`, tpl: tpl.id, nick, at };
}

/** n번째 DM이 온 뒤 다음 DM이 오기까지 걸리는 시간(ms). 7~17분 사이 무작위이고 씨앗과 번호가 같으면 항상 같다. 초 단위로 맞춘다. */
export function mailIntervalMs(seed: number, seq: number): number {
  const rng = mulberry32(mix(seed ^ GAP_SALT, seq));
  rng(); // 첫 값은 씨앗과 닮기 쉬워 버린다
  return Math.round((M.intervalMinMs + rng() * (M.intervalMaxMs - M.intervalMinMs)) / 1000) * 1000;
}

/**
 * 도착할 때가 된 DM을 받은편지함에 넣는다. 팬이 있어야 오고, 한꺼번에 오는 건 받은편지함 크기까지다.
 * 도착 시각은 DM마다 무작위 간격으로 이어지고, 한 번에 굴리든 여러 번 나눠 굴리든 같은 시각에 같은 DM이 온다.
 * 도착할 게 없으면 같은 상태를 돌려준다.
 */
export function rollMail(s: GameState): GameState {
  const now = s.lastSettledAt;
  const fm = s.fanMail;
  if (now < fm.nextAt) return s;
  if (s.fans < 1) return { ...s, fanMail: { ...fm, nextAt: now + M.firstDelayMs } }; // 팬이 생길 때까지 미룬다
  const inbox = [...fm.inbox];
  let seq = fm.seq;
  let nextAt = fm.nextAt;
  for (let i = 0; nextAt <= now && i < MAX_CATCH_UP; i++) {
    seq++;
    inbox.push(makeMail(fm.seed, seq, nextAt));
    nextAt += mailIntervalMs(fm.seed, seq);
  }
  if (nextAt <= now) nextAt = now + mailIntervalMs(fm.seed, seq); // 다 따라잡지 못했으면 지금부터 다시 센다
  return { ...s, fanMail: { ...fm, seq, nextAt, inbox: inbox.slice(-M.cap) } };
}

/** 팬별 답장 횟수에 한 번 더한다. 상위 NICK_LIMIT명만 남기고 가장 적은 사람이 밀려난다. */
export function tallyNick(nicks: Record<string, number>, rawNick: string): Record<string, number> {
  // 서버(MongoDB)는 키에 '.'과 '$'를 허용하지 않으므로 바꿔서 센다.
  const nick = rawNick.replace(/[.$]/g, '·');
  const next = { ...nicks, [nick]: (nicks[nick] ?? 0) + 1 };
  const names = Object.keys(next);
  if (names.length > NICK_LIMIT) {
    const lowest = names.filter((n) => n !== nick).sort((a, b) => next[a] - next[b])[0];
    delete next[lowest];
  }
  return next;
}

export interface MailReplyInfo {
  mail: Mail;
  kind: MailKind;
  reply: MailReply;
  /** 부호 있는 팬 증감 */
  fans: number;
  coins: number;
  diamonds: number;
  /** 받아치기였을 때만: 이겼는지 */
  outcome: 'win' | 'lose' | null;
  reaction: string;
}

/** 이 답장 등급이 지금 얼마를 주는지 미리 계산해 보여 줄 때도 쓴다. 받아치기는 이긴 경우와 진 경우를 따로 본다. */
export function replyEffect(
  s: GameState,
  tier: MailReply['tier'],
  clap: 'win' | 'lose' = 'win',
): { fans: number; coins: number; diamonds: number } {
  const eff = tier === 'clap' ? M.clap[clap] : M.effects[tier];
  const fans =
    eff.fansPct > 0 ? Math.max(1, Math.ceil(s.fans * eff.fansPct)) : eff.fansPct < 0 ? -Math.min(Math.floor(s.fans), Math.ceil(s.fans * -eff.fansPct)) : 0;
  const coins = eff.coinSecs > 0 ? Math.max(M.minCoins, Math.ceil(royaltyBreakdown(s).perSec * eff.coinSecs)) : 0;
  return { fans, coins, diamonds: eff.diamonds };
}

export function replyMail(state: GameState, mailId: string, replyIndex: number): CommandResult<MailReplyInfo> {
  const mail = state.fanMail.inbox.find((m) => m.id === mailId);
  const tpl = mail ? mailTemplateById(mail.tpl) : undefined;
  const reply = tpl?.replies[replyIndex];
  if (!mail || !tpl || !reply) return fail(state, 'not_found');

  let outcome: 'win' | 'lose' | null = null;
  if (reply.tier === 'clap') {
    const rng = mulberry32(mix(state.fanMail.seed ^ 0x636c6170, Number(mail.id.slice(5)) || 0));
    rng();
    outcome = rng() < M.clap.winChance ? 'win' : 'lose';
  }
  const eff = replyEffect(state, reply.tier, outcome ?? 'win');
  const fans = clampResource(state.fans + eff.fans);
  const diamonds = eff.diamonds + levelUpDiamonds(state.fans, fans);
  let next: GameState = {
    ...state,
    fans,
    coins: clampResource(state.coins + eff.coins),
    diamonds: clampResource(state.diamonds + diamonds),
    fanMail: { ...state.fanMail, inbox: state.fanMail.inbox.filter((m) => m.id !== mailId) },
  };
  next = track(next, 'mails');
  if (tpl.kind === 'anti') next = track(next, 'antiMails');
  next = { ...next, stats: { ...next.stats, nicks: tallyNick(next.stats.nicks, mail.nick) } };
  return {
    ok: true,
    state: next,
    mail,
    kind: tpl.kind,
    reply,
    fans: eff.fans,
    coins: eff.coins,
    diamonds,
    outcome,
    reaction: outcome ? CLAP_REACTION[outcome] : reply.reaction,
  };
}
