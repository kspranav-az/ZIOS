import { Injectable } from '@nestjs/common';
import type { InterviewNotes } from '@zios/shared-types';
import { DatabaseService, type Queryable } from '@/modules/database';
import { KitVersionsRepository } from '@/modules/kits';
import { TranscriptRepository } from '@/modules/sessions';
import { InterviewNotesRepository } from '@/modules/evaluation';
import { CoverageRepository } from './coverage.repository';

@Injectable()
export class NotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notesRepo: InterviewNotesRepository,
    private readonly coverage: CoverageRepository,
    private readonly kitVersions: KitVersionsRepository,
    private readonly transcript: TranscriptRepository,
  ) {}

  async findBySessionId(sessionId: string, q?: Queryable): Promise<InterviewNotes | null> {
    return this.notesRepo.findBySessionId(sessionId, q ?? this.db);
  }

  async generateForSession(sessionId: string, q: Queryable): Promise<InterviewNotes> {
    const sessionResult = await q.query(
      'SELECT kit_version_id FROM interview_session WHERE id = $1',
      [sessionId],
    );
    const kitVersionId = (sessionResult.rows[0] as { kit_version_id: string } | undefined)
      ?.kit_version_id;
    if (!kitVersionId) {
      throw new Error('session missing kit version');
    }
    const version = await this.kitVersions.findById(kitVersionId, q);
    if (!version) {
      throw new Error('kit version not found');
    }
    const transcript = await this.transcript.listBySession(sessionId, q);
    await this.coverage.ensureQuestions(
      sessionId,
      version.snapshot.questions.map((q) => q.id),
      q,
    );
    const coverage = await this.coverage.listBySession(sessionId, q);
    const questionById = new Map(version.snapshot.questions.map((q) => [q.id, q]));
    const covered = coverage.filter((c) => c.status === 'covered');
    const skipped = coverage.filter((c) => c.status === 'skipped');

    const questionMapping = coverage.map((c) => {
      const question = questionById.get(c.questionId);
      const answer = transcript.find((t) => t.questionId === c.questionId)?.answerText ?? '';
      const note =
        c.status === 'covered'
          ? `Discussed. Candidate response: ${answer || '[no recorded answer]'}`
          : c.status === 'skipped'
            ? 'Skipped during the interview.'
            : 'Not reached.';
      return {
        questionId: c.questionId,
        prompt: question?.prompt ?? 'Question',
        note,
      };
    });

    const summary =
      `Human-facilitated interview completed. ${covered.length} question(s) covered, ` +
      `${skipped.length} skipped, ${coverage.length - covered.length - skipped.length} pending. ` +
      'See question mapping for details.';

    return this.notesRepo.insert(
      {
        sessionId,
        summary,
        questionMapping,
        generatedBy: 'ai',
      },
      q,
    );
  }
}
