import type {
  CreateQuestionBody,
  InterviewMode,
  KitSettings,
  McqOption,
  ProctoringLevel,
  RubricLine,
} from '@zios/shared-types';
import { uid } from './kit-utils';

/**
 * Template gallery (FR-E2-7, P1): client-side starter definitions applied
 * through the normal create APIs. Each template question prefers a real
 * question-bank clone (FR-E4-1/E4-3 provenance `bank`) — `bankQuery` runs
 * against GET /bank/questions scoped to the template's role family (topics
 * from the seed taxonomy make reliable ILIKE hits); when the bank yields no
 * match the inline `fallback` body is used instead (provenance `manual`).
 */

export interface KitTemplateQuestion {
  /** ILIKE query (matched on bank prompt+topic) — usually a seed topic name. */
  bankQuery: string;
  /** Inline definition used when the bank search comes back empty. */
  fallback: Omit<CreateQuestionBody, 'options' | 'rubricLines'> & {
    options?: Array<Omit<McqOption, 'id'>>;
    rubricLines: Array<Omit<RubricLine, 'id'>>;
  };
}

export interface KitTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  role: string;
  level: string;
  roleFamily: string;
  mode: InterviewMode;
  proctoringLevel: ProctoringLevel;
  totalTimeCapSec: number;
  questions: KitTemplateQuestion[];
}

function openEnded(
  bankQuery: string,
  topic: string,
  prompt: string,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
): KitTemplateQuestion {
  return {
    bankQuery,
    fallback: {
      type: 'open_ended',
      topic,
      prompt,
      difficulty,
      followupPolicy: 'adaptive_ai',
      followupDepthCap: 2,
      mandatory: true,
      timeLimitType: 'soft',
      rubricLines: [
        { text: 'Addresses the question directly with accurate content', weight: 0.5 },
        { text: 'Uses concrete examples from experience', weight: 0.3 },
        { text: 'Communicates clearly and in a structured way', weight: 0.2 },
      ],
    },
  };
}

function behavioral(bankQuery: string, topic: string, prompt: string): KitTemplateQuestion {
  return {
    bankQuery,
    fallback: {
      type: 'open_ended',
      topic,
      prompt,
      difficulty: 'medium',
      followupPolicy: 'fixed',
      followupFixed: ['Can you share a specific example and the outcome?'],
      mandatory: true,
      timeLimitType: 'soft',
      rubricLines: [
        { text: 'Describes a real situation with enough context', weight: 0.4 },
        { text: 'Explains their own actions and reasoning', weight: 0.4 },
        { text: 'Reflects on the result honestly', weight: 0.2 },
      ],
    },
  };
}

