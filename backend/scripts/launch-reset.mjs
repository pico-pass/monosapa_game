#!/usr/bin/env node
/*
 * 정식 출시 초기화 실행기. 먼저 `npm run build -w backend` 로 dist 를 만든 뒤 쓴다.
 *
 *   node backend/scripts/launch-reset.mjs                          # 점검만(아무것도 쓰지 않는다): 순위 보상 명단과 정리 대상 수
 *   node backend/scripts/launch-reset.mjs --execute --confirm <DB 이름>   # 실제 실행(DB 이름을 직접 적어야 한다)
 *   --db <이름>          MONGODB_URI 의 DB 대신 다른 DB 에 돌린다(리허설용 복사본)
 *   --backup-dir <경로>  백업 폴더(기본 ~/launch-backup/<시각>)
 *
 * 실행 전에 서버(pm2 monosapa-backend)를 멈춰 두고, 끝나면 다시 켠다.
 * 실행 도중 멈췄다면 같은 명령을 다시 실행하면 이어서 한다. 한 번 끝나면(status done) 다시 실행되지 않는다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const envFile = new URL('../.env', import.meta.url);
try {
  process.loadEnvFile(envFile);
} catch {
  /* .env 가 없으면 이미 설정된 환경 변수를 쓴다 */
}
const mongoose = require('mongoose');
const { launchReset } = await import('../dist/launch/reset.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI 가 없어요.');
  process.exit(1);
}
const execute = flag('--execute');
const dbOverride = value('--db');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = value('--backup-dir') ?? join(homedir(), 'launch-backup', stamp);

await mongoose.connect(uri, { ...(dbOverride ? { dbName: dbOverride } : {}), serverSelectionTimeoutMS: 10_000 });
const db = mongoose.connection.db;
console.log(`대상 DB: ${db.databaseName}`);
console.log(`모드: ${execute ? '실행' : '점검(dry-run, 아무것도 쓰지 않음)'}`);

if (execute && value('--confirm') !== db.databaseName) {
  console.error(`실행하려면 --confirm ${db.databaseName} 을 붙여 DB 이름을 확인해 주세요.`);
  await mongoose.disconnect();
  process.exit(2);
}

const EJSON = mongoose.mongo.BSON.EJSON;

try {
  const report = await launchReset({
    db,
    now: Date.now(),
    execute,
    log: (m) => console.log(`  · ${m}`),
    dump: async (name, docs) => {
      // 백업에는 이메일·세션 해시가 들어 있으니 나만 읽을 수 있게 한다. 실제로 백업할 때만 폴더를 만든다.
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(backupDir, `${name}.json`), EJSON.stringify(docs, { relaxed: false }, 2), { mode: 0o600 });
    },
  });

  console.log(`\n계정 ${report.users}개${report.resumed ? ' · 이전에 멈춘 실행을 이어서 하는 중(저장된 명단 사용)' : ''}`);
  console.log('\n순위 보상 명단(레벨 랭킹):');
  console.log('순위  이름                 레벨   팬 수        💎      코인');
  for (const r of report.plan.ranks) {
    console.log(`${String(r.rank).padStart(3)}   ${r.name.slice(0, 14).padEnd(16)} ${String(r.level).padStart(6)} ${String(Math.round(r.fans)).padStart(11)} ${String(r.diamonds).padStart(7)}  ${r.coins.toLocaleString('en-US')}`);
  }
  console.log('\n정리할 진행 데이터(건수):');
  for (const [k, v] of Object.entries(report.counts)) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log(`  ${'mails(받지 않은 옛 보상)'.padEnd(18)} ${report.staleMails}`);
  if (report.deleted) {
    console.log(`\n완료: 저장 세대 ${report.epoch}, 백업 폴더 ${backupDir}`);
    console.log('이제 서버를 다시 켜 주세요: pm2 start monosapa-backend');
  } else {
    console.log('\n(점검만 했어요. 실제 실행은 --execute --confirm <DB 이름>)');
  }
} catch (e) {
  console.error(`\n실패: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
