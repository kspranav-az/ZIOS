import { describe, expect, it } from 'vitest';
import { resolvePostUploadPlan } from './async-video-interviews.service';

describe('resolvePostUploadPlan', () => {
  it('defaults to the analysis path (analysis on when the flag is absent)', () => {
    expect(resolvePostUploadPlan({})).toEqual({
      analysis: true,
      includeTranscript: false,
      legacyTranscription: false,
    });
    expect(resolvePostUploadPlan(undefined)).toEqual({
      analysis: true,
      includeTranscript: false,
      legacyTranscription: false,
    });
  });

  it('includes the transcript in analysis when transcription is enabled', () => {
    expect(resolvePostUploadPlan({ enableTranscription: true })).toEqual({
      analysis: true,
      includeTranscript: true,
      legacyTranscription: false,
    });
  });

  it('uses the legacy transcription path only when analysis is disabled and transcription enabled', () => {
    expect(resolvePostUploadPlan({ enableAnalysis: false, enableTranscription: true })).toEqual({
      analysis: false,
      includeTranscript: false,
      legacyTranscription: true,
    });
  });

  it('does no post-processing when both flags are off', () => {
    expect(resolvePostUploadPlan({ enableAnalysis: false, enableTranscription: false })).toEqual({
      analysis: false,
      includeTranscript: false,
      legacyTranscription: false,
    });
  });
});
