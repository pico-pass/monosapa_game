/*
 * 정식 출시 초기화(한 번만 실행하는 운영 작업). `scripts/launch-reset.mjs` 가 불러 쓴다.
 * Nest 에 의존하지 않고 몽고 Db 만 받아서 어느 데이터베이스에든 돌릴 수 있다(리허설용 복사본에도).
 *
 * 순서(실행 모드): 계획 확정(순위 보상 명단) → 전체 백업 → 저장 세대 올림(이때부터 옛 저장 차단) →
 *   출시 우편·장부 → 진행 데이터 정리 → 완료 표시. 단계마다 여러 번 실행해도 결과가 같고(키로 중복 방지),
 *   중간에 멈추면 같은 명령으로 이어서 한다(순위 명단은 처음에 정한 것을 저장해 두고 그대로 쓴다).
 */
import { Types, type mongo } from 'mongoose';
import { displayNameOf } from '../users/profile.js';
import { LAUNCH, launchRef, planRankRewards, rankMailText, starterMailText, type RankReward } from './rules.js';

type Db = mongo.Db;
type Doc = Record<string, unknown>;

/** 게임 진행·유저끼리의 진행 장부: 정식 출시 때 모두 비운다. (계정·프로필·친구·문의·신고·챗·세션은 남긴다) */
export const CLEAR_COLLECTIONS = [
  'saves',
  'trades',
  'boss_weeks',
  'boss_players',
  'boss_logs',
  'village_flags',
  'chart_claims',
  'live_rewards',
  'live_daily',
  'challenge_entries',
  'friend_gifts',
] as const;

/** 받지 않은 보상이 붙은 옛 우편(초기화된 새 게임에 옛 보상이 들어가지 않게 지운다). 출시 우편은 지우지 않는다. */
export const STALE_MAIL_FILTER = { kind: { $ne: 'launch' }, claimed: false, $or: [{ diamonds: { $gt: 0 } }, { coins: { $gt: 0 } }] };

export interface PlanRow extends RankReward {
  name: string;
}

export interface LaunchPlan {
  createdAt: number;
  ranks: PlanRow[];
}

export interface ResetDeps {
  db: Db;
  now: number;
  execute: boolean;
  /** 컬렉션 하나를 백업 파일로 쓴다 */
  dump: (collection: string, docs: Doc[]) => Promise<void>;
  log: (msg: string) => void;
}

export interface ResetReport {
  mode: 'dry-run' | 'execute';
  resumed: boolean;
  plan: LaunchPlan;
  users: number;
  counts: Record<string, number>;
  staleMails: number;
  deleted?: Record<string, number>;
  epoch?: number;
}

const idStr = (v: unknown): string => String(v);

/** 지금 저장에서 레벨 랭킹 상위를 뽑아 순위 보상 명단을 만든다. */
export async function buildPlan(db: Db, now: number): Promise<LaunchPlan> {
  const top = await db
    .collection('saves')
    .find({ fans: { $gt: 0 } }, { projection: { userId: 1, level: 1, fans: 1 } })
    .sort({ level: -1, fans: -1, _id: 1 })
    .limit(LAUNCH.topCount + 5)
    .toArray();
  const rewards = planRankRewards(top.map((d) => ({ uid: idStr(d.userId), level: Number(d.level) || 1, fans: Number(d.fans) || 0 })));
  const wanted = new Set(rewards.map((r) => r.uid));
  const users = await db
    .collection('users')
    .find({ _id: { $in: top.filter((d) => wanted.has(idStr(d.userId))).map((d) => d.userId) } }, { projection: { nickname: 1, name: 1 } })
    .toArray();
  const nameOf = new Map(users.map((u) => [idStr(u._id), displayNameOf({ nickname: u.nickname as string | null, name: u.name as string | null })]));
  return { createdAt: now, ranks: rewards.map((r) => ({ ...r, name: nameOf.get(r.uid) ?? '(알 수 없음)' })) };
}

async function countAll(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of CLEAR_COLLECTIONS) out[name] = await db.collection(name).countDocuments();
  return out;
}

