import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { InquiriesController } from './inquiries.controller.js';
import { InquiriesService } from './inquiries.service.js';
import { Inquiry, InquirySchema } from './inquiry.schema.js';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: Inquiry.name, schema: InquirySchema }])],
  controllers: [InquiriesController],
  providers: [InquiriesService],
})
export class InquiriesModule {}
