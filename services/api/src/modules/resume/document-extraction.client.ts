import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/errors';

/**
 * Thin client for the AI orchestrator's document text-extraction endpoint
 * (Phase 12b). The orchestrator owns extraction: text/plain decodes there,
 * application/pdf routes through the configured TextExtractorPort (pypdf or
 * mock). The API sends the raw bytes and receives plain text.
 */
@Injectable()
export class DocumentExtractionClient {
  private orchestratorBaseUrl(): string {
    // Read lazily so tests can set ORCHESTRATOR_URL after the module is built.
    return process.env.ORCHESTRATOR_URL ?? 'http://ai-orchestrator:8000';
  }

  /**
   * Ask the orchestrator to extract plain text from base64 document bytes.
   *
   * @returns The extracted text plus the extractor that produced it.
   * @throws ApiException 502 when the orchestrator is unreachable or the
   *         document could not be extracted (corrupt PDF, unsupported type).
   */
  async extract(contentBase64: string, contentType: string): Promise<{ text: string; extractor: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.orchestratorBaseUrl()}/documents/extract-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_base64: contentBase64, content_type: contentType }),
      });
    } catch (cause) {
      throw new ApiException(
        502,
        'EXTRACTION_FAILED',
        `could not reach the document extraction service: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text();
      throw new ApiException(502, 'EXTRACTION_FAILED', `document extraction failed: ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as { text?: string; extractor?: string };
    return { text: payload.text ?? '', extractor: payload.extractor ?? 'unknown' };
  }
}
