/**
 * Curated question-bank content (FR-E4-1). Hand-written prompts per role
 * family plus shared behavioral/situational/screening pools; assembled into
 * items by seed-question-bank.js. Real Indian-hiring interview questions —
 * no filler. Rubric weights must sum to 1 (the generator validates this).
 */

/* Shared pools ---------------------------------------------------------- */

const behavioral = [
  'Tell me about a time you had to deliver something important under a tight deadline. How did you manage it?',
  'Describe a situation where you disagreed with a teammate or manager about the right approach. What did you do?',
  'Tell me about a mistake you made at work that had real consequences. How did you handle it?',
  'Give me an example of a time you had to learn a new skill quickly to complete a task.',
  'Tell me about a time you received critical feedback. How did you respond?',
  'Describe a project or task you are most proud of. What was your specific contribution?',
  'Tell me about a time you had to work with someone whose working style was very different from yours.',
  'Give an example of when you went beyond your defined role to help the team succeed.',
  'Tell me about a time you had to manage multiple competing priorities. How did you decide what to do first?',
  'Describe a time when you identified a problem before others noticed it. What did you do?',
  'Tell me about a time you had to explain something complex to a non-expert audience.',
  'Describe a situation where you had to adapt to a major change at work — a new tool, process, or team structure.',
];

const situational = [
  'You realize two hours before a deadline that the deliverable has a significant error. Walk me through your next steps.',
  'A colleague keeps missing deadlines and it is affecting your work. How do you handle it?',
  'Your manager asks you to do something you are fairly sure is the wrong approach. What do you do?',
  'You are new on a team and notice an inefficient process everyone accepts as normal. How do you respond?',
  'You receive conflicting instructions from two senior people. How do you proceed?',
  'A customer or stakeholder is unhappy and blaming your team publicly. How do you respond?',
  'Midway through a project, the requirements change significantly. What do you do?',
  'You see a teammate taking credit for work you did. How do you address it?',
  'You are asked to work on something you have never done before, with little guidance. How do you approach it?',
  'You notice a small issue that is not your responsibility but could grow into a bigger problem. What do you do?',
  'Your team is split between two approaches and you are the tiebreaker. How do you decide?',
  'You have more work than you can finish well. How do you handle it?',
];

const screening = [
  'What is your current notice period, and when is the earliest you could join?',
  'What are your compensation expectations for this role, and how did you arrive at that number?',
  'This role is based in a specific city with a hybrid setup. How does that fit your current situation?',
  'What prompted you to look for a change at this point in your career?',
  'Are you interviewing anywhere else currently? How far along are those processes?',
  'How do you feel about the occasional travel or shift requirements this role may involve?',
  'What do you know about our company, and why does this role interest you?',
  'Looking at the role description, which parts play to your strengths and which would be new territory for you?',
];

/* Workplace-judgment MCQs (multi-select), rotated across families. */
const judgementMcqs = [
  {
    prompt:
      'Which of the following are good practices when giving a status update to stakeholders?',
    options: [
      { text: 'Flag risks early, even before you have a solution', correct: true },
      { text: 'Tailor the level of detail to the audience', correct: true },
      { text: 'Wait until someone asks for an update' },
      { text: 'Hold back bad news until it is resolved' },
    ],
  },
  {
    prompt: 'Which of these are signs of a well-written bug report or work ticket?',
    options: [
      { text: 'Clear steps to reproduce the issue', correct: true },
      { text: 'Expected behavior stated next to actual behavior', correct: true },
      { text: 'A name assigned for who caused it' },
      { text: 'A one-word title so it stays short' },
    ],
  },
  {
    prompt: 'In a code or document review, which comments are most useful to the author?',
    options: [
      { text: 'Specific, actionable suggestions', correct: true },
      { text: 'Questions about the intent behind a choice', correct: true },
      { text: 'Personal preferences stated without any rationale' },
      { text: 'An approval with no sign the work was read' },
    ],
  },
  {
    prompt: 'Which are professional ways to handle a meeting invite you cannot attend?',
    options: [
      { text: 'Propose an alternative time that works', correct: true },
      { text: 'Ask for the agenda and contribute your input asynchronously', correct: true },
      { text: 'Ignore the invite and hope it resolves itself' },
      { text: 'Decline with no reason and no follow-up' },
    ],
  },
  {
    prompt: 'Before escalating an issue to your manager, which should you generally do first?',
    options: [
      { text: 'Attempt to resolve it at your own level', correct: true },
      { text: 'Gather the facts and possible options to present', correct: true },
      { text: 'Escalate immediately on every issue, however small' },
      { text: 'Wait until the problem becomes too big to hide' },
    ],
  },
  {
    prompt: 'Which habits make remote or hybrid collaboration effective?',
    options: [
      { text: 'Writing decisions and context down where the team can find them', correct: true },
      { text: 'Proactively sharing status instead of waiting to be asked', correct: true },
      { text: 'Assuming silence in the channel means agreement' },
      { text: 'Keeping key decisions in private one-on-one chats' },
    ],
  },
];

/* Role families ---------------------------------------------------------- */

