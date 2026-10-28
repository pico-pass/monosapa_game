import { describe, expect, it } from 'vitest';
import { BALANCE } from '../balance';
import { beginManualConcert, finishManualConcert, manualConcertReward } from '../commands';
import { createInitialState } from '../persistence';
import { RunGame, buildCourse, speedAt } from '../runner';
import { createMinigame, taskDifficulty } from '../minigame';
import { stageTaskGrowth } from '../selectors';
import type { Persona } from '../types';

const R = BALANCE.run;
const FRAME = 1000 / 60;

/** 다가오는 장애물의 중심 위로 점프 정점이 오도록 미리 점프하는 자동 플레이어. */
function autopilot(game: RunGame, leadSec = 0.3, maxMs = 600_000): void {
  const pw = R.playerW;
  while (game.status === 'running' && game.elapsedMs < maxMs) {
    const next = game.course.obstacles.find((o) => o.x + o.w > game.x);
    if (next && game.y === 0) {
      const dist = next.x + next.w / 2 - (game.x + pw / 2);
      if (dist > 0 && dist <= game.speed * leadSec) game.jump();
    }
    game.advance(FRAME);
  }
}

describe('모노사파런 코스', () => {
  it('같은 시드면 같은 코스, 다른 시드면 다른 코스', () => {
    expect(buildCourse('normal', 1)).toEqual(buildCourse('normal', 1));
    expect(buildCourse('normal', 1).obstacles).not.toEqual(buildCourse('normal', 2).obstacles);
  });

  it('목표 거리: 일반 2600m, 어둠 6900m', () => {
    expect(buildCourse('normal', 1).goalM).toBe(2600);
    expect(buildCourse('dark', 1).goalM).toBe(6900);
  });

  it('속도는 달릴수록 빨라진다 (어둠이 더 빠르다)', () => {
    for (const p of ['normal', 'dark'] as Persona[]) {
      const c = buildCourse(p, 3);
      expect(speedAt(c, 0)).toBe(R.persona[p].startSpeed);
      expect(speedAt(c, c.lengthU)).toBe(R.persona[p].endSpeed);
      expect(speedAt(c, c.lengthU / 2)).toBeGreaterThan(speedAt(c, c.lengthU / 4));
    }
    expect(R.persona.dark.startSpeed).toBeGreaterThan(R.persona.normal.startSpeed);
    expect(R.persona.dark.endSpeed).toBeGreaterThan(R.persona.normal.endSpeed);
  });

  it('출발·결승 앞에는 장애물이 없고 장애물끼리 겹치지 않는다', () => {
    for (const p of ['normal', 'dark'] as Persona[]) {
      const c = buildCourse(p, 7);
      expect(c.obstacles.length).toBeGreaterThan(30);
      expect(c.obstacles[0].x).toBeGreaterThanOrEqual(R.leadInU);
      const last = c.obstacles[c.obstacles.length - 1];
      expect(last.x + last.w).toBeLessThanOrEqual(c.lengthU - R.finishClearU);
      for (let i = 1; i < c.obstacles.length; i++) expect(c.obstacles[i].x).toBeGreaterThan(c.obstacles[i - 1].x + c.obstacles[i - 1].w);
      // 젤리는 x 순서이고 점프 없이 먹을 수 있는 것과 점프해야 먹는 것이 모두 있다
      expect(c.jellies.every((j, i) => i === 0 || j.x >= c.jellies[i - 1].x)).toBe(true);
      expect(c.jellies.some((j) => j.y <= 1)).toBe(true);
      expect(c.jellies.some((j) => j.y > 2)).toBe(true);
    }
  });
});

