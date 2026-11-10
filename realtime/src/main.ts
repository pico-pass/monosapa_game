import { config } from './config.js';
import { LYRIC_LINES } from './lyric/lines.js';
import { httpAuth, httpRewards } from './remote.js';
import { createRealtimeServer } from './server.js';

const log = (msg: string): void => console.log(`[realtime] ${msg}`);

const app = createRealtimeServer({
  auth: httpAuth(config.authUrl),
  rewards: httpRewards(config.rewardUrl, config.secret),
  lines: LYRIC_LINES,
  path: config.path,
  maxConns: config.maxConns,
  log,
});

app.server.listen(config.port, config.host, () => {
  log(`${config.host}:${config.port}${config.path} 에서 대기 중${config.secret ? '' : ' (REALTIME_SECRET 이 없어 보상은 꺼져 있어요)'}`);
});

const stop = (): void => {
  log('종료합니다');
  void app.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
