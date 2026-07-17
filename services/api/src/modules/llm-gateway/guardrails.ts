import { Injectable } from '@nestjs/common';
import type { GuardrailProfile, GuardrailResult } from './contracts';

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?)/i,
  /forget\s+(?:all\s+)?(?:instructions?|prompts?|constraints?)/i,
  /you\s+(?:are|should\s+be)\s+(?:now\s+)?(?:an?\s+)?(?:unrestricted?|DAN|developer\s+mode)/i,
  /system\s*:\s*/i,
  /\{\{\s*system\s*\}\}/i,
];

const ANSWER_LEAKAGE_PATTERNS = [
  /the\s+answer\s+is/i,
  /correct\s+answer/i,
  /here\s+is\s+the\s+solution/i,
];

const PII_BAIT_PATTERNS = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // credit-card-like
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-like
];

@Injectable()
export class Guardrails {
  screenInput(
    text: string,
    profile: GuardrailProfile = 'internal_only',
    variables?: Record<string, unknown>,
  ): GuardrailResult {
    if (profile === 'internal_only') {
      return { blocked: false };
    }

    const textsToScreen = [text];
    if (variables) {
      textsToScreen.push(JSON.stringify(variables));
    }

    for (const candidate of textsToScreen) {
      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(candidate)) {
          return { blocked: true, reason: 'PROMPT_INJECTION_DETECTED' };
        }
      }

      if (profile === 'candidate_input') {
        for (const pattern of ANSWER_LEAKAGE_PATTERNS) {
          if (pattern.test(candidate)) {
            return { blocked: true, reason: 'ANSWER_LEAKAGE_DETECTED' };
          }
        }
      }

      if (profile === 'jd_input') {
        for (const pattern of PII_BAIT_PATTERNS) {
          if (pattern.test(candidate)) {
            return { blocked: true, reason: 'PII_BAIT_DETECTED' };
          }
        }
      }
    }

    return { blocked: false };
  }

  validateOutputShape(parsed: unknown, requiredKeys: string[]): GuardrailResult {
    if (typeof parsed !== 'object' || parsed === null) {
      return { blocked: true, reason: 'OUTPUT_NOT_AN_OBJECT' };
    }
    const record = parsed as Record<string, unknown>;
    for (const key of requiredKeys) {
      if (!(key in record)) {
        return { blocked: true, reason: `OUTPUT_MISSING_KEY:${key}` };
      }
    }
    return { blocked: false };
  }
}