const families = [
  {
    family: 'engineering-frontend',
    topics: [
      'JavaScript fundamentals',
      'React & state management',
      'CSS & layout',
      'Web performance',
      'Frontend testing',
      'Accessibility',
    ],
    skills: [
      'JavaScript (ES6+)',
      'TypeScript',
      'React',
      'CSS layout',
      'State management',
      'the browser rendering pipeline',
      'Web performance optimization',
      'Web accessibility (a11y)',
    ],
    technical: [
      {
        topic: 'JavaScript fundamentals',
        difficulty: 'easy',
        prompt:
          'Explain the difference between var, let, and const in JavaScript, and the class of bugs var tends to cause in real codebases.',
        rubric: [
          ['Explains scoping and hoisting accurately', 0.5],
          ['Gives a concrete bug example', 0.3],
          ['Communicates clearly', 0.2],
        ],
      },
      {
        topic: 'JavaScript fundamentals',
        difficulty: 'hard',
        prompt:
          'Walk me through how the JavaScript event loop interleaves promises, setTimeout callbacks, and rendering. Where do developers usually get surprised?',
        rubric: [
          ['Correct microtask vs macrotask mental model', 0.5],
          ['Walks through a concrete ordering example', 0.3],
          ['Explains clearly without hand-waving', 0.2],
        ],
      },
      {
        topic: 'React & state management',
        difficulty: 'medium',
        prompt:
          'A React screen re-renders far more than it should and feels laggy. How do you diagnose the wasted renders, and what fixes do you reach for first?',
        rubric: [
          ['Profiles before optimizing (dev tools, why-did-you-render)', 0.4],
          ['Understands reconciliation, memoization, and referential equality', 0.4],
          ['Presents a systematic, not scattergun, approach', 0.2],
        ],
      },
      {
        topic: 'CSS & layout',
        difficulty: 'medium',
        prompt:
          'When do you choose CSS Grid over Flexbox, and vice versa? Describe a concrete layout where each is clearly the right tool.',
        rubric: [
          ['Has an accurate mental model of both systems', 0.5],
          ['Gives realistic layout examples for each', 0.3],
          ['Is pragmatic, not dogmatic', 0.2],
        ],
      },
      {
        topic: 'Web performance',
        difficulty: 'hard',
        prompt:
          'A product page takes six seconds to become interactive on a mid-range Android phone over 4G. Walk me through your investigation and the fixes you would try first.',
        rubric: [
          ['Measures first (Lighthouse, WebPageTest, field data)', 0.4],
          ['Knows the main levers: bundle size, images, third-party scripts, hydration', 0.4],
          ['Prioritizes by impact for the actual user device', 0.2],
        ],
      },
      {
        topic: 'Frontend testing',
        difficulty: 'medium',
        prompt:
          'How do you decide what gets a unit test, what gets a component test, and what gets covered end-to-end in a frontend codebase?',
        rubric: [
          ['Applies testing-pyramid judgment sensibly', 0.45],
          ['Reasons about cost, confidence, and flakiness trade-offs', 0.35],
          ['Grounds the answer in real examples', 0.2],
        ],
      },
      {
        topic: 'Accessibility',
        difficulty: 'easy',
        prompt:
          'What are the most common accessibility mistakes you encounter in web interfaces, and how do you catch them before release?',
        rubric: [
          ['Knows the common issues (contrast, focus, semantics, labels)', 0.5],
          ['Names tooling or process that catches them early', 0.3],
          ['Shows genuine user empathy, not checkbox compliance', 0.2],
        ],
      },
      {
        topic: 'React & state management',
        difficulty: 'hard',
        prompt:
          'Compare keeping server-fetched data in a global store versus a data-cache library. When does each approach start hurting?',
        rubric: [
          ['Distinguishes server state from client state', 0.5],
          ['Reasons about staleness, duplication, and boilerplate', 0.35],
          ['Speaks from evident experience', 0.15],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'JavaScript fundamentals',
        difficulty: 'easy',
        prompt: 'What does Promise.all([p1, p2]) do when p1 rejects?',
        options: [
          {
            text: "It rejects immediately with p1's reason, without waiting for p2",
            correct: true,
          },
          { text: 'It waits for p2 to settle, then rejects' },
          { text: 'It rejects with an array containing all rejection reasons' },
          { text: 'It never rejects; failed promises become undefined' },
        ],
      },
      {
        topic: 'CSS & layout',
        difficulty: 'easy',
        prompt: 'Which of these has the highest CSS specificity?',
        options: [
          { text: 'An inline style attribute', correct: true },
          { text: 'A selector with one id, like #nav .item' },
          { text: 'A selector with two classes, like .item.active' },
          { text: 'A selector like div > span' },
        ],
      },
      {
        topic: 'React & state management',
        difficulty: 'medium',
        prompt: 'When does the effect in useEffect(() => { ... }, []) run?',
        options: [
          { text: "Once, after the component's first render", correct: true },
          { text: "Before the component's first render" },
          { text: 'After every render of the component' },
          { text: 'Only when the component unmounts' },
        ],
      },
      {
        topic: 'Web performance',
        difficulty: 'medium',
        prompt:
          'Which HTTP status code tells the browser its cached copy of a resource is still valid?',
        options: [
          { text: '304 Not Modified', correct: true },
          { text: '200 OK' },
          { text: '302 Found' },
          { text: '412 Precondition Failed' },
        ],
      },
      {
        topic: 'JavaScript fundamentals',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which of these Array methods return a new array without mutating the original?',
        options: [
          { text: 'map', correct: true },
          { text: 'filter', correct: true },
          { text: 'push' },
          { text: 'sort' },
        ],
      },
    ],
  },

  {
    family: 'engineering-backend',
    topics: [
      'API design',
      'Databases & SQL',
      'Caching & messaging',
      'Concurrency',
      'System design',
      'Security & observability',
    ],
    skills: [
      'REST API design',
      'SQL and query optimization',
      'Redis caching',
      'Message queues (Kafka/RabbitMQ)',
      'Concurrency control',
      'System design',
      'Logging and monitoring',
      'API security',
    ],
    technical: [
      {
        topic: 'API design',
        difficulty: 'medium',
        prompt:
          "Design pagination for a 'list orders' endpoint that may return millions of rows. When do you pick cursor-based over offset-based pagination?",
        rubric: [
          ['Explains offset vs cursor trade-offs correctly', 0.45],
          ['Considers consistency under concurrent writes', 0.35],
          ['Thinks about API ergonomics and clients', 0.2],
        ],
      },
      {
        topic: 'Databases & SQL',
        difficulty: 'hard',
        prompt:
          'A query that used to be fast suddenly became slow after a data migration. Walk me through how you investigate.',
        rubric: [
          ['Reaches for the execution plan and statistics first', 0.45],
          ['Considers bloat, stale stats, index usage, and plan changes', 0.35],
          ['Follows a methodical process, not guesswork', 0.2],
        ],
      },
      {
        topic: 'Caching & messaging',
        difficulty: 'medium',
        prompt:
          'Explain cache-aside versus write-through caching. What cache invalidation bugs have you actually seen in production?',
        rubric: [
          ['Explains both patterns accurately', 0.4],
          ['Discusses invalidation and staleness honestly', 0.4],
          ['Gives real production examples', 0.2],
        ],
      },
      {
        topic: 'Caching & messaging',
        difficulty: 'medium',
        prompt:
          "A consumer keeps failing on the same 'poison' message and blocking the queue. How do you design the system to handle this?",
        rubric: [
          ['Knows retries, dead-letter queues, and backoff', 0.5],
          ['Thinks about ordering and idempotency', 0.3],
          ['Considers observability and alerting', 0.2],
        ],
      },
      {
        topic: 'Concurrency',
        difficulty: 'hard',
        prompt:
          "Two users click 'buy' on the last item in stock at the same moment. Walk me through the options for preventing a double sale.",
        rubric: [
          ['Identifies the race condition precisely', 0.35],
          ['Compares locks, atomic updates, and constraints with trade-offs', 0.45],
          ['Considers failure and retry behavior', 0.2],
        ],
      },
      {
        topic: 'System design',
        difficulty: 'hard',
        prompt:
          'Sketch a URL shortener that must handle 100 million redirects a day. Which parts would you deliberately keep simple?',
        rubric: [
          ['Covers the core flow: key generation, storage, redirect path', 0.45],
          ['Scales the read path sensibly (cache, stateless tier)', 0.35],
          ['Avoids over-engineering and says so', 0.2],
        ],
      },
      {
        topic: 'Security & observability',
        difficulty: 'easy',
        prompt:
          'What do you log, what do you put in metrics, and what do you trace in a typical HTTP service — and what do you deliberately avoid logging?',
        rubric: [
          ['Sensible split across logs, metrics, and traces', 0.45],
          ['Knows not to log PII, tokens, and passwords', 0.35],
          ['Thinks about debugging value vs noise', 0.2],
        ],
      },
      {
        topic: 'Security & observability',
        difficulty: 'medium',
        prompt: 'Where do teams most commonly get authorization wrong in the APIs they build?',
        rubric: [
          ['Identifies object-level authorization (IDOR) and tenancy bugs', 0.45],
          ['Mentions deny-by-default and server-side checks', 0.35],
          ['Gives concrete examples', 0.2],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Databases & SQL',
        difficulty: 'easy',
        prompt: 'Which JOIN returns only the rows that have a match in both tables?',
        options: [
          { text: 'INNER JOIN', correct: true },
          { text: 'LEFT JOIN' },
          { text: 'FULL OUTER JOIN' },
          { text: 'CROSS JOIN' },
        ],
      },
      {
        topic: 'API design',
        difficulty: 'medium',
        prompt:
          "Which HTTP status code best fits 'the request payload was well-formed but violates business rules'?",
        options: [
          { text: '422 Unprocessable Content', correct: true },
          { text: '400 Bad Request' },
          { text: '409 Conflict' },
          { text: '500 Internal Server Error' },
        ],
      },
      {
        topic: 'Caching & messaging',
        difficulty: 'medium',
        prompt: 'Why is running KEYS * dangerous on a production Redis instance?',
        options: [
          {
            text: 'It blocks the single-threaded server while scanning the whole keyspace',
            correct: true,
          },
          { text: 'It deletes all expired keys immediately' },
          { text: 'It evicts a random sample of keys' },
          { text: 'It breaks replication to the replicas' },
        ],
      },
      {
        topic: 'Databases & SQL',
        difficulty: 'hard',
        prompt:
          'A composite B-tree index on (tenant_id, created_at) can also efficiently serve a query filtering only on which column?',
        options: [
          { text: 'tenant_id', correct: true },
          { text: 'created_at alone' },
          { text: 'Either column equally well' },
          { text: 'Neither — both columns are always required' },
        ],
      },
      {
        topic: 'Databases & SQL',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which of the following are guarantees of an ACID transaction?',
        options: [
          { text: 'Atomicity', correct: true },
          { text: 'Isolation', correct: true },
          { text: 'Availability under network partitions' },
          { text: 'Automatic retry after serialization failures' },
        ],
      },
    ],
  },

  {
    family: 'engineering-fullstack',
    topics: [
      'JavaScript & TypeScript',
      'Backend & APIs',
      'Frontend frameworks',
      'Databases',
      'DevOps basics',
      'Debugging',
    ],
    skills: [
      'TypeScript',
      'Node.js',
      'React',
      'SQL databases',
      'REST API design',
      'Git workflows',
      'Docker',
      'End-to-end debugging',
    ],
    technical: [
      {
        topic: 'Debugging',
        difficulty: 'medium',
        prompt:
          'Walk me through a full-stack feature you shipped end to end — from schema to UI. Where did the design change along the way, and why?',
        rubric: [
          ['Covers the whole stack credibly', 0.4],
          ['Shows design judgment and iteration', 0.35],
          ['Owns specific contributions', 0.25],
        ],
      },
      {
        topic: 'JavaScript & TypeScript',
        difficulty: 'medium',
        prompt:
          'Where does TypeScript genuinely help a full-stack codebase, and where have you seen it add more ceremony than value?',
        rubric: [
          ['Balanced, experience-based view', 0.4],
          ['Concrete examples on both sides', 0.35],
          ['Pragmatic about team and codebase size', 0.25],
        ],
      },
      {
        topic: 'Debugging',
        difficulty: 'hard',
        prompt:
          "A user reports: 'the page sometimes shows stale data right after I save.' Walk me through how you debug this across the whole stack.",
        rubric: [
          ['Forms hypotheses across cache layers (browser, CDN, app, DB)', 0.45],
          ['Uses reproduction and instrumentation systematically', 0.35],
          ['Communicates a clear debugging narrative', 0.2],
        ],
      },
      {
        topic: 'Backend & APIs',
        difficulty: 'medium',
        prompt:
          'How do you keep API contracts between frontend and backend from drifting out of sync as both evolve?',
        rubric: [
          ['Knows contract testing / schema sharing approaches', 0.45],
          ['Reasons about versioning and backward compatibility', 0.35],
          ['Practical about team process', 0.2],
        ],
      },
      {
        topic: 'Backend & APIs',
        difficulty: 'easy',
        prompt:
          "Explain what happens from the moment a user hits 'submit' on a form until the response renders — trace as much of the stack as you can.",
        rubric: [
          ['Traces browser → network → server → database → render coherently', 0.55],
          ['Gets the key details right (validation, status codes, state update)', 0.3],
          ['Structured, clear explanation', 0.15],
        ],
      },
      {
        topic: 'Databases',
        difficulty: 'hard',
        prompt:
          'When would you push business logic into the database layer (constraints, triggers, stored procedures), and when is that a mistake?',
        rubric: [
          ['Understands integrity vs application-logic boundaries', 0.45],
          ['Weighs maintainability and testability trade-offs', 0.35],
          ['Gives a defensible default position', 0.2],
        ],
      },
      {
        topic: 'DevOps basics',
        difficulty: 'medium',
        prompt:
          "How do you make a local development environment reproducible for a new teammate? What belongs in containers and what doesn't?",
        rubric: [
          ['Practical containerization judgment', 0.45],
          ['Thinks about seeds, env config, and documentation', 0.35],
          ['Measures success as time-to-first-commit', 0.2],
        ],
      },
      {
        topic: 'DevOps basics',
        difficulty: 'easy',
        prompt:
          'Describe your Git workflow on a team — branching, reviews, and how you recover when you mess something up.',
        rubric: [
          ['Describes a sane, consistent workflow', 0.4],
          ['Knows recovery techniques (revert, reset, reflog)', 0.35],
          ['Values review and small changes', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'JavaScript & TypeScript',
        difficulty: 'easy',
        prompt: "What does the expression '5' + 3 evaluate to in JavaScript?",
        options: [
          { text: "'53'", correct: true },
          { text: '8' },
          { text: 'NaN' },
          { text: 'It throws a TypeError' },
        ],
      },
      {
        topic: 'Backend & APIs',
        difficulty: 'medium',
        prompt: 'Which of these HTTP methods is NOT idempotent?',
        options: [
          { text: 'POST', correct: true },
          { text: 'GET' },
          { text: 'PUT' },
          { text: 'DELETE' },
        ],
      },
      {
        topic: 'Databases',
        difficulty: 'medium',
        prompt: 'In SQL, what does NULL = NULL evaluate to?',
        options: [
          { text: 'NULL (unknown) — the comparison is never true', correct: true },
          { text: 'TRUE' },
          { text: 'FALSE' },
          { text: 'It raises a syntax error' },
        ],
      },
      {
        topic: 'JavaScript & TypeScript',
        difficulty: 'medium',
        prompt: 'In TypeScript, what does Partial<User> produce?',
        options: [
          { text: 'A type with all User properties made optional', correct: true },
          { text: 'A type with only the required User properties' },
          { text: 'A subset of User chosen at compile time' },
          { text: 'A runtime copy of the User object with some fields removed' },
        ],
      },
      {
        topic: 'DevOps basics',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which practices keep a full-stack codebase healthy as the team grows?',
        options: [
          { text: 'Shared lint and format configuration enforced in CI', correct: true },
          { text: 'Contract tests between frontend and backend', correct: true },
          { text: 'Merging directly to main without review to move fast' },
          { text: 'One global mutable state object for the whole app' },
        ],
      },
    ],
  },

  {
    family: 'engineering-data',
    topics: [
      'SQL & analytics',
      'Python for data',
      'Data modeling',
      'Pipelines & ETL',
      'Statistics',
      'Dashboards & storytelling',
    ],
    skills: [
      'SQL',
      'Python (pandas)',
      'Data modeling',
      'ETL/ELT pipelines',
      'Statistics fundamentals',
      'Dashboarding tools',
      'Data quality checks',
      'Spark or distributed processing',
    ],
    technical: [
      {
        topic: 'SQL & analytics',
        difficulty: 'medium',
        prompt:
          'You need the latest order per customer from a 50-million-row orders table. Talk me through your approach and why it scales.',
        rubric: [
          ['Reaches for window functions or an equivalent set-based approach', 0.5],
          ['Thinks about indexes and data volume', 0.3],
          ['Explains the reasoning, not just the syntax', 0.2],
        ],
      },
      {
        topic: 'SQL & analytics',
        difficulty: 'hard',
        prompt:
          'Tell me about a slow analytical query you fixed. What was the execution plan telling you, and what did you change?',
        rubric: [
          ['Reads execution plans fluently', 0.45],
          ['Diagnosis is specific (scans, joins, skew, cardinality)', 0.35],
          ['Verifies the improvement with numbers', 0.2],
        ],
      },
      {
        topic: 'Python for data',
        difficulty: 'medium',
        prompt:
          'Where do pandas workflows break down, and what do you reach for when a dataframe no longer fits comfortably in memory?',
        rubric: [
          ['Knows pandas memory and performance limits', 0.4],
          ['Names sensible alternatives (chunking, DuckDB, Spark, SQL push-down)', 0.4],
          ['Pragmatic about when scale is real vs imagined', 0.2],
        ],
      },
      {
        topic: 'Data modeling',
        difficulty: 'medium',
        prompt:
          'When designing a star schema for sales analytics, what goes into fact versus dimension tables? What mistakes do people make here?',
        rubric: [
          ['Clear fact vs dimension mental model', 0.5],
          ['Knows grain and why it matters', 0.3],
          ['Anticipates common modeling mistakes', 0.2],
        ],
      },
      {
        topic: 'Pipelines & ETL',
        difficulty: 'hard',
        prompt:
          'A daily ETL job silently loaded half its usual rows for a week before anyone noticed. How do you design pipelines so this gets caught immediately?',
        rubric: [
          ['Proposes concrete data quality checks (volume, freshness, nulls)', 0.45],
          ['Thinks about alerting ownership and runbooks', 0.3],
          ['Considers idempotent re-runs and backfills', 0.25],
        ],
      },
      {
        topic: 'Statistics',
        difficulty: 'medium',
        prompt:
          'Marketing claims a campaign lifted conversion from 2.0% to 2.4%. How do you decide whether to believe it?',
        rubric: [
          ['Thinks about sample size and significance', 0.45],
          ['Questions experiment design and confounders', 0.35],
          ['Communicates uncertainty honestly', 0.2],
        ],
      },
      {
        topic: 'Dashboards & storytelling',
        difficulty: 'easy',
        prompt: 'What separates a dashboard people actually use from one that gets ignored?',
        rubric: [
          ['Focuses on decisions, not decoration', 0.45],
          ['Understands the audience and their questions', 0.35],
          ['Mentions maintenance and trust in the numbers', 0.2],
        ],
      },
      {
        topic: 'Pipelines & ETL',
        difficulty: 'medium',
        prompt:
          'What data quality checks do you automate in a pipeline, and what should happen when one fails at 3 AM?',
        rubric: [
          ['Names concrete check categories', 0.45],
          ['Sensible severity model (page vs ticket vs warn)', 0.35],
          ['Thinks about downstream impact of bad data', 0.2],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'SQL & analytics',
        difficulty: 'easy',
        prompt: 'Which SQL clause filters groups after aggregation?',
        options: [
          { text: 'HAVING', correct: true },
          { text: 'WHERE' },
          { text: 'ORDER BY' },
          { text: 'LIMIT' },
        ],
      },
      {
        topic: 'Statistics',
        difficulty: 'medium',
        prompt: 'A p-value of 0.03 most nearly means…',
        options: [
          {
            text: 'If there were truly no effect, data at least this extreme would appear about 3% of the time',
            correct: true,
          },
          { text: 'There is a 3% chance the result is wrong' },
          { text: 'The effect size is 3%' },
          { text: 'There is a 97% chance the alternative hypothesis is true' },
        ],
      },
      {
        topic: 'Python for data',
        difficulty: 'medium',
        prompt: "In pandas, what does df.groupby('city').sales.sum() return?",
        options: [
          { text: 'Total sales per city', correct: true },
          { text: 'The city with the highest sales' },
          { text: 'A list of all sales rows sorted by city' },
          { text: 'The overall sum of the sales column' },
        ],
      },
      {
        topic: 'Data modeling',
        difficulty: 'hard',
        prompt: 'The main reason to denormalize into a star schema is…',
        options: [
          { text: 'Simpler, faster analytical queries', correct: true },
          { text: 'Lower total storage usage' },
          { text: 'Stronger referential integrity' },
          { text: 'Easier transactional (OLTP) writes' },
        ],
      },
      {
        topic: 'Pipelines & ETL',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which are properties of an idempotent data pipeline?',
        options: [
          { text: 'Re-running it for the same window produces the same result', correct: true },
          { text: 'Failures can be safely retried without duplicating data', correct: true },
          { text: 'It runs exactly once, ever' },
          { text: 'It never needs backfills' },
        ],
      },
    ],
  },

  {
    family: 'engineering-devops',
    topics: [
      'CI/CD',
      'Containers',
      'Kubernetes',
      'Cloud infrastructure',
      'Infrastructure as Code',
      'Monitoring & incident response',
    ],
    skills: [
      'CI/CD pipelines',
      'Docker',
      'Kubernetes',
      'AWS or another cloud platform',
      'Terraform',
      'Monitoring and alerting',
      'Linux administration',
      'Networking fundamentals',
    ],
    technical: [
      {
        topic: 'CI/CD',
        difficulty: 'medium',
        prompt:
          'Walk me through the CI/CD pipeline you would set up for a small team shipping a web service several times a day.',
        rubric: [
          ['Covers build, test, and deploy stages sensibly', 0.4],
          ['Thinks about rollback and safe deploys', 0.35],
          ['Right-sizes the solution for a small team', 0.25],
        ],
      },
      {
        topic: 'Containers',
        difficulty: 'easy',
        prompt:
          "Explain the difference between a Docker image and a container, and why 'it works on my machine' stops being an excuse.",
        rubric: [
          ['Explains image vs container accurately', 0.5],
          ['Connects to environment reproducibility', 0.3],
          ['Clear, jargon-appropriate explanation', 0.2],
        ],
      },
      {
        topic: 'Kubernetes',
        difficulty: 'hard',
        prompt:
          'A pod keeps getting OOMKilled in production. Walk me through how you diagnose and fix it.',
        rubric: [
          ['Knows requests, limits, and how OOMKills happen', 0.45],
          ['Diagnoses with metrics and events before changing anything', 0.35],
          ['Distinguishes symptom fix from root-cause fix', 0.2],
        ],
      },
      {
        topic: 'Cloud infrastructure',
        difficulty: 'medium',
        prompt:
          'How do you keep the cloud bill from surprising the team at month-end without slowing engineers down?',
        rubric: [
          ['Knows the main cost levers and visibility tools', 0.4],
          ['Balances governance with developer velocity', 0.35],
          ['Gives concrete examples (tagging, budgets, rightsizing)', 0.25],
        ],
      },
      {
        topic: 'Infrastructure as Code',
        difficulty: 'medium',
        prompt:
          'What does Terraform state represent, and what goes wrong when two engineers run apply at the same time?',
        rubric: [
          ['Understands state as the source of truth mapping', 0.45],
          ['Explains locking and remote state correctly', 0.35],
          ['Mentions code review for infra changes', 0.2],
        ],
      },
      {
        topic: 'Monitoring & incident response',
        difficulty: 'medium',
        prompt:
          'How do you design alerts that page people only when action is genuinely required? What alert fatigue have you seen?',
        rubric: [
          ['Ties alerts to user impact and actionability', 0.45],
          ['Understands symptom-based vs cause-based alerting', 0.35],
          ['Speaks from real on-call experience', 0.2],
        ],
      },
      {
        topic: 'Monitoring & incident response',
        difficulty: 'hard',
        prompt:
          'The site is down and you are the on-call engineer. Talk me through your first fifteen minutes.',
        rubric: [
          ['Triage is structured: assess, mitigate, communicate', 0.4],
          ['Prioritizes mitigation over root-cause analysis initially', 0.35],
          ['Communicates with stakeholders early', 0.25],
        ],
      },
      {
        topic: 'Containers',
        difficulty: 'easy',
        prompt:
          'A deploy fails because the disk is full on a server. What commands do you reach for, and how do you prevent a recurrence?',
        rubric: [
          ['Practical command-line fluency (df, du, logs)', 0.45],
          ['Identifies likely culprits (logs, images, temp files)', 0.3],
          ['Proposes prevention (rotation, alerts, cleanup)', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Containers',
        difficulty: 'easy',
        prompt: 'What is the main difference between a Docker image and a container?',
        options: [
          {
            text: 'An image is a read-only template; a container is a running instance of it',
            correct: true,
          },
          { text: 'An image is a running process; a container is its configuration file' },
          { text: 'They are two names for the same thing' },
          { text: 'Images run on Linux; containers run on any OS' },
        ],
      },
      {
        topic: 'Kubernetes',
        difficulty: 'medium',
        prompt: 'In Kubernetes, what does a Deployment primarily manage?',
        options: [
          {
            text: 'The desired replica count and rollout strategy for a set of pods',
            correct: true,
          },
          { text: 'The network rules between namespaces' },
          { text: 'The persistent volumes attached to nodes' },
          { text: 'The container registry credentials' },
        ],
      },
      {
        topic: 'Infrastructure as Code',
        difficulty: 'medium',
        prompt: 'Why do teams store Terraform state remotely with locking?',
        options: [
          { text: 'To prevent concurrent applies from corrupting the state', correct: true },
          { text: 'To make terraform plan run faster' },
          { text: 'To encrypt the state at rest by default' },
          { text: 'To share state across unrelated projects' },
        ],
      },
      {
        topic: 'Monitoring & incident response',
        difficulty: 'hard',
        prompt: 'What does a 503 from a load balancer usually indicate?',
        options: [
          { text: 'The load balancer reached no healthy backend', correct: true },
          { text: 'The client sent a malformed request' },
          { text: 'The TLS certificate has expired' },
          { text: 'The DNS record is misconfigured' },
        ],
      },
      {
        topic: 'Monitoring & incident response',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which properties make a production alert good?',
        options: [
          { text: 'It is actionable — someone must do something when it fires', correct: true },
          { text: 'It maps to user impact, not just an internal metric', correct: true },
          { text: 'It fires on every minor anomaly so nothing is missed' },
          { text: 'It pages the whole team for maximum coverage' },
        ],
      },
    ],
  },

  {
    family: 'engineering-qa',
    topics: [
      'Test design',
      'Automation',
      'API testing',
      'Bug lifecycle',
      'Performance testing',
      'Quality process',
    ],
    skills: [
      'Test planning and design',
      'UI automation (Selenium/Cypress/Playwright)',
      'API testing',
      'Bug triage and reporting',
      'Regression strategy',
      'Performance testing',
      'SQL for test verification',
      'Exploratory testing',
    ],
    technical: [
      {
        topic: 'Test design',
        difficulty: 'medium',
        prompt:
          'Given a login screen with email, password, and an OTP option, walk me through how you would design test cases for it.',
        rubric: [
          ['Covers happy path, negative, and boundary cases systematically', 0.45],
          ['Thinks about security and lockout behavior', 0.3],
          ['Organized, prioritized test thinking', 0.25],
        ],
      },
      {
        topic: 'Automation',
        difficulty: 'medium',
        prompt:
          'What do you automate first on a new project, and what do you deliberately keep manual?',
        rubric: [
          ['Prioritizes by ROI, not by fashion', 0.45],
          ['Understands where automation is brittle (visual, exploratory)', 0.35],
          ['Considers maintenance cost honestly', 0.2],
        ],
      },
      {
        topic: 'Automation',
        difficulty: 'hard',
        prompt:
          'Your UI automation suite has a 20% flaky rate and nobody trusts it anymore. How do you fix this?',
        rubric: [
          ['Diagnoses flake sources (waits, test data, isolation, env)', 0.45],
          ['Has a systematic quarantine-and-fix plan', 0.35],
          ['Addresses the trust/process dimension too', 0.2],
        ],
      },
      {
        topic: 'API testing',
        difficulty: 'medium',
        prompt:
          'How do you test an API beyond the happy path? Give me concrete categories of negative tests you would write.',
        rubric: [
          ['Covers validation, auth, state, and contract cases', 0.5],
          ['Thinks about idempotency and concurrency', 0.3],
          ['Structures tests for maintainability', 0.2],
        ],
      },
      {
        topic: 'Bug lifecycle',
        difficulty: 'medium',
        prompt:
          'What makes a bug report genuinely useful to a developer? Walk me through one you were proud of.',
        rubric: [
          ['Knows the anatomy of an actionable report', 0.45],
          ['Understands severity vs priority in triage', 0.3],
          ['Shows empathy for the developer workflow', 0.25],
        ],
      },
      {
        topic: 'Performance testing',
        difficulty: 'hard',
        prompt:
          'How would you load-test a checkout flow that must survive a festive-sale traffic spike?',
        rubric: [
          ['Defines realistic load models and SLAs first', 0.4],
          ['Knows tooling and bottleneck analysis', 0.35],
          ['Considers data, environment, and downstream limits', 0.25],
        ],
      },
      {
        topic: 'Quality process',
        difficulty: 'medium',
        prompt:
          'The release is tomorrow and there is no time to run the full regression suite. How do you decide what to test?',
        rubric: [
          ['Risk-based prioritization tied to what changed', 0.45],
          ['Uses coverage, history, and business criticality', 0.35],
          ['Communicates residual risk explicitly', 0.2],
        ],
      },
      {
        topic: 'API testing',
        difficulty: 'easy',
        prompt:
          'When do you use SQL directly during testing instead of trusting what the UI shows you?',
        rubric: [
          ['Understands UI can mask data-layer bugs', 0.45],
          ['Gives concrete verification examples', 0.35],
          ['Comfortable reading and writing queries', 0.2],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Test design',
        difficulty: 'easy',
        prompt: 'Boundary value analysis mainly focuses tests on…',
        options: [
          { text: 'Values at the edges of input ranges', correct: true },
          { text: 'Random values across the whole input space' },
          { text: 'Only the most common user inputs' },
          { text: 'Values that are guaranteed to be invalid' },
        ],
      },
      {
        topic: 'Automation',
        difficulty: 'medium',
        prompt: 'The test pyramid suggests the bulk of automated tests should be…',
        options: [
          { text: 'Unit tests', correct: true },
          { text: 'End-to-end UI tests' },
          { text: 'Manual regression tests' },
          { text: 'Performance tests' },
        ],
      },
      {
        topic: 'Automation',
        difficulty: 'medium',
        prompt: 'What is a flaky test?',
        options: [
          { text: 'A test that passes and fails without any code change', correct: true },
          { text: 'A test that always fails on the first run' },
          { text: 'A test that runs very slowly' },
          { text: 'A test written without assertions' },
        ],
      },
      {
        topic: 'Test design',
        difficulty: 'hard',
        prompt: 'What does mutation testing measure?',
        options: [
          {
            text: 'How well the test suite detects deliberately introduced code changes',
            correct: true,
          },
          { text: 'How fast the test suite runs after refactoring' },
          { text: 'How much code changed between two releases' },
          { text: 'How many tests were updated in the last sprint' },
        ],
      },
      {
        topic: 'Bug lifecycle',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which elements belong in a good bug report?',
        options: [
          { text: 'Steps to reproduce the issue', correct: true },
          { text: 'Expected behavior stated next to actual behavior', correct: true },
          { text: 'The name of the person who caused the bug' },
          { text: 'A proposed code fix for every bug, however minor' },
        ],
      },
    ],
  },

  {
    family: 'sales',
    topics: [
      'Prospecting',
      'Discovery & qualification',
      'Objection handling',
      'Pipeline management',
      'Negotiation & closing',
      'Product & market knowledge',
    ],
    skills: [
      'Cold calling',
      'Prospecting via LinkedIn and email',
      'Discovery questioning',
      'CRM hygiene',
      'Objection handling',
      'Product demos',
      'Negotiation',
      'Sales forecasting',
    ],
    technical: [
      {
        topic: 'Prospecting',
        difficulty: 'medium',
        prompt:
          'Walk me through how you would build a prospect list for a B2B product selling to HR heads at mid-size Indian companies.',
        rubric: [
          ['Defines the ICP before list-building', 0.4],
          ['Knows sourcing channels and tools realistically', 0.35],
          ['Thinks about segmentation and personalization', 0.25],
        ],
      },
      {
        topic: 'Prospecting',
        difficulty: 'easy',
        prompt:
          'Take me through your opening thirty seconds on a cold call. How do you earn the next two minutes?',
        rubric: [
          ['Opening is respectful, relevant, and brief', 0.4],
          ['Personalizes rather than reading a generic script', 0.35],
          ['Handles brush-offs with composure', 0.25],
        ],
      },
      {
        topic: 'Discovery & qualification',
        difficulty: 'medium',
        prompt:
          'What questions do you ask on a first discovery call to decide whether a prospect is worth your time?',
        rubric: [
          ['Asks about problem, impact, and decision process', 0.45],
          ['Qualifies honestly instead of forcing fit', 0.35],
          ['Listens more than pitches', 0.2],
        ],
      },
      {
        topic: 'Objection handling',
        difficulty: 'medium',
        prompt:
          "A prospect says 'we already use a competitor and it is fine.' Walk me through how you respond.",
        rubric: [
          ['Probes for gaps instead of trashing the competitor', 0.4],
          ['Stays curious and non-defensive', 0.35],
          ['Finds a concrete wedge or accepts the loss gracefully', 0.25],
        ],
      },
      {
        topic: 'Objection handling',
        difficulty: 'hard',
        prompt:
          "'Your price is too high' — is that always the real objection? How do you find out what is actually going on?",
        rubric: [
          ['Distinguishes price from value, budget, and authority issues', 0.45],
          ['Uses diagnostic questions before conceding anything', 0.35],
          ['Protects value instead of reflex-discounting', 0.2],
        ],
      },
      {
        topic: 'Pipeline management',
        difficulty: 'hard',
        prompt:
          'Your quarter ends in two weeks and you are at 60% of target. Walk me through what you do.',
        rubric: [
          ['Triage the pipeline by closeability, not hope', 0.4],
          ['Has concrete acceleration moves (multi-threading, mutual plans)', 0.35],
          ['Is honest with the forecast and with themselves', 0.25],
        ],
      },
      {
        topic: 'Pipeline management',
        difficulty: 'easy',
        prompt:
          'Why does CRM hygiene matter beyond keeping your manager happy? What is your personal system?',
        rubric: [
          ['Connects hygiene to forecast accuracy and follow-ups', 0.45],
          ['Has a real, repeatable personal system', 0.35],
          ['Practical, not performative, attitude', 0.2],
        ],
      },
      {
        topic: 'Negotiation & closing',
        difficulty: 'hard',
        prompt:
          'A deal is stuck because procurement demands a 30% discount. How do you handle it without giving away the margin?',
        rubric: [
          ['Trades concessions for value (term, volume, case study)', 0.4],
          ['Engages economic buyers, not just procurement', 0.35],
          ['Knows when to walk away', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Product & market knowledge',
        difficulty: 'easy',
        prompt: 'In sales, what does MQL stand for?',
        options: [
          { text: 'Marketing Qualified Lead', correct: true },
          { text: 'Maximum Quota Level' },
          { text: 'Managed Quality List' },
          { text: 'Monthly Quota Limit' },
        ],
      },
      {
        topic: 'Pipeline management',
        difficulty: 'medium',
        prompt:
          'Your demo-to-closure conversion rate is 25%. If you closed 8 deals this quarter, roughly how many demos did you run?',
        options: [{ text: '32', correct: true }, { text: '16' }, { text: '24' }, { text: '80' }],
      },
      {
        topic: 'Discovery & qualification',
        difficulty: 'medium',
        prompt: "In the BANT qualification framework, what does the 'A' stand for?",
        options: [
          { text: 'Authority', correct: true },
          { text: 'Affinity' },
          { text: 'Availability' },
          { text: 'Analysis' },
        ],
      },
      {
        topic: 'Discovery & qualification',
        difficulty: 'hard',
        prompt: 'What is the main purpose of a discovery call?',
        options: [
          {
            text: "To understand the prospect's problem and qualify fit — not to pitch",
            correct: true,
          },
          { text: 'To demo every feature of the product' },
          { text: 'To negotiate pricing as early as possible' },
          { text: 'To collect contact details for the CRM' },
        ],
      },
      {
        topic: 'Negotiation & closing',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which are good follow-up practices after a product demo?',
        options: [
          { text: 'Sending a recap with the agreed next steps', correct: true },
          { text: 'Setting a specific time for the next conversation', correct: true },
          { text: "Sending 'just checking in' messages every day" },
          { text: 'Offering a discount immediately to create urgency' },
        ],
      },
    ],
  },

  {
    family: 'customer-support',
    topics: [
      'Communication skills',
      'De-escalation',
      'Support tools & process',
      'SLA & quality',
      'Escalation handling',
      'Customer empathy',
    ],
    skills: [
      'De-escalation techniques',
      'Ticketing systems (Freshdesk/Zendesk)',
      'SLA management',
      'Written customer communication',
      'Escalation handling',
      'Active listening',
      'Troubleshooting basics',
      'Churn-save conversations',
    ],
    technical: [
      {
        topic: 'De-escalation',
        difficulty: 'medium',
        prompt:
          'A customer opens the chat furious — they were charged twice and this is their third contact. Walk me through exactly how you handle the first five messages.',
        rubric: [
          ['Acknowledges and owns the issue before solving', 0.4],
          ['Gives concrete next steps and timelines', 0.35],
          ['Stays calm and never defensive', 0.25],
        ],
      },
      {
        topic: 'Communication skills',
        difficulty: 'easy',
        prompt:
          'What separates a good written reply to a customer from a bad one? Show me how you would phrase a delay update.',
        rubric: [
          ['Clear, human, and jargon-free writing', 0.4],
          ['Sets accurate expectations with specifics', 0.35],
          ['Closes the loop rather than leaving it open', 0.25],
        ],
      },
      {
        topic: 'SLA & quality',
        difficulty: 'medium',
        prompt:
          'The ticket queue keeps growing and you cannot get to everything. How do you triage which tickets get your attention first?',
        rubric: [
          ['Triages by impact and urgency, not arrival order', 0.45],
          ['Protects SLAs and vulnerable customers', 0.3],
          ['Communicates delays proactively', 0.25],
        ],
      },
      {
        topic: 'Customer empathy',
        difficulty: 'medium',
        prompt:
          'Tell me about a time you turned an angry customer into a satisfied one. What specifically did you do?',
        rubric: [
          ['Concrete story with specific actions', 0.45],
          ['Demonstrates genuine listening and ownership', 0.35],
          ['Reflects on what made it work', 0.2],
        ],
      },
      {
        topic: 'Escalation handling',
        difficulty: 'medium',
        prompt:
          'When do you escalate a ticket to engineering versus handling it yourself? What is the cost of escalating too fast?',
        rubric: [
          ['Has a sensible escalation threshold', 0.4],
          ['Understands the cost both ways (slow resolution vs wasted eng time)', 0.35],
          ['Writes escalation notes that engineers can act on', 0.25],
        ],
      },
      {
        topic: 'Customer empathy',
        difficulty: 'hard',
        prompt:
          'A long-time customer says they want to cancel because of repeated outages. How do you handle this conversation?',
        rubric: [
          ['Listens and acknowledges before retaining', 0.35],
          ['Offers concrete remedies, not platitudes', 0.4],
          ['Respects the decision and keeps the relationship intact', 0.25],
        ],
      },
      {
        topic: 'Support tools & process',
        difficulty: 'easy',
        prompt: 'How do you use macros or canned responses without sounding like a robot?',
        rubric: [
          ['Personalizes the opening and specifics', 0.4],
          ['Knows when a template is the wrong tool', 0.35],
          ['Balances speed with quality consciously', 0.25],
        ],
      },
      {
        topic: 'Support tools & process',
        difficulty: 'hard',
        prompt:
          'A customer reports a problem you cannot reproduce on your end. Walk me through how you investigate.',
        rubric: [
          ['Gathers environment specifics systematically', 0.4],
          ['Uses logs, screenshots, and session details effectively', 0.35],
          ['Keeps the customer informed through a slow investigation', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'SLA & quality',
        difficulty: 'easy',
        prompt: 'First Response Time (FRT) measures…',
        options: [
          { text: "The time from the customer's message to the first agent reply", correct: true },
          { text: 'The time taken to fully resolve the ticket' },
          { text: 'The time a ticket waits in the backlog before assignment' },
          { text: "The customer's typing speed during chat" },
        ],
      },
      {
        topic: 'SLA & quality',
        difficulty: 'medium',
        prompt: 'CSAT in a support context is typically measured by…',
        options: [
          { text: 'A post-resolution customer satisfaction survey', correct: true },
          { text: 'The number of tickets closed per day' },
          { text: 'The average handle time per ticket' },
          { text: 'The number of escalations per month' },
        ],
      },
      {
        topic: 'De-escalation',
        difficulty: 'medium',
        prompt:
          'A customer starts using abusive language toward you. The best first response is to…',
        options: [
          {
            text: 'Stay calm, set a polite boundary, and keep focusing on resolving their issue',
            correct: true,
          },
          { text: 'Warn them and disconnect the chat immediately' },
          { text: 'Respond firmly so they stop' },
          { text: 'Transfer them to a colleague without saying anything' },
        ],
      },
      {
        topic: 'Escalation handling',
        difficulty: 'hard',
        prompt: 'A good escalation note to engineering always includes…',
        options: [
          {
            text: 'Steps to reproduce, customer impact, and what support already tried',
            correct: true,
          },
          { text: "Only the customer's complaint in their own words" },
          { text: 'A request to fix it urgently with no details' },
          { text: 'A screenshot of the CRM ticket count' },
        ],
      },
      {
        topic: 'De-escalation',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which phrases genuinely help de-escalate an upset customer?',
        options: [
          { text: "'I can see why that is frustrating — let me fix this for you'", correct: true },
          {
            text: "'Here is exactly what happens next, and when you will hear from me'",
            correct: true,
          },
          { text: "'Calm down, please'" },
          { text: "'That is just our policy'" },
        ],
      },
    ],
  },

  {
    family: 'hr-ops',
    topics: [
      'Recruitment operations',
      'Payroll & statutory compliance',
      'Onboarding & exits',
      'Employee relations',
      'HRIS & documentation',
      'Engagement',
    ],
    skills: [
      'Payroll processing',
      'PF/ESI and statutory compliance',
      'POSH compliance',
      'Onboarding workflows',
      'HRIS tools (Keka/Zoho People)',
      'Offer and appointment documentation',
      'Employee grievance handling',
      'Exit formalities',
    ],
    technical: [
      {
        topic: 'Payroll & statutory compliance',
        difficulty: 'medium',
        prompt:
          'Walk me through your monthly payroll run for a 200-person company — inputs, checks, and statutory deadlines.',
        rubric: [
          ['Knows the end-to-end payroll cycle and inputs', 0.45],
          ['Names statutory deadlines (PF, ESI, TDS, PT)', 0.35],
          ['Has reconciliation and error-check habits', 0.2],
        ],
      },
      {
        topic: 'Payroll & statutory compliance',
        difficulty: 'hard',
        prompt:
          'An employee asks why their PF deduction changed after a salary revision. How do you verify and respond?',
        rubric: [
          ['Understands PF wage ceiling and basic+DA rules', 0.45],
          ['Verifies against records before answering', 0.3],
          ['Explains deductions in plain language', 0.25],
        ],
      },
      {
        topic: 'Employee relations',
        difficulty: 'medium',
        prompt:
          'An employee approaches you informally about harassment by a senior manager. What are your obligations and first steps?',
        rubric: [
          ['Knows POSH obligations and ICC process', 0.45],
          ['Handles confidentiality and documentation correctly', 0.3],
          ['Shows empathy without prejudging', 0.25],
        ],
      },
      {
        topic: 'Onboarding & exits',
        difficulty: 'easy',
        prompt:
          'Design the first week of onboarding for a remote hire so they are productive and feel welcomed.',
        rubric: [
          ['Covers access, tools, and documentation readiness', 0.35],
          ['Includes human connection (buddy, manager time)', 0.35],
          ['Sets clear first-week expectations', 0.3],
        ],
      },
      {
        topic: 'Employee relations',
        difficulty: 'medium',
        prompt:
          'Two team members are in open conflict and one files a formal complaint against the other. How do you handle it?',
        rubric: [
          ['Follows a fair, documented process', 0.4],
          ['Hears both sides without bias', 0.35],
          ['Balances resolution with policy obligations', 0.25],
        ],
      },
      {
        topic: 'HRIS & documentation',
        difficulty: 'easy',
        prompt:
          'What belongs in an offer letter versus an appointment letter, and which mistakes in these documents cause trouble later?',
        rubric: [
          ['Knows the purpose and content of each document', 0.45],
          ['Names real pitfalls (notice clauses, CTC breakup, probation)', 0.35],
          ['Shows attention to legal detail', 0.2],
        ],
      },
      {
        topic: 'Onboarding & exits',
        difficulty: 'medium',
        prompt:
          'An employee resigns abruptly and demands early relieving with a full-and-final settlement within a week. How do you respond?',
        rubric: [
          ['Knows notice-period and F&F norms and timelines', 0.4],
          ['Balances empathy with policy and handover needs', 0.35],
          ['Documents everything properly', 0.25],
        ],
      },
      {
        topic: 'HRIS & documentation',
        difficulty: 'medium',
        prompt:
          'How do you keep employee data clean in an HRIS when managers keep forgetting to update anything?',
        rubric: [
          ['Builds process and automation around the problem', 0.4],
          ['Uses audits and exception reports', 0.35],
          ['Understands why data hygiene matters downstream', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Payroll & statutory compliance',
        difficulty: 'easy',
        prompt: 'The standard employee contribution rate to EPF is…',
        options: [
          { text: '12% of basic wages', correct: true },
          { text: '5% of gross salary' },
          { text: '18% of CTC' },
          { text: 'A flat ₹1,800 per month regardless of salary' },
        ],
      },
      {
        topic: 'Employee relations',
        difficulty: 'medium',
        prompt: 'The POSH Act requires an Internal Complaints Committee in workplaces with…',
        options: [
          { text: '10 or more employees', correct: true },
          { text: '50 or more employees' },
          { text: '100 or more employees' },
          { text: 'Any number of employees' },
        ],
      },
      {
        topic: 'Payroll & statutory compliance',
        difficulty: 'medium',
        prompt: 'ESI coverage generally applies to employees earning up to…',
        options: [
          { text: '₹21,000 per month', correct: true },
          { text: '₹15,000 per month' },
          { text: '₹50,000 per month' },
          { text: '₹1,00,000 per month' },
        ],
      },
      {
        topic: 'Payroll & statutory compliance',
        difficulty: 'hard',
        prompt: 'Gratuity generally becomes payable after how many years of continuous service?',
        options: [
          { text: '5 years', correct: true },
          { text: '1 year' },
          { text: '3 years' },
          { text: '10 years' },
        ],
      },
      {
        topic: 'Onboarding & exits',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which documents are typically collected from a new hire at onboarding in India?',
        options: [
          { text: 'PAN card', correct: true },
          { text: 'Aadhaar or another address proof', correct: true },
          { text: 'Original degree certificates, to be retained by the company' },
          { text: 'Bank statements of immediate family members' },
        ],
      },
    ],
  },

  {
    family: 'finance',
    topics: [
      'Accounting fundamentals',
      'GST & TDS',
      'Reconciliation',
      'Financial reporting',
      'Compliance & audit',
      'Tools & Excel',
    ],
    skills: [
      'GST returns (GSTR-1/3B)',
      'TDS compliance',
      'Bank reconciliation',
      'Advanced Excel',
      'MIS reporting',
      'Accounts payable and receivable',
      'Budgeting and variance analysis',
      'Audit support',
    ],
    technical: [
      {
        topic: 'Accounting fundamentals',
        difficulty: 'easy',
        prompt:
          'Walk me through the three financial statements, and how a single ₹1 lakh sale made on credit flows through them.',
        rubric: [
          ['Names and explains all three statements correctly', 0.45],
          ['Traces the transaction accurately', 0.35],
          ['Explains in plain language', 0.2],
        ],
      },
      {
        topic: 'GST & TDS',
        difficulty: 'medium',
        prompt:
          'Explain the difference between GSTR-1 and GSTR-3B, and what you do when they do not match.',
        rubric: [
          ['Explains both returns accurately', 0.45],
          ['Has a methodical mismatch-resolution approach', 0.35],
          ['Aware of ITC impact and timelines', 0.2],
        ],
      },
      {
        topic: 'GST & TDS',
        difficulty: 'medium',
        prompt:
          'A vendor invoice for professional services arrives without PAN details. What are the TDS implications, and what do you do?',
        rubric: [
          ['Knows the higher-deduction rule for missing PAN', 0.45],
          ['Has a practical vendor-follow-up process', 0.3],
          ['Understands deposit and return timelines', 0.25],
        ],
      },
      {
        topic: 'Reconciliation',
        difficulty: 'medium',
        prompt:
          'Your bank reconciliation shows a ₹47,000 difference that is not timing-related. How do you track it down?',
        rubric: [
          ['Works systematically through unmatched entries', 0.45],
          ['Considers bank charges, duplicates, and posting errors', 0.35],
          ['Documents and resolves rather than forcing a plug', 0.2],
        ],
      },
      {
        topic: 'Tools & Excel',
        difficulty: 'hard',
        prompt:
          'Describe the most complex Excel model or report you maintain. How do you keep it from breaking when other people use it?',
        rubric: [
          ['Demonstrates genuine advanced Excel depth', 0.4],
          ['Thinks about robustness: validation, locked cells, documentation', 0.35],
          ['Knows when Excel is the wrong tool', 0.25],
        ],
      },
      {
        topic: 'Compliance & audit',
        difficulty: 'hard',
        prompt:
          'Month-end is in two days, invoices are piling up, and a key vendor threatens to stop supply over delayed payment. How do you prioritize?',
        rubric: [
          ['Triages by business impact and relationships', 0.4],
          ['Communicates proactively with vendors and internally', 0.35],
          ['Keeps compliance and cut-off discipline intact', 0.25],
        ],
      },
      {
        topic: 'Financial reporting',
        difficulty: 'medium',
        prompt:
          'What does a good monthly MIS pack for a founder contain — and what do you deliberately leave out?',
        rubric: [
          ['Focuses on decisions, not data dumps', 0.4],
          ['Covers cash, P&L, and key variances', 0.35],
          ['Understands the audience', 0.25],
        ],
      },
      {
        topic: 'Compliance & audit',
        difficulty: 'medium',
        prompt:
          'Statutory auditors ask for three years of vendor ageing with supporting documents. How do you prepare without panic?',
        rubric: [
          ['Has an organized audit-readiness approach', 0.4],
          ['Knows what documentation supports balances', 0.35],
          ['Manages timelines and expectations calmly', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'GST & TDS',
        difficulty: 'easy',
        prompt: 'Input Tax Credit (ITC) under GST means…',
        options: [
          {
            text: 'Credit for GST paid on purchases, offset against GST payable on sales',
            correct: true,
          },
          { text: 'A refund of income tax paid by the company' },
          { text: 'An exemption from filing GST returns' },
          { text: 'A penalty waiver for late GST filing' },
        ],
      },
      {
        topic: 'GST & TDS',
        difficulty: 'medium',
        prompt: 'TDS on professional fees under Section 194J is generally deducted at…',
        options: [{ text: '10%', correct: true }, { text: '2%' }, { text: '5%' }, { text: '20%' }],
      },
      {
        topic: 'Accounting fundamentals',
        difficulty: 'medium',
        prompt: 'A debit note is typically issued when…',
        options: [
          { text: 'Goods are returned to a supplier', correct: true },
          { text: 'A customer pays an invoice early' },
          { text: 'Salary is credited to employees' },
          { text: 'GST returns are filed' },
        ],
      },
      {
        topic: 'Accounting fundamentals',
        difficulty: 'hard',
        prompt: 'Under accrual accounting, revenue is recognized when…',
        options: [
          { text: 'It is earned, regardless of when cash is received', correct: true },
          { text: 'Cash hits the bank account' },
          { text: 'The invoice is raised' },
          { text: 'The financial year ends' },
        ],
      },
      {
        topic: 'Compliance & audit',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which of the following are good internal controls over payments?',
        options: [
          { text: 'Maker-checker approval for every payment', correct: true },
          { text: 'Periodic review of the vendor master for duplicates or changes', correct: true },
          { text: 'One person creates, approves, and pays vendors end to end' },
          { text: 'Sharing banking OTPs within the team for faster approvals' },
        ],
      },
    ],
  },

  {
    family: 'marketing',
    topics: [
      'Performance marketing',
      'SEO & content',
      'Marketing analytics',
      'Brand & positioning',
      'Email & lifecycle',
      'Social media',
    ],
    skills: [
      'Google Ads',
      'Meta Ads',
      'SEO',
      'Content strategy',
      'Marketing analytics (GA4)',
      'Email marketing',
      'Social media management',
      'Copywriting',
    ],
    technical: [
      {
        topic: 'Performance marketing',
        difficulty: 'medium',
        prompt:
          'You have ₹5 lakh per month for paid acquisition for a B2B SaaS product. How do you split it across channels, and how do you decide what to scale?',
        rubric: [
          ['Allocates by funnel stage and audience fit', 0.4],
          ['Defines measurable success criteria before spending', 0.35],
          ['Has a disciplined test-and-scale loop', 0.25],
        ],
      },
      {
        topic: 'Marketing analytics',
        difficulty: 'hard',
        prompt:
          'Customer acquisition cost doubled in a month while spend stayed flat. Walk me through your diagnosis.',
        rubric: [
          ['Decomposes CAC into funnel stages methodically', 0.45],
          ['Considers seasonality, competition, and tracking changes', 0.3],
          ['Proposes actions, not just analysis', 0.25],
        ],
      },
      {
        topic: 'SEO & content',
        difficulty: 'medium',
        prompt:
          'How do you decide which keywords are worth creating content for? Walk me through your process.',
        rubric: [
          ['Balances intent, volume, difficulty, and business value', 0.45],
          ['Has a real research workflow', 0.3],
          ['Measures content performance after publishing', 0.25],
        ],
      },
      {
        topic: 'SEO & content',
        difficulty: 'easy',
        prompt:
          'What makes a piece of content actually useful for lead generation rather than just pageviews?',
        rubric: [
          ['Connects content to audience pain and funnel stage', 0.4],
          ['Understands conversion mechanics (CTA, capture, nurture)', 0.35],
          ['Cites examples from experience', 0.25],
        ],
      },
      {
        topic: 'Marketing analytics',
        difficulty: 'medium',
        prompt:
          "The founder asks 'which channel brings our best customers?' How do you answer that with imperfect attribution?",
        rubric: [
          ['Honest about attribution limits', 0.35],
          ['Triangulates multiple signals (LTV, self-reported, cohort)', 0.4],
          ['Turns the answer into a budget recommendation', 0.25],
        ],
      },
      {
        topic: 'Email & lifecycle',
        difficulty: 'medium',
        prompt:
          'Design a welcome email sequence for trial users of a SaaS product. What does each email try to achieve?',
        rubric: [
          ['Maps emails to activation milestones', 0.4],
          ['Balances education, value, and conversion asks', 0.35],
          ['Thinks about timing and segmentation', 0.25],
        ],
      },
      {
        topic: 'Brand & positioning',
        difficulty: 'hard',
        prompt:
          "Leadership says they want to 'go viral'. How do you respond, and what do you propose instead?",
        rubric: [
          ['Pushes back constructively with reasoning', 0.4],
          ['Proposes sustainable alternatives tied to goals', 0.35],
          ['Handles the stakeholder conversation diplomatically', 0.25],
        ],
      },
      {
        topic: 'Social media',
        difficulty: 'easy',
        prompt: 'What separates ad or social copy that converts from copy that just sounds clever?',
        rubric: [
          ['Focuses on audience benefit over cleverness', 0.4],
          ['Understands clarity, specificity, and a single CTA', 0.35],
          ['Tests and iterates rather than trusting taste', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Performance marketing',
        difficulty: 'easy',
        prompt: 'CTR (click-through rate) is calculated as…',
        options: [
          { text: 'Clicks divided by impressions', correct: true },
          { text: 'Conversions divided by clicks' },
          { text: 'Spend divided by conversions' },
          { text: 'Impressions divided by reach' },
        ],
      },
      {
        topic: 'Marketing analytics',
        difficulty: 'medium',
        prompt: 'CAC (customer acquisition cost) is calculated as…',
        options: [
          {
            text: 'Total sales and marketing spend divided by new customers acquired',
            correct: true,
          },
          { text: 'Ad spend divided by total impressions' },
          { text: 'Revenue divided by number of customers' },
          { text: 'Marketing salary cost divided by leads generated' },
        ],
      },
      {
        topic: 'Marketing analytics',
        difficulty: 'medium',
        prompt: "In GA4, an 'engaged session' is one that…",
        options: [
          {
            text: 'Lasted over 10 seconds, had a conversion, or had at least 2 pageviews',
            correct: true,
          },
          { text: 'Lasted at least 5 minutes' },
          { text: 'Included a purchase' },
          { text: 'Came from an organic channel' },
        ],
      },
      {
        topic: 'Marketing analytics',
        difficulty: 'hard',
        prompt: 'Why is last-click attribution often misleading for B2B marketing?',
        options: [
          {
            text: 'It credits only the final touch, ignoring the earlier touches that created the demand',
            correct: true,
          },
          { text: 'It double-counts every conversion' },
          { text: 'It only works for e-commerce transactions' },
          { text: 'It requires cookies that no longer exist' },
        ],
      },
      {
        topic: 'Email & lifecycle',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which practices protect email deliverability?',
        options: [
          { text: 'Regularly removing chronically unengaged contacts', correct: true },
          { text: 'Authenticating the sending domain (SPF/DKIM)', correct: true },
          { text: 'Buying a large list to increase reach quickly' },
          { text: 'Sending daily blasts to the entire database' },
        ],
      },
    ],
  },

  {
    family: 'product-management',
    topics: [
      'Discovery & research',
      'Prioritization',
      'Execution & delivery',
      'Metrics & analytics',
      'Stakeholder management',
      'Strategy',
    ],
    skills: [
      'User research',
      'Roadmap prioritization (RICE/MoSCoW)',
      'Writing PRDs',
      'Metrics and north-star thinking',
      'A/B testing',
      'Stakeholder management',
      'SQL for product analytics',
      'Go-to-market coordination',
    ],
    technical: [
      {
        topic: 'Discovery & research',
        difficulty: 'medium',
        prompt:
          'Users are asking for ten different things. How do you figure out what to build next? Walk me through your actual process.',
        rubric: [
          ['Separates underlying problems from requested solutions', 0.4],
          ['Combines qualitative and quantitative evidence', 0.35],
          ['Has a repeatable discovery habit', 0.25],
        ],
      },
      {
        topic: 'Prioritization',
        difficulty: 'hard',
        prompt:
          "Engineering can ship only 3 of the 8 roadmap items this quarter. How do you choose — and how do you tell the teams whose items didn't make it?",
        rubric: [
          ['Applies a transparent prioritization framework', 0.4],
          ['Handles the communication with honesty and empathy', 0.35],
          ['Revisits decisions with new information', 0.25],
        ],
      },
      {
        topic: 'Execution & delivery',
        difficulty: 'medium',
        prompt:
          'What belongs in a PRD and what does not? Walk me through one you wrote that worked well.',
        rubric: [
          ['Problem-first structure with success metrics', 0.4],
          ['Clear scope, including explicit non-goals', 0.35],
          ['Shows how the document drove alignment', 0.25],
        ],
      },
      {
        topic: 'Metrics & analytics',
        difficulty: 'medium',
        prompt:
          'Pick a product you know well. What would you choose as its north-star metric, and which guardrail metrics would you watch?',
        rubric: [
          ['Chooses a metric tied to real user value', 0.4],
          ['Understands input vs output metrics', 0.3],
          ['Thinks about gaming and side effects', 0.3],
        ],
      },
      {
        topic: 'Execution & delivery',
        difficulty: 'hard',
        prompt:
          'Two weeks before launch you discover a core flow is fundamentally broken. What do you do?',
        rubric: [
          ['Assesses impact and options before reacting', 0.35],
          ['Communicates early with stakeholders', 0.35],
          ['Makes a defensible call (cut, delay, or fix) with trade-offs', 0.3],
        ],
      },
      {
        topic: 'Stakeholder management',
        difficulty: 'medium',
        prompt:
          'Sales has promised a major customer a feature that is not on the roadmap. How do you handle it?',
        rubric: [
          ['Addresses the commitment without throwing anyone under the bus', 0.35],
          ['Evaluates the request on evidence, not volume', 0.35],
          ['Fixes the underlying process gap', 0.3],
        ],
      },
      {
        topic: 'Metrics & analytics',
        difficulty: 'hard',
        prompt:
          'An A/B test shows variant B lifts signups by 5% but doubles support tickets. Ship it or not — walk me through your reasoning.',
        rubric: [
          ['Weighs the trade-off with guardrail metrics', 0.4],
          ['Investigates why tickets doubled before deciding', 0.35],
          ['Considers long-term vs short-term effects', 0.25],
        ],
      },
      {
        topic: 'Discovery & research',
        difficulty: 'easy',
        prompt: 'How do you get honest feedback from users instead of polite answers?',
        rubric: [
          ['Asks about past behavior, not future intentions', 0.4],
          ['Avoids leading questions', 0.3],
          ['Creates conditions where criticism is safe', 0.3],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Prioritization',
        difficulty: 'easy',
        prompt: "In the RICE prioritization framework, what does the 'E' stand for?",
        options: [
          { text: 'Effort', correct: true },
          { text: 'Engagement' },
          { text: 'Estimate' },
          { text: 'Efficiency' },
        ],
      },
      {
        topic: 'Strategy',
        difficulty: 'medium',
        prompt: 'The primary purpose of an MVP is to…',
        options: [
          { text: 'Test whether the core assumption holds, with the minimum build', correct: true },
          { text: 'Launch a stripped-down product to beat competitors to market' },
          { text: 'Demo the vision to investors' },
          { text: 'Give engineering a low-pressure first release' },
        ],
      },
      {
        topic: 'Metrics & analytics',
        difficulty: 'medium',
        prompt: 'Which is the best north-star metric for a video-conferencing product?',
        options: [
          { text: 'Weekly meetings hosted per active team', correct: true },
          { text: 'Total registered accounts' },
          { text: 'App downloads' },
          { text: 'Website pageviews' },
        ],
      },
      {
        topic: 'Execution & delivery',
        difficulty: 'hard',
        prompt: 'You shipped a feature and adoption is 2%. The most useful next step is to…',
        options: [
          {
            text: 'Understand the context of the non-adopting users before iterating or killing it',
            correct: true,
          },
          { text: 'Immediately roll back the feature' },
          { text: 'Send more notification emails about it' },
          { text: 'Wait six months for adoption to grow on its own' },
        ],
      },
      {
        topic: 'Execution & delivery',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which sections belong in a solid PRD?',
        options: [
          { text: 'Problem statement and success metrics', correct: true },
          { text: 'Scope, including explicitly out-of-scope items', correct: true },
          { text: 'The exact database schema engineering must use' },
          { text: 'A launch date already promised to sales' },
        ],
      },
    ],
  },

  {
    family: 'campus-fresher-general',
    topics: [
      'Academics & projects',
      'Programming basics',
      'Problem solving',
      'Communication',
      'Career readiness',
      'Teamwork',
    ],
    skills: [
      'your primary programming language',
      'data structures',
      'SQL',
      'Git',
      'public speaking and presentations',
      'working effectively in a team',
      'writing clear documentation',
      'logical aptitude',
    ],
    technical: [
      {
        topic: 'Academics & projects',
        difficulty: 'medium',
        prompt:
          'Walk me through your final-year or most significant project — the problem, your exact role, and what you would do differently now.',
        rubric: [
          ['Explains the problem and their own contribution clearly', 0.4],
          ['Demonstrates real technical involvement, not just supervision', 0.35],
          ['Reflects honestly on lessons learned', 0.25],
        ],
      },
      {
        topic: 'Programming basics',
        difficulty: 'easy',
        prompt:
          'Explain the difference between an array and a linked list, and when you would use each.',
        rubric: [
          ['Explains both structures accurately', 0.5],
          ['Gives sensible use cases with reasoning', 0.3],
          ['Clear and confident communication', 0.2],
        ],
      },
      {
        topic: 'Programming basics',
        difficulty: 'medium',
        prompt: 'How does a hash map give near-instant lookups? And what can go wrong?',
        rubric: [
          ['Explains hashing and buckets correctly', 0.5],
          ['Mentions collisions and load factors', 0.3],
          ['Uses an intuitive example', 0.2],
        ],
      },
      {
        topic: 'Programming basics',
        difficulty: 'easy',
        prompt:
          'Given a students table and a marks table, how would you find the top 3 students per subject? Talk me through your approach.',
        rubric: [
          ['Thinks in terms of joins and ordering', 0.45],
          ['Reasons out loud in a structured way', 0.35],
          ['Handles ties or edge cases thoughtfully', 0.2],
        ],
      },
      {
        topic: 'Programming basics',
        difficulty: 'easy',
        prompt:
          'You committed your work to the wrong branch. How do you fix it? Explain your thinking, not just the commands.',
        rubric: [
          ['Stays calm and reasons about the state first', 0.4],
          ['Knows basic recovery approaches', 0.35],
          ['Understands why the mistake happened and avoids repeats', 0.25],
        ],
      },
      {
        topic: 'Career readiness',
        difficulty: 'medium',
        prompt:
          'Tell me about something technical you taught yourself outside of coursework. How did you go about learning it?',
        rubric: [
          ['Shows genuine curiosity and self-direction', 0.4],
          ['Has an effective learning method', 0.35],
          ['Applied the learning to something real', 0.25],
        ],
      },
      {
        topic: 'Academics & projects',
        difficulty: 'medium',
        prompt:
          'What did you actually do during your internship — not the project description, but your day-to-day contribution?',
        rubric: [
          ['Specific and honest about their own work', 0.45],
          ['Understands how their work fit the bigger picture', 0.3],
          ['Shows what they learned professionally', 0.25],
        ],
      },
      {
        topic: 'Problem solving',
        difficulty: 'hard',
        prompt:
          'Estimate how many pizzas are delivered in your city every day. Talk me through your reasoning out loud.',
        rubric: [
          ['Structures the estimate into clear assumptions', 0.45],
          ['Sanity-checks numbers along the way', 0.3],
          ['Stays comfortable with ambiguity', 0.25],
        ],
      },
    ],
    mcqs: [
      {
        topic: 'Programming basics',
        difficulty: 'easy',
        prompt: 'Which data structure works on a First-In-First-Out (FIFO) basis?',
        options: [
          { text: 'Queue', correct: true },
          { text: 'Stack' },
          { text: 'Tree' },
          { text: 'Graph' },
        ],
      },
      {
        topic: 'Programming basics',
        difficulty: 'easy',
        prompt: "What does SQL's WHERE clause do?",
        options: [
          { text: 'Filters rows before any grouping or aggregation', correct: true },
          { text: 'Sorts the result set' },
          { text: 'Filters groups after aggregation' },
          { text: 'Joins two tables together' },
        ],
      },
      {
        topic: 'Problem solving',
        difficulty: 'medium',
        prompt: 'What is the time complexity of binary search on a sorted array of n elements?',
        options: [
          { text: 'O(log n)', correct: true },
          { text: 'O(n)' },
          { text: 'O(n log n)' },
          { text: 'O(1)' },
        ],
      },
      {
        topic: 'Programming basics',
        difficulty: 'medium',
        prompt: 'In Git, what does git clone do?',
        options: [
          {
            text: 'Creates a local copy of a remote repository, including its history',
            correct: true,
          },
          { text: 'Creates a new empty repository' },
          { text: 'Copies one branch onto another' },
          { text: 'Uploads local commits to the remote' },
        ],
      },
      {
        topic: 'Teamwork',
        difficulty: 'medium',
        multi: true,
        prompt: 'Which behaviors make a good impression in your first weeks at a new job?',
        options: [
          { text: 'Asking questions after being stuck for a reasonable while', correct: true },
          { text: 'Writing down what you learn so you do not ask twice', correct: true },
          { text: 'Pretending to understand everything so you look smart' },
          { text: 'Waiting silently for work to be assigned to you' },
        ],
      },
    ],
  },
];

module.exports = { behavioral, situational, screening, judgementMcqs, families };
