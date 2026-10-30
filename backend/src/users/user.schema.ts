import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** 계정. 구글 계정의 고유 ID(sub)로 식별한다. 이메일은 바뀔 수 있어 식별에 쓰지 않는다. */
@Schema({ collection: 'users', timestamps: { createdAt: true, updatedAt: false } })
export class User {
  @Prop({ required: true, unique: true })
  googleSub!: string;

  @Prop({ type: String, default: null })
  email!: string | null;

  @Prop({ type: String, default: null })
  name!: string | null;

  @Prop({ type: String, default: null })
  picture!: string | null;

  @Prop({ required: true })
  lastLoginAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
