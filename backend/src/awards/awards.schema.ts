import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { AWARD_PERSONAS, AWARD_RETENTION_SECONDS, type AwardPersona } from './rules.js';

/**
 * 정시 집계 표식. 정시 번호가 유일해서 같은 정시를 두 번 더하지 않는다(서버를 다시 켜거나 확인이 겹쳐도 한 번만).
 * 집계에 실패하면 표식을 지우고 다시 시도하지만, 쓰는 도중에 실패하면 두 번 더하지 않으려고 표식을 남겨 둔다.
 */
@Schema({ collection: 'award_ticks', timestamps: false })
export class AwardTick {
  @Prop({ required: true, unique: true })
  hour!: number;

  @Prop({ type: Date, required: true })
  createdAt!: Date;
}
export type AwardTickDocument = HydratedDocument<AwardTick>;
export const AwardTickSchema = SchemaFactory.createForClass(AwardTick);
AwardTickSchema.index({ createdAt: 1 }, { expireAfterSeconds: AWARD_RETENTION_SECONDS });

/**
 * 차트 상위 곡의 하루(한국 시간) 누적. (날짜, 속성, 곡)이 유일하고, 정시마다 상위 30곡이 `points`(순위 점수)·`hours`(오른 시간 수)·`revivals`(역주행 시간 수)를 올린다.
 * 연말 시상식의 올해의 노래(점수 합)·롱런상(시간 수)·역주행상(역주행 시간 수)이 이걸 기간 동안 합쳐 쓴다.
 * 차트는 계정들의 저장에서 만들어지므로 진행 데이터다: 정식 출시 같은 초기화 때 함께 비운다(`CLEAR_COLLECTIONS`).
 */
@Schema({ collection: 'award_points', timestamps: false })
export class AwardPoint {
  /** 한국 시간 날짜 YYYY-MM-DD */
  @Prop({ required: true })
  day!: string;

  @Prop({ required: true, enum: [...AWARD_PERSONAS] })
  persona!: AwardPersona;

  /** 곡 키 `u:<계정>:<싱글 ID>` */
  @Prop({ required: true })
  key!: string;

  /** 곡을 낸 계정 ID(문자열) */
  @Prop({ required: true })
  uid!: string;

  @Prop({ required: true })
  title!: string;

  /** 가장 최근에 본 활동명 */
  @Prop({ required: true })
  artist!: string;

  @Prop({ required: true, default: 0 })
  points!: number;

  @Prop({ required: true, default: 0 })
  hours!: number;

  @Prop({ required: true, default: 0 })
  revivals!: number;

  @Prop({ type: Date, required: true })
  createdAt!: Date;
}
export type AwardPointDocument = HydratedDocument<AwardPoint>;
export const AwardPointSchema = SchemaFactory.createForClass(AwardPoint);
AwardPointSchema.index({ day: 1, persona: 1, key: 1 }, { unique: true });
AwardPointSchema.index({ createdAt: 1 }, { expireAfterSeconds: AWARD_RETENTION_SECONDS });
