import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 보관 기간. 지나면 MongoDB TTL 인덱스가 지운다(받지 않은 깃발도 2주 뒤에는 사라진다). */
export const VILLAGE_FLAG_RETENTION_SECONDS = 14 * 24 * 3600;

/** 친구 마을에 꽂은 응원 깃발. (보낸 사람, 받는 사람, 한국 시간 날짜)가 유일해서 하루에 한 번만 꽂을 수 있다. */
@Schema({ collection: 'village_flags', timestamps: { createdAt: true, updatedAt: false } })
export class VillageFlag {
  @Prop({ type: Types.ObjectId, required: true })
  from!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  to!: Types.ObjectId;

  /** 한국 시간 날짜 YYYY-MM-DD */
  @Prop({ required: true })
  day!: string;

  /** 받는 쪽이 ❤️로 받았다 */
  @Prop({ required: true, default: false })
  claimed!: boolean;

  createdAt!: Date;
}

export type VillageFlagDocument = HydratedDocument<VillageFlag>;
export const VillageFlagSchema = SchemaFactory.createForClass(VillageFlag);
VillageFlagSchema.index({ from: 1, to: 1, day: 1 }, { unique: true });
VillageFlagSchema.index({ to: 1, claimed: 1 });
VillageFlagSchema.index({ createdAt: 1 }, { expireAfterSeconds: VILLAGE_FLAG_RETENTION_SECONDS });
