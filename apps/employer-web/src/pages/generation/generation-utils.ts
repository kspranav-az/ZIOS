import type { ProposedQuestion, QuestionType } from '@zios/shared-types';

export type QuestionEdit = {
  field: string;
  questionIndex: number;
  oldValue: unknown;
  newValue: unknown;
  at: string;
};

/** Formats a duration in seconds into a human-readable minute string. */
export function formatDuration(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min`;
}

/**
 * Groups proposed questions by topic, preserving the order of the supplied
 * topic list. Questions whose topic is not in the list are appended last.
 */
export function groupQuestionsByTopic(
  questions: ProposedQuestion[],
  topics: string[],
): Record<string, ProposedQuestion[]> {
  const byTopic: Record<string, ProposedQuestion[]> = {};
  for (const question of questions) {
    const list = byTopic[question.topic] ?? [];
    list.push(question);
    byTopic[question.topic] = list;
  }

  const ordered: Record<string, ProposedQuestion[]> = {};
  for (const topic of topics) {
    const list = byTopic[topic];
    if (list) {
      ordered[topic] = list;
      delete byTopic[topic];
    }
  }
  // Any remaining topics not in the canonical list (edge case).
  for (const topic of Object.keys(byTopic)) {
    const list = byTopic[topic];
    if (list) {
      ordered[topic] = list;
    }
  }
  return ordered;
}

/**
 * Returns the index of the lowest-priority question: the last question in
 * display order, because topics are ordered by priority and questions follow
 * topic order.
 */
export function findLowestPriorityQuestionIndex(questions: ProposedQuestion[]): number | null {
  if (questions.length === 0) return null;
  return questions.length - 1;
}

/**
 * Estimates total duration from per-question limits. Null limits fall back to
 * the default assumed by the backend estimator (120s). Includes the same 1.2x
 * overhead multiplier the backend uses.
 */
export function estimateTotalDuration(
  questions: ProposedQuestion[],
  defaultSeconds = 120,
): { baseSeconds: number; estimatedSeconds: number } {
  const baseSeconds = questions.reduce((sum, q) => sum + (q.timeLimitSec ?? defaultSeconds), 0);
  return { baseSeconds, estimatedSeconds: Math.round(baseSeconds * 1.2) };
}

/** Human-friendly labels for question types. */
export function questionTypeLabel(type: QuestionType): string {
  switch (type) {
    case 'open_ended':
      return 'Open ended';
    case 'mcq_single':
      return 'Single choice';
    case 'mcq_multi':
      return 'Multiple choice';
    case 'rating_scale':
      return 'Rating scale';
    default:
      return type;
  }
}

/** Follow-up policy label. */
export function followupPolicyLabel(policy: string): string {
  switch (policy) {
    case 'none':
      return 'No follow-ups';
    case 'fixed':
      return 'Fixed follow-ups';
    case 'adaptive_ai':
      return 'Adaptive AI follow-ups';
    default:
      return policy;
  }
}

/** Sample JD used as placeholder in the input screen. */
export function defaultSampleJd(): string {
  return `Senior Backend Engineer

We are looking for a senior backend engineer to design, build and operate the services that power our hiring platform. You will work in a cross-functional squad with product managers, designers and other engineers to ship reliable, scalable software.

Responsibilities:
- Design and implement RESTful and event-driven APIs in TypeScript and Node.js.
- Own data modeling, query performance and schema evolution in PostgreSQL.
- Build observable systems using structured logging, metrics and tracing.
- Collaborate on architecture decisions and mentor junior engineers.
- Maintain high test coverage and participate in code review.

Required skills:
- TypeScript, Node.js, PostgreSQL
- AWS or GCP
- Docker, Kubernetes, Terraform
- Strong communication and problem solving

Nice to have:
- Experience with event streaming (Kafka or RabbitMQ)
- Prior work in high-growth B2B SaaS startups`;
}