export async function launchReset(deps: ResetDeps): Promise<ResetReport> {
  const { db, now, execute, log } = deps;
  const metaCol = db.collection<{ _id: string } & Doc>('launch_meta');
  const meta = (await metaCol.findOne({ _id: 'launch' })) as Doc | null;
  if (meta?.status === 'done') throw new Error('이미 정식 출시 초기화를 마쳤어요. (launch_meta.status = done)');

  const resumed = meta?.status === 'running' && meta.plan !== null && meta.plan !== undefined;
  const plan = resumed ? (meta?.plan as unknown as LaunchPlan) : await buildPlan(db, now);
  const users = await db.collection('users').countDocuments();
  const counts = await countAll(db);
  const staleMails = await db.collection('mails').countDocuments(STALE_MAIL_FILTER);
  const report: ResetReport = { mode: execute ? 'execute' : 'dry-run', resumed, plan, users, counts, staleMails };
  if (!execute) return report;

  // 1) 전체 백업(되돌릴 수 있게). 파일에 쓴 문서 수가 DB 와 다르면 멈춘다.
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  for (const name of collections) {
    if (name === 'launch_meta') continue;
    const docs = (await db.collection(name).find({}).toArray()) as Doc[];
    await deps.dump(name, docs);
    log(`백업 ${name}: ${docs.length}건`);
  }

  // 2) 저장 세대를 올린다. 이 순간부터 옛 세대의 저장은 서버가 받지 않는다(이어서 실행할 때는 그대로).
  const epoch = ((meta?.epoch as number | undefined) ?? 0) + (resumed ? 0 : 1);
  await metaCol.updateOne({ _id: 'launch' }, { $set: { status: 'running', epoch, startedAt: new Date(meta?.startedAt ? (meta.startedAt as Date) : now), plan: plan as unknown as Doc } }, { upsert: true });
  log(`저장 세대 ${epoch}로 올림(옛 저장 차단)`);

  // 3) 지급 장부·우편의 중복 방지 인덱스(이미 있으면 그대로)
  await db.collection('launch_grants').createIndex({ ref: 1 }, { unique: true });
  await db.collection('mails').createIndex({ ref: 1 }, { unique: true, partialFilterExpression: { ref: { $type: 'string' } } });

  // 4) 옛 우편 정리 → 출시 우편(순위 보상·스타트 패키지)과 장부
  const staleDeleted = (await db.collection('mails').deleteMany(STALE_MAIL_FILTER)).deletedCount;
  const expiresAt = new Date(now + LAUNCH.mailDays * 86_400_000);
  const createdAt = new Date(now);
  const mailBase = { kind: 'launch', read: false, claimed: false, fromUid: null, fromName: '운영팀', expiresAt, createdAt };

  for (const r of plan.ranks) {
    const ref = launchRef('rank', r.uid);
    const { title, body } = rankMailText(r);
    await db.collection('mails').updateOne({ ref }, { $setOnInsert: { ...mailBase, userId: new Types.ObjectId(r.uid), title, body, diamonds: r.diamonds, coins: r.coins, ref } }, { upsert: true });
  }
  log(`순위 보상 우편 ${plan.ranks.length}통`);

  const everyone = await db.collection('users').find({}, { projection: { _id: 1 } }).toArray();
  const starter = starterMailText();
  for (const u of everyone) {
    const uid = idStr(u._id);
    const ref = launchRef('starter', uid);
    await db.collection('launch_grants').updateOne({ ref }, { $setOnInsert: { ref, userId: u._id, kind: 'starter', createdAt } }, { upsert: true });
    await db.collection('mails').updateOne({ ref }, { $setOnInsert: { ...mailBase, userId: u._id, title: starter.title, body: starter.body, diamonds: LAUNCH.starter.diamonds, coins: LAUNCH.starter.coins, ref } }, { upsert: true });
  }
  log(`스타트 패키지 우편 ${everyone.length}통`);

  // 5) 진행 데이터 정리
  const deleted: Record<string, number> = { mails_stale: staleDeleted };
  for (const name of CLEAR_COLLECTIONS) {
    deleted[name] = (await db.collection(name).deleteMany({})).deletedCount;
    log(`정리 ${name}: ${deleted[name]}건`);
  }

  // 6) 완료 표시 = 정식 출시 시각
  await metaCol.updateOne({ _id: 'launch' }, { $set: { status: 'done', launchedAt: new Date(now) } });
  return { ...report, deleted, epoch };
}
