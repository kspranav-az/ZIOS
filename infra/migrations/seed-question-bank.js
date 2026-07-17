/**
 * Question-bank seed generator (FR-E4-1): turns the curated content in
 * seed-content.js into ≥ 500 fully-tagged question_bank_item rows.
 *
 * Design rules:
 *  - Deterministic: ids are sha256-derived UUIDs over (family|type|prompt), so
 *    reseeding is idempotent via INSERT ... ON CONFLICT (id) DO NOTHING.
 *  - Self-checking: buildItems() throws if any item violates the schema
 *    invariants (rubric weights summing to 1, MCQ ≥ 2 options, valid types).
 *  - Content is programmatic-but-curated: hand-written technical prompts and
 *    MCQs per family, plus shared behavioral/situational/screening pools and
 *    skill-parameterized frames. No lorem ipsum.
 */
const crypto = require('node:crypto');
const content = require('./seed-content');

const QUESTION_TYPES = ['open_ended', 'mcq_single', 'mcq_multi', 'rating_scale'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

/** Deterministic UUID (v4-shaped) from the item's identity. */
function stableId(family, type, prompt) {
  const hex = crypto
    .createHash('sha256')
    .update(`zios-bank-v1|${family}|${type}|${prompt}`)
    .digest('hex');
  const variant = '89ab'[Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function rubric(lines) {
  return lines.map(([text, weight], index) => ({ id: `r${index + 1}`, text, weight }));
}

function validateItem(item) {
  if (!QUESTION_TYPES.includes(item.type)) {
    throw new Error(`bad type for "${item.prompt.slice(0, 40)}"`);
  }
  if (!DIFFICULTIES.includes(item.difficulty)) {
    throw new Error(`bad difficulty for "${item.prompt.slice(0, 40)}"`);
  }
  if (!item.role_family || !item.topic || !item.prompt) {
    throw new Error(`missing fields for "${item.prompt.slice(0, 40)}"`);
  }
  const isMcq = item.type === 'mcq_single' || item.type === 'mcq_multi';
  if (isMcq && (!Array.isArray(item.options) || item.options.length < 2)) {
    throw new Error(`mcq needs ≥2 options: "${item.prompt.slice(0, 40)}"`);
  }
  if (!isMcq && item.options !== null) {
    throw new Error(`non-mcq must not carry options: "${item.prompt.slice(0, 40)}"`);
  }
  if (item.type === 'mcq_single') {
    const correct = item.options.filter((o) => o.correct === true).length;
    if (correct !== 1)
      throw new Error(`mcq_single needs exactly 1 correct option: "${item.prompt.slice(0, 40)}"`);
  }
  if (item.type === 'mcq_multi') {
    const correct = item.options.filter((o) => o.correct === true).length;
    if (correct < 1)
      throw new Error(`mcq_multi needs ≥1 correct option: "${item.prompt.slice(0, 40)}"`);
  }
  if (
    !Array.isArray(item.rubric_lines) ||
    item.rubric_lines.length < 2 ||
    item.rubric_lines.length > 4
  ) {
    throw new Error(`rubric needs 2–4 lines: "${item.prompt.slice(0, 40)}"`);
  }
  const sum = item.rubric_lines.reduce((total, line) => total + line.weight, 0);
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(`rubric weights must sum to 1 (got ${sum}): "${item.prompt.slice(0, 40)}"`);
  }
}

function openEnded(family, { topic, difficulty, prompt, rubric: lines, tags }) {
  return {
    id: stableId(family, 'open_ended', prompt),
    role_family: family,
    topic,
    type: 'open_ended',
    difficulty,
    prompt,
    options: null,
    rubric_lines: rubric(lines),
    tags: tags ?? ['technical'],
  };
}

function mcq(family, { topic, difficulty, prompt, options, multi, rubric: lines, tags }) {
  const type = multi ? 'mcq_multi' : 'mcq_single';
  return {
    id: stableId(family, type, prompt),
    role_family: family,
    topic,
    type,
    difficulty,
    prompt: multi ? `${prompt} (Select all that apply.)` : prompt,
    options: options.map((option, index) => ({
      id: `o${index + 1}`,
      text: option.text,
      correct: option.correct === true,
    })),
    rubric_lines: rubric(
      lines ?? [
        ['Selects the correct option(s) with no distractors', 0.8],
        ['Explanation, when asked, reflects the underlying concept rather than a guess', 0.2],
      ],
    ),
    tags: tags ?? ['technical', 'mcq'],
  };
}

function rating(family, topic, skill, index) {
  const prompt = `On a scale of 1–5, rate your hands-on proficiency with ${skill} — where 1 means basic awareness and 5 means you could defend design or process decisions in a senior review.`;
  return {
    id: stableId(family, 'rating_scale', `${prompt}#${index}`),
    role_family: family,
    topic,
    type: 'rating_scale',
    difficulty: 'medium',
    prompt,
    options: null,
    rubric_lines: rubric([
      ['Self-rating is calibrated and justified with concrete examples', 0.6],
      ['Shows awareness of what the next level up would require', 0.4],
    ]),
    tags: ['self-assessment', skill.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
  };
}

/* Template technical frames — real interview questions parameterized by the
 * family's skill list. */
const FRAMES = [
  {
    prompt: (skill) =>
      `Walk me through a project where you used ${skill} in a real, production setting. What trade-offs did you make?`,
    difficulty: 'medium',
    rubric: [
      ['Demonstrates genuine hands-on depth with the skill', 0.5],
      ['Reasons about trade-offs rather than reciting features', 0.3],
      ['Gives specific, verifiable project detail', 0.2],
    ],
  },
  {
    prompt: (skill) =>
      `What are the most common mistakes you see people make with ${skill}, and how do you avoid them?`,
    difficulty: 'medium',
    rubric: [
      ['Names real pitfalls, not textbook trivia', 0.5],
      ['Offers practical prevention or detection strategies', 0.3],
      ['Communicates clearly and structure the answer', 0.2],
    ],
  },
  {
    prompt: (skill) =>
      `How would you explain ${skill} to a junior colleague in plain language? Give me the analogy you would use.`,
    difficulty: 'easy',
    rubric: [
      ['Explanation is accurate at its level of abstraction', 0.4],
      ['Simplifies without condescension or hand-waving', 0.4],
      ['Uses a fitting analogy or example', 0.2],
    ],
  },
  {
    prompt: (skill) =>
      `Describe a time when expertise in ${skill} helped you prevent or fix a serious problem.`,
    difficulty: 'medium',
    rubric: [
      ['Problem and stakes are framed concretely', 0.3],
      ['Candidate\u2019s own contribution is specific', 0.45],
      ['Outcome is stated with real results', 0.25],
    ],
  },
  {
    prompt: (skill) =>
      `How do you measure whether you are using ${skill} well? What signals, metrics, or feedback do you watch?`,
    difficulty: 'hard',
    rubric: [
      ['Names meaningful, observable signals', 0.5],
      ['Connects signals to decisions or improvements', 0.3],
      ['Shows a continuous-improvement mindset', 0.2],
    ],
  },
  {
    prompt: (skill) =>
      `Something related to ${skill} breaks badly late on a Friday. Walk me through your first hour.`,
    difficulty: 'hard',
    rubric: [
      ['Triage and prioritization are sound under pressure', 0.4],
      ['Communication and escalation are handled professionally', 0.35],
      ['Technical or process reasoning is specific', 0.25],
    ],
  },
  {
    prompt: (skill) =>
      `What is a recent development in ${skill} that you had to learn, and how did you go about learning it?`,
    difficulty: 'easy',
    rubric: [
      ['Shows genuine, current engagement with the field', 0.4],
      ['Describes an effective self-directed learning approach', 0.35],
      ['Connects learning to actual work', 0.25],
    ],
  },
  {
    prompt: (skill) =>
      `When would you deliberately avoid ${skill}? What would you use instead, and why?`,
    difficulty: 'hard',
    rubric: [
      ['Understands the skill\u2019s limits and failure modes', 0.45],
      ['Proposes sensible alternatives with reasoning', 0.35],
      ['Avoids dogmatic or cargo-cult answers', 0.2],
    ],
  },
];

const BEHAVIORAL_DIFFICULTY = ['medium', 'medium', 'hard', 'easy', 'medium', 'hard'];
const SITUATIONAL_DIFFICULTY = ['medium', 'hard', 'medium', 'medium', 'hard'];
const SCREENING_DIFFICULTY = ['easy', 'medium', 'easy', 'medium'];

const BEHAVIORAL_RUBRIC = [
  ['Situation and task are framed clearly', 0.25],
  ['Candidate\u2019s own actions are specific (not "we did")', 0.45],
  ['Outcome and reflection are stated concretely', 0.3],
];
const SITUATIONAL_RUBRIC = [
  ['Judgment and prioritization are sound', 0.4],
  ['Communication and stakeholder handling are professional', 0.35],
  ['Shows ownership without overstepping', 0.25],
];
const SCREENING_RUBRIC = [
  ['Answer is clear, direct, and complete', 0.5],
  ['Signals align realistically with the role\u2019s constraints', 0.5],
];

/** Rotating slice of a shared pool so families overlap but are not identical. */
function pick(pool, familyIndex, count, stride) {
  const chosen = [];
  for (let j = 0; j < count; j += 1) {
    chosen.push(pool[(familyIndex * stride + j) % pool.length]);
  }
  return chosen;
}

/**
 * Assembles and validates the full bank. Per family: 8 curated technical +
 * 8 skill-frame technical + 5 curated MCQs + 1 workplace-judgment MCQ +
 * 4 rating-scale self-assessments + 6 behavioral + 5 situational + 4 screening
 * = 41 items (13 families → 533 total).
 */
function buildItems() {
  const items = [];
  content.families.forEach((family, familyIndex) => {
    // 1. Curated, hand-written technical questions.
    for (const t of family.technical) {
      items.push(openEnded(family.family, t));
    }
    // 2. Skill-parameterized technical frames.
    family.skills.forEach((skill, index) => {
      const frame = FRAMES[index % FRAMES.length];
      items.push(
        openEnded(family.family, {
          topic: family.topics[index % family.topics.length],
          difficulty: frame.difficulty,
          prompt: frame.prompt(skill),
          rubric: frame.rubric,
          tags: ['technical', skill.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
        }),
      );
    });
    // 3. Curated MCQs (4 single + 1 multi).
    for (const m of family.mcqs) {
      items.push(mcq(family.family, m));
    }
    // 4. Shared workplace-judgment MCQ (multi).
    const judgement = content.judgementMcqs[familyIndex % content.judgementMcqs.length];
    items.push(
      mcq(family.family, {
        topic: 'Workplace judgment',
        difficulty: 'medium',
        multi: true,
        ...judgement,
        tags: ['situational', 'mcq'],
      }),
    );
    // 5. Rating-scale self-assessments on a spread of skills.
    [0, 2, 4, 6].forEach((skillIndex, n) => {
      const skill = family.skills[skillIndex % family.skills.length];
      items.push(rating(family.family, family.topics[skillIndex % family.topics.length], skill, n));
    });
    // 6. Behavioral pool.
    pick(content.behavioral, familyIndex, 6, 6).forEach((prompt, j) => {
      items.push(
        openEnded(family.family, {
          topic: 'Behavioral',
          difficulty: BEHAVIORAL_DIFFICULTY[j % BEHAVIORAL_DIFFICULTY.length],
          prompt,
          rubric: BEHAVIORAL_RUBRIC,
          tags: ['behavioral'],
        }),
      );
    });
    // 7. Situational pool.
    pick(content.situational, familyIndex, 5, 5).forEach((prompt, j) => {
      items.push(
        openEnded(family.family, {
          topic: 'Situational judgment',
          difficulty: SITUATIONAL_DIFFICULTY[j % SITUATIONAL_DIFFICULTY.length],
          prompt,
          rubric: SITUATIONAL_RUBRIC,
          tags: ['situational'],
        }),
      );
    });
    // 8. Screening pool.
    pick(content.screening, familyIndex, 4, 4).forEach((prompt, j) => {
      items.push(
        openEnded(family.family, {
          topic: 'Screening',
          difficulty: SCREENING_DIFFICULTY[j % SCREENING_DIFFICULTY.length],
          prompt,
          rubric: SCREENING_RUBRIC,
          tags: ['screening'],
        }),
      );
    });
  });

  for (const item of items) {
    validateItem(item);
  }
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) {
    throw new Error(`duplicate stable ids: ${items.length - ids.size} collisions`);
  }
  return items;
}

module.exports = { buildItems };
