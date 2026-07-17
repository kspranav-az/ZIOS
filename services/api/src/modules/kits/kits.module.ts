import { Module } from '@nestjs/common';
import { QuestionBankModule } from '@/modules/question-bank';
import { KitVersionsRepository } from './kit-versions.repository';
import { KitsController } from './kits.controller';
import { KitsRepository } from './kits.repository';
import { KitsService } from './kits.service';
import { PreviewController } from './preview.controller';
import { QuestionsRepository } from './questions.repository';
import { QuestionsService } from './questions.service';

@Module({
  imports: [QuestionBankModule],
  controllers: [KitsController, PreviewController],
  providers: [
    KitsRepository,
    QuestionsRepository,
    KitVersionsRepository,
    KitsService,
    QuestionsService,
  ],
  exports: [KitVersionsRepository],
})
export class KitsModule {}
