import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/**
 * 정식 출시(전체 데이터 초기화) 기록. 문서는 `_id: 'launch'` 하나뿐이고 초기화 스크립트(`scripts/launch-reset.mjs`)가 쓴다.
 * - status 'running': 초기화가 시작됐다(이때부터 epoch 가 올라 옛 저장은 올라오지 못한다). 'done': 모두 끝났다.
 * - epoch: 저장 세대. 클라이언트는 자기 세대가 서버와 다르면 로컬 저장을 버린다.
 */
@Schema({ collection: 'launch_meta', minimize: false })
export class LaunchMeta {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, enum: ['running', 'done'], required: true })
  status!: 'running' | 'done';

  @Prop({ type: Number, default: 0 })
  epoch!: number;

  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  /** 초기화를 마친 시각 = 정식 출시 시각 */
  @Prop({ type: Date, default: null })
  launchedAt!: Date | null;

  /** 초기화 때 정한 순위 보상 명단(이어서 실행할 때 그대로 쓴다) */
  @Prop({ type: Object, default: null })
  plan!: Record<string, unknown> | null;
}

export type LaunchMetaDocument = HydratedDocument<LaunchMeta>;
export const LaunchMetaSchema = SchemaFactory.createForClass(LaunchMeta);

/** 스타트 패키지 지급 장부. (종류, 계정)마다 한 번만 준다. 우편을 지워도 남는다. */
@Schema({ collection: 'launch_grants', timestamps: { createdAt: true, updatedAt: false } })
export class LaunchGrant {
  /** `launch:starter:<uid>` 같은 키 */
  @Prop({ type: String, required: true })
  ref!: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  kind!: string;
}

export type LaunchGrantDocument = HydratedDocument<LaunchGrant>;
export const LaunchGrantSchema = SchemaFactory.createForClass(LaunchGrant);
LaunchGrantSchema.index({ ref: 1 }, { unique: true });
