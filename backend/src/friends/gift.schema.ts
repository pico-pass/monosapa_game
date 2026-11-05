import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

/** 친구에게 보낸 다이아 선물 기록. (보낸 사람, 받는 사람, 한국 시간 날짜)가 유일해서 하루에 한 번만 보낼 수 있다. */
@Schema({ collection: 'friend_gifts', timestamps: { createdAt: true, updatedAt: false } })
export class FriendGift {
  @Prop({ type: Types.ObjectId, required: true })
  from!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  to!: Types.ObjectId;

  /** 한국 시간 날짜 YYYY-MM-DD */
  @Prop({ required: true })
  day!: string;

  createdAt!: Date;
}

export type FriendGiftDocument = HydratedDocument<FriendGift>;
export const FriendGiftSchema = SchemaFactory.createForClass(FriendGift);
FriendGiftSchema.index({ from: 1, to: 1, day: 1 }, { unique: true });
FriendGiftSchema.index({ to: 1, day: 1 });
// 날짜가 지난 기록은 쓸모가 없어 일주일 뒤 지운다.
FriendGiftSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