export const KIT_TEMPLATES: KitTemplate[] = [
  {
    id: 'frontend-engineer',
    name: 'Frontend Engineer',
    description: 'React, JavaScript fundamentals, CSS layout and web performance screening.',
    icon: 'web',
    role: 'Frontend Engineer',
    level: 'Mid-level',
    roleFamily: 'engineering-frontend',
    mode: 'text',
    proctoringLevel: 'standard',
    totalTimeCapSec: 2700,
    questions: [
      openEnded(
        'JavaScript fundamentals',
        'JavaScript fundamentals',
        'Explain the difference between var, let, and const in JavaScript, and when each belongs in a modern codebase.',
        'easy',
      ),
      openEnded(
        'React & state management',
        'React & state management',
        'A React screen re-renders far more than it should. How do you diagnose and fix it?',
      ),
      openEnded(
        'CSS & layout',
        'CSS & layout',
        'Walk me through how you would build a responsive card grid that adapts from 1 to 3 columns.',
      ),
      openEnded(
        'Web performance',
        'Web performance',
        'A page feels slow on mid-range phones. How do you find the bottleneck and what do you try first?',
      ),
      behavioral(
        'collaboration',
        'Collaboration',
        'Tell me about a time you disagreed with a teammate about a technical approach. What did you do?',
      ),
    ],
  },
  {
    id: 'backend-engineer',
    name: 'Backend Engineer',
    description: 'API design, databases, caching and concurrency for service-oriented roles.',
    icon: 'dns',
    role: 'Backend Engineer',
    level: 'Mid-level',
    roleFamily: 'engineering-backend',
    mode: 'text',
    proctoringLevel: 'standard',
    totalTimeCapSec: 2700,
    questions: [
      openEnded(
        'API design',
        'API design',
        'Design a paginated API endpoint for listing orders. What choices matter and why?',
      ),
      openEnded(
        'Databases & SQL',
        'Databases & SQL',
        'A SQL query that was fast in staging is slow in production. How do you investigate?',
      ),
      openEnded(
        'Caching & messaging',
        'Caching & messaging',
        'When would you reach for a cache, and how do you keep it from serving stale data?',
      ),
      openEnded(
        'System design',
        'System design',
        'Sketch how you would design a URL shortener that handles heavy read traffic.',
        'hard',
      ),
      behavioral(
        'incident',
        'Ownership',
        'Tell me about a production incident you owned end to end. What changed afterwards?',
      ),
    ],
  },
  {
    id: 'fullstack-engineer',
    name: 'Fullstack Engineer',
    description: 'Spans frontend frameworks, backend APIs, databases and debugging.',
    icon: 'layers',
    role: 'Fullstack Engineer',
    level: 'Mid-level',
    roleFamily: 'engineering-fullstack',
    mode: 'text',
    proctoringLevel: 'standard',
    totalTimeCapSec: 2700,
    questions: [
      openEnded(
        'JavaScript & TypeScript',
        'JavaScript & TypeScript',
        'Where does TypeScript genuinely help a team, and where does it get in the way?',
      ),
      openEnded(
        'Backend & APIs',
        'Backend & APIs',
        'Walk me through building a feature end to end — from database table to UI.',
      ),
      openEnded(
        'Databases',
        'Databases',
        'How do you decide what to index, and what can go wrong with too many indexes?',
      ),
      openEnded(
        'Debugging',
        'Debugging',
        'Users report the app is "sometimes slow". How do you turn that into something reproducible?',
      ),
      behavioral(
        'collaboration',
        'Collaboration',
        'Describe a feature you shipped that required coordinating frontend and backend changes.',
      ),
    ],
  },
  {
    id: 'data-engineer',
    name: 'Data Engineer',
    description: 'SQL, Python, data modeling and pipeline fundamentals for data roles.',
    icon: 'database',
    role: 'Data Engineer',
    level: 'Mid-level',
    roleFamily: 'engineering-data',
    mode: 'text',
    proctoringLevel: 'standard',
    totalTimeCapSec: 2700,
    questions: [
      openEnded(
        'SQL & analytics',
        'SQL & analytics',
        'Explain window functions with an example where a GROUP BY falls short.',
      ),
      openEnded(
        'Python for data',
        'Python for data',
        'How would you process a file too large to fit in memory with Python?',
      ),
      openEnded(
        'Data modeling',
        'Data modeling',
        'When would you denormalize a schema, and what do you give up?',
      ),
      openEnded(
        'Pipelines & ETL',
        'Pipelines & ETL',
        'A nightly pipeline silently produced wrong numbers for a week. How do you prevent that?',
      ),
      behavioral(
        'stakeholder',
        'Stakeholder management',
        'Tell me about a time an analyst or stakeholder asked for data you knew was unreliable.',
      ),
    ],
  },
  {
    id: 'devops-engineer',
    name: 'DevOps / SRE Engineer',
    description: 'CI/CD, containers, Kubernetes and incident response screening.',
    icon: 'cloud',
    role: 'DevOps Engineer',
    level: 'Mid-level',
    roleFamily: 'engineering-devops',
    mode: 'text',
    proctoringLevel: 'standard',
    totalTimeCapSec: 2700,
    questions: [
      openEnded(
        'CI/CD',
        'CI/CD',
        'What makes a CI pipeline trustworthy, and what makes teams start ignoring it?',
      ),
      openEnded(
        'Containers',
        'Containers',
        'Explain what happens when a container "restarts" and how you would debug a crash loop.',
      ),
      openEnded(
        'Kubernetes',
        'Kubernetes',
        'A deployment is stuck with pods pending. Walk me through your debugging steps.',
        'hard',
      ),
      openEnded(
        'Monitoring & incident response',
        'Monitoring & incident response',
        'How do you design alerts that page people rarely but catch real problems?',
      ),
      behavioral(
        'incident',
        'Incident response',
        'Walk me through the worst outage you have handled. What did the postmortem change?',
      ),
    ],
  },
  {
    id: 'qa-engineer',
    name: 'QA Engineer',
    description: 'Test design, automation strategy and bug lifecycle for quality roles.',
    icon: 'bug_report',
    role: 'QA Engineer',
    level: 'Mid-level',
    roleFamily: 'engineering-qa',
    mode: 'text',
    proctoringLevel: 'standard',
    totalTimeCapSec: 2400,
    questions: [
      openEnded(
        'Test design',
        'Test design',
        'How do you design test cases for a checkout flow? What edge cases do people usually miss?',
      ),
      openEnded(
        'Automation',
        'Automation',
        'Which tests do you automate first, and which do you deliberately keep manual?',
      ),
      openEnded(
        'API testing',
        'API testing',
        'How do you test an API that depends on third-party services?',
      ),
      openEnded(
        'Bug lifecycle',
        'Bug lifecycle',
        'What makes a bug report great? Show me how you would report an intermittent failure.',
      ),
      behavioral(
        'quality',
        'Quality advocacy',
        'Tell me about a time you pushed back on shipping something that was not ready.',
      ),
    ],
  },
  {
    id: 'sales-ae',
    name: 'Sales — Account Executive',
    description: 'Prospecting, discovery, objection handling and closing for quota-carrying roles.',
    icon: 'handshake',
    role: 'Account Executive',
    level: 'Mid-level',
    roleFamily: 'sales',
    mode: 'voice',
    proctoringLevel: 'none',
    totalTimeCapSec: 2400,
    questions: [
      openEnded(
        'Discovery & qualification',
        'Discovery & qualification',
        'Walk me through how you qualify a new opportunity. What disqualifies one fastest?',
      ),
      openEnded(
        'Objection handling',
        'Objection handling',
        'A prospect says your competitor is cheaper. Take me through your exact response.',
      ),
      openEnded(
        'Pipeline management',
        'Pipeline management',
        'How do you keep your pipeline honest? What does your weekly review look like?',
      ),
      openEnded(
        'Negotiation & closing',
        'Negotiation & closing',
        'Tell me about a deal that almost died at the finish line. How did you close it?',
      ),
      behavioral(
        'lost',
        'Resilience',
        'Describe a deal you lost that still bothers you. What did you change afterwards?',
      ),
    ],
  },
  {
    id: 'customer-support',
    name: 'Customer Support Specialist',
    description: 'Communication, de-escalation and SLA discipline for support teams.',
    icon: 'support_agent',
    role: 'Customer Support Specialist',
    level: 'Entry-level',
    roleFamily: 'customer-support',
    mode: 'voice',
    proctoringLevel: 'none',
    totalTimeCapSec: 2100,
    questions: [
      openEnded(
        'De-escalation',
        'De-escalation',
        'A customer is angry about being charged twice. Talk to me as if I am that customer.',
      ),
      openEnded(
        'Communication skills',
        'Communication skills',
        'How do you explain a technical issue to a non-technical customer without sounding dismissive?',
      ),
      openEnded(
        'SLA & quality',
        'SLA & quality',
        'How do you balance speed of response against quality when the queue is overflowing?',
      ),
      openEnded(
        'Escalation handling',
        'Escalation handling',
        'When do you escalate a ticket, and how do you hand it off without frustrating the customer?',
      ),
      behavioral(
        'difficult',
        'Customer empathy',
        'Tell me about the hardest customer interaction you have had. What did you learn?',
      ),
    ],
  },
  {
    id: 'hr-ops',
    name: 'HR & People Ops',
    description: 'Recruitment operations, employee relations and compliance fundamentals.',
    icon: 'diversity_3',
    role: 'HR Operations Executive',
    level: 'Entry-level',
    roleFamily: 'hr-ops',
    mode: 'text',
    proctoringLevel: 'none',
    totalTimeCapSec: 2100,
    questions: [
      openEnded(
        'Recruitment operations',
        'Recruitment operations',
        'How do you keep a high-volume hiring pipeline moving without candidates falling through the cracks?',
      ),
      openEnded(
        'Employee relations',
        'Employee relations',
        'An employee complains that their manager takes credit for their work. How do you handle it?',
      ),
      openEnded(
        'Onboarding & exits',
        'Onboarding & exits',
        'What does a great first week for a new joiner look like, and how do you make it happen?',
      ),
      openEnded(
        'Payroll & statutory compliance',
        'Payroll & statutory compliance',
        'Which statutory compliances must an Indian employer never miss, and how do you track them?',
      ),
      behavioral(
        'confidential',
        'Judgment',
        'Tell me about a time you had to keep something confidential that a colleague pressed you about.',
      ),
    ],
  },
  {
    id: 'finance-analyst',
    name: 'Finance Analyst',
    description: 'Accounting fundamentals, reconciliation and reporting for finance roles.',
    icon: 'account_balance',
    role: 'Finance Analyst',
    level: 'Entry-level',
    roleFamily: 'finance',
    mode: 'text',
    proctoringLevel: 'standard',
    totalTimeCapSec: 2400,
    questions: [
      openEnded(
        'Accounting fundamentals',
        'Accounting fundamentals',
        'Explain the difference between profit and cash flow to me like I run a small shop.',
      ),
      openEnded(
        'Reconciliation',
        'Reconciliation',
        'Your bank reconciliation does not tally. Walk me through how you find the difference.',
      ),
      openEnded(
        'GST & TDS',
        'GST & TDS',
        'What are the most common GST compliance mistakes small companies make?',
      ),
      openEnded(
        'Financial reporting',
        'Financial reporting',
        'How do you make sure a monthly MIS report is accurate before it goes to leadership?',
      ),
      behavioral(
        'deadline',
        'Working under deadlines',
        'Tell me about a month-end close that went wrong. What did you do?',
      ),
    ],
  },
  {
    id: 'marketing-associate',
    name: 'Marketing Associate',
    description: 'Performance marketing, SEO and analytics for growth roles.',
    icon: 'campaign',
    role: 'Marketing Associate',
    level: 'Entry-level',
    roleFamily: 'marketing',
    mode: 'text',
    proctoringLevel: 'none',
    totalTimeCapSec: 2100,
    questions: [
      openEnded(
        'Performance marketing',
        'Performance marketing',
        'A campaign is getting clicks but no conversions. How do you diagnose it?',
      ),
      openEnded(
        'SEO & content',
        'SEO & content',
        'How do you decide what content to write when starting SEO for a new product?',
      ),
      openEnded(
        'Marketing analytics',
        'Marketing analytics',
        'Which metrics do you report weekly, and which do you ignore on purpose?',
      ),
      openEnded(
        'Brand & positioning',
        'Brand & positioning',
        'Take a product you know well and explain its positioning. Who is it not for?',
      ),
      behavioral(
        'campaign',
        'Ownership',
        'Tell me about a campaign or project you ran end to end. What would you do differently?',
      ),
    ],
  },
  {
    id: 'product-manager',
    name: 'Product Manager',
    description: 'Discovery, prioritization, metrics and stakeholder management for PM roles.',
    icon: 'rocket_launch',
    role: 'Product Manager',
    level: 'Mid-level',
    roleFamily: 'product-management',
    mode: 'video',
    proctoringLevel: 'standard',
    totalTimeCapSec: 3000,
    questions: [
      openEnded(
        'Discovery & research',
        'Discovery & research',
        'How do you figure out what to build next when every stakeholder has a different answer?',
      ),
      openEnded(
        'Prioritization',
        'Prioritization',
        'Walk me through a prioritization framework you actually use, with a real example.',
      ),
      openEnded(
        'Metrics & analytics',
        'Metrics & analytics',
        'Pick a product you use daily. What is its north-star metric and why?',
      ),
      openEnded(
        'Stakeholder management',
        'Stakeholder management',
        'Engineering says a commitment you made is impossible. What do you do next?',
      ),
      behavioral(
        'failure',
        'Learning from failure',
        'Tell me about a product decision you got wrong. How did you find out?',
      ),
    ],
  },
  {
    id: 'campus-fresher',
    name: 'Campus Fresher — General',
    description: 'Aptitude, projects and communication screening for campus hiring drives.',
    icon: 'school',
    role: 'Graduate Trainee',
    level: 'Fresher',
    roleFamily: 'campus-fresher-general',
    mode: 'text',
    proctoringLevel: 'strict',
    totalTimeCapSec: 2400,
    questions: [
      openEnded(
        'Academics & projects',
        'Academics & projects',
        'Walk me through your favourite academic project. What was your specific contribution?',
      ),
      openEnded(
        'Programming basics',
        'Programming basics',
        'Explain a programming concept you found hard at first, and how it finally clicked.',
        'easy',
      ),
      openEnded(
        'Problem solving',
        'Problem solving',
        'How would you estimate the number of food delivery orders placed in your city each day?',
      ),
      openEnded(
        'Career readiness',
        'Career readiness',
        'Why this role, and what have you done in the last year to prepare for it?',
      ),
      behavioral(
        'teamwork',
        'Teamwork',
        'Tell me about a group project where someone was not pulling their weight. What did you do?',
      ),
    ],
  },
];

/** Question body with generated ids, ready for POST /kits/:id/questions. */
export function templateFallbackBody(question: KitTemplateQuestion): CreateQuestionBody {
  const { fallback } = question;
  return {
    ...fallback,
    options: fallback.options?.map((option) => ({ ...option, id: uid() })),
    rubricLines: fallback.rubricLines.map((line) => ({ ...line, id: uid() })),
  };
}

/** Settings the create call prefills for a template (mode/proctoring/cap). */
export function templateSettings(template: KitTemplate): Partial<KitSettings> {
  return {
    mode: template.mode,
    proctoringLevel: template.proctoringLevel,
    totalTimeCapSec: template.totalTimeCapSec,
    introText: `Welcome to the ${template.role} interview. You will answer ${template.questions.length} questions at your own pace.`,
    outroText:
      'Thank you for completing this interview. Our team will review your responses shortly.',
  };
}
