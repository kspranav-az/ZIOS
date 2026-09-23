import { describe, expect, it } from 'vitest';
import { flagSuggestionHonesty, validateMatchHonesty } from './honesty';

describe('resume-jd-match honesty guardrail (D10)', () => {
  it('passes an honest rewording that keeps the original numbers', () => {
    expect(
      flagSuggestionHonesty({
        original: 'Led a team of 5 engineers and cut deploy time by 40%.',
        improved: 'Led a team of 5 engineers, reducing deploy time by 40%.',
      }),
    ).toEqual([]);
  });

  it('flags a metric invented by the model', () => {
    const flags = flagSuggestionHonesty({
      original: 'Responsible for the checkout service.',
      improved: 'Owned the checkout service, lifting conversion by 35%.',
    });
    expect(flags).toContain('fabricated-metric:35');
  });

  it('flags decimal fabrication but tolerates reordered existing numbers', () => {
    expect(
      flagSuggestionHonesty({
        original: 'Cut costs by 1,200 hours across 3 teams.',
        improved: 'Across 3 teams, saved 1200 hours.',
      }),
    ).toEqual([]);
    expect(
      flagSuggestionHonesty({
        original: 'Improved performance.',
        improved: 'Improved performance by 2.5x.',
      }),
    ).toContain('fabricated-metric:2.5');
  });

  it('validates a whole result set, attaching flags per suggestion', () => {
    const out = validateMatchHonesty([
      { original: 'Built the API.', improved: 'Built the API serving 10k RPM.' },
      { original: 'Mentored 2 interns.', improved: 'Mentored 2 interns to full-time offers.' },
    ]);
    expect(out[0]!.honestyFlags).toContain('fabricated-metric:10');
    expect(out[1]!.honestyFlags).toEqual([]);
  });
});
