import { Module } from '@nestjs/common';
import { QuestionBankModule } from '@/modules/question-bank';
import { KitsController } from './kits.controller';
import { KitsRepository } from './kits.repository';
import { KitsService } from './kits.service';
import { PreviewController } from './preview.controller';
import { QuestionsRepository } from './questions.repository';
import { QuestionsService } from './questions.service';

@Module({
  imports: [QuestionBankModule],
  controllers: [KitsController, PreviewController],
  providers: [KitsRepository, QuestionsRepository, KitsService, QuestionsService],
})
export class KitsModule {}