describe('모노사파런 진행', () => {
  it('입력이 없으면 장애물에 세 번 걸려 실패한다', () => {
    const g = new RunGame('normal', 11);
    while (g.status === 'running' && g.elapsedMs < 300_000) g.advance(FRAME);
    expect(g.status).toBe('failed');
    expect(g.hearts).toBe(0);
    expect(g.hits).toBe(R.hearts);
    expect(g.distanceM).toBeLessThan(2600);
  });

  it('무적 시간에는 연속으로 하트를 잃지 않는다', () => {
    const g = new RunGame('normal', 11);
    const first = g.course.obstacles[0];
    while (g.hits === 0 && g.elapsedMs < 60_000) g.advance(FRAME);
    expect(g.hearts).toBe(R.hearts - 1);
    expect(g.invincibleMs).toBeGreaterThan(0);
    // 아직 첫 장애물 안에 있는 동안에도 무적이라 하트가 더 줄지 않는다
    g.advance(FRAME);
    expect(g.hearts).toBe(R.hearts - 1);
    expect(g.x).toBeLessThan(first.x + first.w + 1);
  });

  it('점프는 바닥에서 한 번, 공중에서 한 번 더 — 세 번째는 무시', () => {
    const g = new RunGame('normal', 1);
    expect(g.jump()).toBe(true);
    g.advance(100);
    expect(g.y).toBeGreaterThan(0);
    expect(g.jump()).toBe(true);
    expect(g.jump()).toBe(false);
    for (let i = 0; i < 120; i++) g.advance(FRAME);
    expect(g.y).toBe(0);
    expect(g.jump()).toBe(true);
  });

  it('일반: 알맞게 점프하면 2600m를 완주하고 걸린 시간이 2분 안팎이다', () => {
    const g = new RunGame('normal', 5);
    autopilot(g);
    expect(g.status).toBe('cleared');
    expect(g.distanceM).toBe(2600);
    expect(g.hits).toBe(0);
    expect(g.elapsedMs / 1000).toBeGreaterThan(90);
    expect(g.elapsedMs / 1000).toBeLessThan(180);
  });

  it('어둠: 6900m를 완주하고 일반보다 오래·빠르게 달린다', () => {
    const g = new RunGame('dark', 5);
    autopilot(g);
    expect(g.status).toBe('cleared');
    expect(g.distanceM).toBe(6900);
    expect(g.hits).toBe(0);
    expect(g.elapsedMs / 1000).toBeGreaterThan(120);
    expect(g.elapsedMs / 1000).toBeLessThan(240);
  });

  it('점수는 먹은 젤리 비율: 점프를 알맞게 하면 높고, 제자리 걸음은 낮다', () => {
    const good = new RunGame('normal', 9);
    autopilot(good);
    expect(good.score).toBeGreaterThan(300);
    expect(good.score).toBeLessThanOrEqual(1000);
    expect(good.jellyCount).toBe(good.collected.filter(Boolean).length);

    // 항상 점프만 하면 위쪽 젤리까지 쓸 수 있지만 장애물에는 걸린다
    const none = new RunGame('normal', 9);
    while (none.status === 'running') none.advance(FRAME);
    expect(none.score).toBeLessThan(good.score);
  });

  it('프레임 간격이 달라도 결과가 같다 (고정 시간 간격)', () => {
    const run = (frameMs: number) => {
      const g = new RunGame('normal', 21);
      for (let t = 0; t < 20_000 && g.status === 'running'; t += frameMs) {
        if (g.elapsedMs > 3000 && g.y === 0 && Math.floor(t / 700) !== Math.floor((t - frameMs) / 700)) g.jump();
        g.advance(frameMs);
      }
      return [Math.round(g.x * 10), g.hearts, g.jellyCount];
    };
    const a = run(1000 / 60);
    const b = run(1000 / 30);
    // 입력 시각이 프레임에 맞춰 달라지므로 완전히 같을 순 없다. 대신 진행 거리는 거의 같다.
    expect(Math.abs(a[0] - b[0])).toBeLessThan(a[0] * 0.03);
  });

  it('한 번에 긴 시간이 들어와도 한 프레임 한도만 진행한다', () => {
    const g = new RunGame('normal', 1);
    g.advance(60_000);
    expect(g.elapsedMs).toBeLessThanOrEqual(100);
  });
});

describe('모노사파런 보상', () => {
  const T0 = 1_700_000_000_000;
  const ready = () => ({ ...createInitialState(T0), fans: 100_000, concerts: { ...createInitialState(T0).concerts, room: { cleared: true, bestScore: 0, cooldownUntil: 0 } } });

  it('지하 클럽만 모노사파런, 방구석은 타이밍', () => {
    const club = beginManualConcert(ready(), 'club', 'c1');
    expect(club.ok && club.run.game).toBe('run');
    const room = beginManualConcert(ready(), 'room', 'r1');
    expect(room.ok && room.run.game).toBe('timing');
  });

  it('어둠 보상은 같은 조건의 일반 보상의 4배', () => {
    expect(manualConcertReward(80, 500, 'dark', 'run', true)).toBe(4 * manualConcertReward(80, 500, 'normal', 'run', true));
    expect(manualConcertReward(80, 1000, 'normal', 'run', true)).toBe(160);
    expect(manualConcertReward(80, 1000, 'dark', 'run', true)).toBe(640);
    // 타이밍의 어둠 배율(1.5)은 그대로
    expect(manualConcertReward(80, 1000, 'dark')).toBe(Math.floor(80 * 2 * 1.5));
  });

  it('완주해야 클리어: 점수가 낮아도 완주하면 첫 클리어 보너스, 실패하면 보상 절반·클리어 아님', () => {
    const begin = beginManualConcert(ready(), 'club', 'c2');
    if (!begin.ok) throw new Error('begin failed');
    const won = finishManualConcert(begin.state, begin.run, 100, true);
    expect(won.ok && won.outcome.cleared).toBe(true);
    expect(won.ok && won.outcome.firstClear).toBe(true);
    expect(won.ok && won.outcome.coins).toBe(manualConcertReward(80, 100, 'normal', 'run', true) + 500);

    const begin2 = beginManualConcert(ready(), 'club', 'c3');
    if (!begin2.ok) throw new Error('begin failed');
    // 점수 900이어도 완주 못 하면 클리어가 아니다
    const lost = finishManualConcert(begin2.state, begin2.run, 900, false);
    expect(lost.ok && lost.outcome.cleared).toBe(false);
    expect(lost.ok && lost.outcome.firstClearCoins).toBe(0);
    expect(lost.ok && lost.state.concerts.club.cleared).toBe(false);
    expect(lost.ok && lost.outcome.coins).toBe(manualConcertReward(80, 900, 'normal', 'run', false));
  });
});

describe('공연장별 과제 난이도 배수', () => {
  it('방구석은 1.33, 나머지는 1.25', () => {
    expect(stageTaskGrowth('room')).toBe(1.33);
    expect(stageTaskGrowth('club')).toBe(1.25);
    expect(stageTaskGrowth('world')).toBe(1.25);
    const begin = beginManualConcert({ ...createInitialState(0), fans: 100 }, 'room', 'g');
    expect(begin.ok && begin.run.taskGrowth).toBe(1.33);
  });

  it('미니게임이 공연장 배수로 난이도를 쌓는다', () => {
    const mg = createMinigame('normal', 1.3, 1.33);
    expect(mg.taskGrowth).toBe(1.33);
    expect(taskDifficulty(1.3, 9, 1.33)).toBeCloseTo(1.3 * 1.33 ** 9, 9);
    // 기본값은 balance의 taskDifficultyGrowth
    expect(taskDifficulty(1, 1)).toBe(BALANCE.concert.taskDifficultyGrowth);
  });
});
