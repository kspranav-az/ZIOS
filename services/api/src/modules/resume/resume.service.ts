import { Injectable } from '@nestjs/common';
import type {
  AtsReadinessReport,
  ParsedResumeProfile,
  ResumeJdMatchResponse,
} from '@zios/shared-types';
import { ApiException } from '@/common/errors';
import { LlmGateway } from '@/modules/llm-gateway';
import { StorageClient } from '@/modules/storage';
import { CandidateResumeRepository, type CandidateResumeRecord } from './candidate-resume.repository';
import { DocumentExtractionClient } from './document-extraction.client';
import { validateMatchHonesty } from './honesty';

/** v1 upload cap (~1.5 MB base64 payload). */
const MAX_RESUME_BYTES = 1_000_000;

/**
 * Heuristic binary sniff: NUL bytes or C0 control characters (other than
 * tab/newline/CR) mean the buffer is not plain text. PDFs and office formats
 * both trip this, so callers decide by file name first.
 */
function looksLikePlainText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\x01-\x08\x0B\x0C\x0E-\x1F]/.test(buffer.toString('utf8'));
}

/**
 * Candidate resume intelligence (Phase 12, D10). The raw file lives in MinIO
 * under resumes/{accountId}/{uuid}; the parsed profile and ATS-readiness
 * report are cached on the row. One active resume per account — re-upload
 * replaces (and deletes the old object). Deletion removes both.
 */
@Injectable()
export class ResumeService {
  constructor(
    private readonly resumes: CandidateResumeRepository,
    private readonly storage: StorageClient,
    private readonly llmGateway: LlmGateway,
    private readonly extraction: DocumentExtractionClient,
  ) {}

  async upload(
    accountId: string,
    body: { fileName?: unknown; contentBase64?: unknown; text?: unknown },
  ): Promise<CandidateResumeRecord> {
    const fileName = typeof body?.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : null;
    if (!fileName) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'fileName is required');
    }
    if (typeof body?.contentBase64 !== 'string' || body.contentBase64.length === 0) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'contentBase64 is required');
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.contentBase64, 'base64');
    } catch {
      throw new ApiException(400, 'VALIDATION_ERROR', 'contentBase64 is not valid base64');
    }
    if (buffer.length === 0 || buffer.length > MAX_RESUME_BYTES) {
      throw new ApiException(413, 'RESUME_TOO_LARGE', 'resume must be between 1 byte and 1 MB');
    }

    // Text resolution, in priority order:
    //   1. explicit companion text (paste-as-text flow)
    //   2. .pdf file name → orchestrator extraction port (pypdf/mock)
    //   3. printable bytes decode directly (utf-8 .txt uploads)
    //   4. anything else → 422 without touching the orchestrator
    const isPdfName = fileName.toLowerCase().endsWith('.pdf');
    let resumeText =
      typeof body?.text === 'string' && body.text.trim() ? body.text : null;
    let contentType: string;
    if (!resumeText && isPdfName) {
      contentType = 'application/pdf';
      try {
        resumeText = (await this.extraction.extract(body.contentBase64, 'application/pdf')).text;
      } catch (cause) {
        if (cause instanceof ApiException && cause.getStatus() === 502) {
          throw new ApiException(
            422,
            'TEXT_REQUIRED',
            'could not extract text from this PDF — it may be corrupt or a scanned image. Paste the plain text instead.',
          );
        }
        throw cause;
      }
    } else if (!resumeText) {
      if (!looksLikePlainText(buffer)) {
        throw new ApiException(
          422,
          'TEXT_REQUIRED',
          'unsupported file type — upload a .txt or .pdf resume, or paste the plain text',
        );
      }
      contentType = 'text/plain';
      resumeText = buffer.toString('utf8');
    } else if (isPdfName) {
      contentType = 'application/pdf';
    } else {
      contentType = 'text/plain';
    }
    if (!resumeText || resumeText.trim().length < 20) {
      throw new ApiException(
        422,
        'TEXT_REQUIRED',
        'could not extract resume text — paste the plain text if the file has nothing selectable',
      );
    }

    const upload = await this.storage.uploadResume(
      `resumes/${accountId}`,
      buffer,
      `${contentType}; charset=utf-8`,
    );
    const previous = await this.resumes.findByAccountId(accountId);

    const row = await this.resumes.upsert({
      accountId,
      fileKey: upload.objectName,
      fileName,
      contentType,
    });

    // Replace semantics: the old object must not outlive its row.
    if (previous && previous.fileKey !== upload.objectName) {
      await this.storage.deleteObject(previous.fileKey).catch(() => undefined);
    }

    // Parse + ATS check (fixture-driven under the mock provider).
    const parsedOutput = await this.llmGateway.complete<ParsedResumeProfile>({
      task: 'resume_parse',
      variables: { resumeText },
      orgId: accountId,
    });
    const atsOutput = await this.llmGateway.complete<AtsReadinessReport>({
      task: 'ats_readiness_check',
      variables: { profile: parsedOutput.parsed },
      orgId: accountId,
    });
    await this.resumes.updateParsed(
      row.id,
      parsedOutput.parsed as unknown as Record<string, unknown>,
      {
        ...(atsOutput.parsed as object),
        promptVersions: { atsReadiness: atsOutput.promptVersion },
      } as unknown as Record<string, unknown>,
    );
    return (await this.resumes.findByAccountId(accountId)) as CandidateResumeRecord;
  }

  async get(accountId: string): Promise<CandidateResumeRecord> {
    const row = await this.resumes.findByAccountId(accountId);
    if (!row) {
      throw new ApiException(404, 'RESUME_NOT_FOUND', 'no resume on file for this account');
    }
    return row;
  }

  /** Plain-text form of the parsed resume, for LLM context (e.g. JD mocks). */
  async resumeTextFor(accountId: string): Promise<string | null> {
    const row = await this.resumes.findByAccountId(accountId);
    if (!row?.parsed) return null;
    return JSON.stringify(row.parsed);
  }

  async erase(accountId: string): Promise<void> {
    const fileKey = await this.resumes.deleteByAccountId(accountId);
    if (fileKey) {
      await this.storage.deleteObject(fileKey).catch(() => undefined);
    }
  }

  /** Honest coverage analysis of the stored resume against a target JD. */
  async matchAgainstJd(accountId: string, jdText: string): Promise<ResumeJdMatchResponse> {
    const row = await this.get(accountId);
    if (!row.parsed) {
      throw new ApiException(409, 'RESUME_NOT_PARSED', 'resume is still being parsed — try again');
    }
    if (typeof jdText !== 'string' || jdText.trim().length < 40) {
      throw new ApiException(400, 'VALIDATION_ERROR', 'jdText must be at least 40 characters');
    }
    const output = await this.llmGateway.complete<{
      coverage: ResumeJdMatchResponse['coverage'];
      missingKeywords: string[];
      suggestions: Array<{ original: string; improved: string }>;
    }>({
      task: 'resume_jd_match',
      variables: { profile: row.parsed, jdText },
      orgId: accountId,
    });
    return {
      coverage: output.parsed.coverage ?? [],
      missingKeywords: output.parsed.missingKeywords ?? [],
      suggestions: validateMatchHonesty(output.parsed.suggestions ?? []),
    };
  }
}
