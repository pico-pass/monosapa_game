import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { SavesController } from './saves.controller.js';
import { Save, SaveSchema } from './save.schema.js';
import { SavesService } from './saves.service.js';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: Save.name, schema: SaveSchema }])],
  controllers: [SavesController],
  providers: [SavesService],
})
export class SavesModule {}
