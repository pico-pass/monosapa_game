import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { dayOf } from '../common/week.js';
import { ChartService } from '../chart/chart.service.js';
import { AwardPoint, AwardTick } from './awards.schema.js';
import { AWARD_PERSONAS, HOUR_MS, SNAPSHOT_TOP, hourOf, pointRows } from './rules.js';

/** 정시가 됐는지 확인하는 간격(정시 하나는 표식으로 한 번만 쓰이니 자주 확인해도 된다) */
const CHECK_MS = 5 * 60_000;
/** 서버가 켜진 뒤 첫 확인까지 기다리는 시간(DB 연결·인덱스 생성이 끝나게) */
const FIRST_CHECK_MS = 20_000;

/**
 * 시상식 집계. 매 정시에 차트 상위 곡(속성마다 30곡)을 날짜별 누적으로 쌓는다. 화면·투표·보상은 이 자료가 쌓인 뒤에 만든다.
 * 서버가 계속 떠 있는 프로세스(pm2)라 요청을 기다리지 않고 타이머로 모은다 — 아무도 차트를 열지 않는 시간에도 빠지지 않는다.
 * 서버가 꺼져 있던 시간은 빈다(지난 순위는 되살릴 수 없다).
 */
@Injectable()
export class AwardsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AwardsService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    @InjectModel(AwardTick.name) private readonly ticks: Model<AwardTick>,
    @InjectModel(AwardPoint.name) private readonly points: Model<AwardPoint>,
    private readonly chart: ChartService,
  ) {}

  onModuleInit(): void {
    this.first = setTimeout(() => void this.tick(), FIRST_CHECK_MS);
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** 확인 한 번. 이미 돌고 있으면 건너뛰고, 실패해도 서버는 멈추지 않는다(로그만 남긴다). */
  async tick(now = Date.now()): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      return await this.collect(now);
    } catch (e) {
      this.log.error(`시상식 집계 실패: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** 이 정시를 아직 안 모았으면 모은다. 모았으면 true. */
  private async collect(now: number): Promise<boolean> {
    const hour = hourOf(now);
    // 표식을 먼저 남겨서 같은 정시를 두 번 더하지 않는다
    try {
      await this.ticks.create({ hour, createdAt: new Date(now) });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false;
      throw e;
    }
    let top;
    try {
      top = await this.chart.topRanked(SNAPSHOT_TOP, now);
    } catch (e) {
      await this.ticks.deleteOne({ hour }).exec(); // 아직 아무것도 쓰지 않았으니 다음 확인 때 다시 시도한다
      throw e;
    }
    const created = new Date(now);
    const ops = AWARD_PERSONAS.flatMap((persona) =>
      pointRows(hour, persona, top[persona]).map((row) => ({
        updateOne: {
          filter: row.filter,
          update: { $inc: row.inc, $set: row.set, $setOnInsert: { createdAt: created } },
          upsert: true,
        },
      })),
    );
    if (ops.length > 0) await this.points.bulkWrite(ops, { ordered: false });
    this.log.log(`시상식 집계: ${dayOf(hour * HOUR_MS)} ${(hour + 9) % 24}시(한국) · 곡 ${ops.length}개`);
    return true;
  }
}
