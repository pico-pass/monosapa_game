import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';

export type FriendshipStatus = 'pending' | 'accepted';

/** 두 계정 사이의 친구 관계 하나. 요청(pending)을 받아 주면 친구(accepted)가 된다. 두 사람 사이에는 문서가 하나뿐이다(`pair`). */
@Schema({ collection: 'friendships', timestamps: { createdAt: true, updatedAt: false } })
export class Friendship {
  /** 두 계정 ID를 묶은 키(common/pair.ts) */
  @Prop({ required: true, unique: true })
  pair!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  requester!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  addressee!: Types.ObjectId;

  @Prop({ required: true, enum: ['pending', 'accepted'], default: 'pending' })
  status!: FriendshipStatus;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  createdAt!: Date;
}

export type FriendshipDocument = HydratedDocument<Friendship>;
export const FriendshipSchema = SchemaFactory.createForClass(Friendship);
