import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 이전 저장 한 벌. 실수로 덮어써도 사람이 되살릴 수 있게 최소 간격마다 하나만 남긴다. */
export interface SaveBackup {
  state: Record<string, unknown>;
  savedAt: number;
}

/** 계정당 하나의 게임 저장. 게임 규칙은 서버에 없으므로 state 는 클라이언트가 보낸 그대로의 JSON이다. */
@Schema({ collection: 'saves', minimize: false, timestamps: { createdAt: false, updatedAt: true } })
export class Save {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({ type: Object, required: true })
  state!: Record<string, unknown>;

  /** 저장할 때마다 1씩 오른다. 클라이언트는 자기가 아는 버전을 보내고, 그 사이 다른 기기가 저장했으면 충돌로 거절된다. */
  @Prop({ required: true, default: 1 })
  version!: number;

  /** state.savedAt (게임이 저장한 시각, ms) */
  @Prop({ required: true })
  savedAt!: number;

  /** 랭킹용으로 state.fans 에서 뽑아 둔 값. 저장할 때마다 서버가 다시 계산한다. */
  @Prop({ type: Number, default: 0 })
  fans!: number;

  /** 계정 레벨 = 1 + floor(√(fans/20)). 게임의 playerLevel 과 같은 식이다. */
  @Prop({ type: Number, default: 1 })
  level!: number;

  /** 무한의 계단 역대 최고 클리어 층. 랭킹용으로 state.arcade.tower.best 에서 뽑아 둔 값이다. */
  @Prop({ type: Number, default: 0 })
  towerBest!: number;

  /** 모노사파 육성 레벨. 랭킹용으로 state.nurture 의 성장도에서 계산해 둔 값이다. 아직 육성하지 않았으면 일반·어둠 모두 1레벨이다. */
  @Prop({ type: Number, default: 1 })
  nurtureNormal!: number;

  @Prop({ type: Number, default: 1 })
  nurtureDark!: number;

  /** 육성 레벨 합계(일반 + 어둠). 육성 랭킹의 1차 순서다. */
  @Prop({ type: Number, default: 2 })
  nurtureTotal!: number;

  /** 육성 성장도 합계. 레벨 합계가 같을 때의 순서이자 육성을 한 번이라도 했는지(0보다 큰지) 알려 준다. */
  @Prop({ type: Number, default: 0 })
  nurtureXp!: number;

  /** 팬 마을 명성(건물 레벨 합계). 랭킹용으로 state.village 에서 계산해 둔 값이다. 건물이 없으면 0이다. */
  @Prop({ type: Number, default: 0 })
  villageFame!: number;

  /** 마지막으로 쓴 클라이언트(페이지 로드) 식별자. 응답이 유실돼 같은 클라이언트가 재시도하는 경우를 충돌로 보지 않기 위한 값이다. */
  @Prop({ required: true })
  lastWriter!: string;

  @Prop({ type: Object, default: null })
  backup!: SaveBackup | null;
}

export type SaveDocument = HydratedDocument<Save>;
export const SaveSchema = SchemaFactory.createForClass(Save);
// 랭킹 조회: 레벨 ↓, 팬 ↓ 순서
SaveSchema.index({ level: -1, fans: -1 });
// 계단 랭킹 조회: 최고 층 ↓
SaveSchema.index({ towerBest: -1 });
// 육성 랭킹 조회: 레벨 합계 ↓, 성장도 합계 ↓
SaveSchema.index({ nurtureTotal: -1, nurtureXp: -1 });
// 마을 랭킹 조회: 명성 ↓
SaveSchema.index({ villageFame: -1 });
