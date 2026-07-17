import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { KitQuestion, PreviewResponse } from '@zios/shared-types';
import { Badge, Button, Icon } from '@zios/ui';
import { kitsApi } from '../../lib/kits-api';
import { ApiRequestError } from '../../lib/api';
import { userMessageForError } from '../../lib/errors';
import { QUESTION_TYPE_LABELS, formatSeconds } from '../../lib/kit-utils';

/**
 * /kits/:id/preview — preview-as-candidate (FR-E2-6). Mints a preview token
 * and renders the read-only draft projection as a candidate would see it:
 * intro → one question at a time (all four §6.2 types in the kit mode's
 * capture shell; fixed follow-ups simulated client-side) → outro. The only
 * network calls are the two GETs below — no session rows, no recordings.
 */

type Stage =
  | { kind: 'intro' }
  | { kind: 'question'; index: number; followupIndex: number | null }
  | { kind: 'outro' };

const MODE_META = {
  text: { icon: 'chat', label: 'Text interview' },
  voice: { icon: 'mic', label: 'Voice interview' },
  video: { icon: 'videocam', label: 'Video interview' },
} as const;

export function KitPreviewPage() {
  const { kitId = '' } = useParams();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<{ message: string; expired: boolean }>();
  const [stage, setStage] = useState<Stage>({ kind: 'intro' });
  // Local-only answers — deliberately never sent anywhere (read-only preview).
  const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({});

  useEffect(() => {
    let cancelled = false;
    kitsApi
      .createPreviewToken(kitId)
      .then(({ token }) => kitsApi.getPreview(token))
      .then((response) => {
        if (!cancelled) setPreview(response);
      })
      .catch((err) => {
        if (cancelled) return;
        const expired = err instanceof ApiRequestError && err.code === 'PREVIEW_TOKEN_EXPIRED';
        setError({ message: userMessageForError(err), expired });
      });
    return () => {
      cancelled = true;
    };
  }, [kitId]);

  const questions = useMemo(() => preview?.questions ?? [], [preview]);

  if (error) {
    return (
      <PreviewFrame>
        <div className="flex flex-col items-center text-center gap-4 py-24">
          <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
            <Icon name={error.expired ? 'schedule' : 'error'} className="text-3xl text-error" />
          </div>
          <h1 className="font-headline-md text-headline-md text-primary">
            {error.expired ? 'This preview link has expired' : 'Preview unavailable'}
          </h1>
          <p className="text-on-surface-variant max-w-md">{error.message}</p>
          <Link to={`/kits/${kitId}`}>
            <Button icon="arrow_back">Back to the builder</Button>
          </Link>
        </div>
      </PreviewFrame>
    );
  }

  if (!preview) {
    return (
      <PreviewFrame>
        <div className="animate-pulse py-24 max-w-2xl mx-auto" aria-label="Loading preview">
          <div className="h-10 w-2/3 bg-surface-container rounded mb-4" />
          <div className="h-5 w-1/3 bg-surface-container rounded mb-10" />
          <div className="h-40 bg-surface-container rounded-2xl" />
        </div>
      </PreviewFrame>
    );
  }

  const mode = preview.kit.settings.mode;
  const modeMeta = MODE_META[mode];

  function answerKey(questionId: string, followupIndex: number | null): string {
    return followupIndex === null ? questionId : `${questionId}:fu:${followupIndex}`;
  }

  function currentQuestion(): KitQuestion | null {
    return stage.kind === 'question' ? (questions[stage.index] ?? null) : null;
  }

  function advance() {
    if (stage.kind !== 'question') return;
    const question = questions[stage.index];
    if (!question) return;
    // Fixed follow-ups run as extra steps right after the main answer.
    if (question.followupPolicy === 'fixed' && (question.followupFixed?.length ?? 0) > 0) {
      const nextFollowup = stage.followupIndex === null ? 0 : stage.followupIndex + 1;
      if (nextFollowup < question.followupFixed!.length) {
        setStage({ kind: 'question', index: stage.index, followupIndex: nextFollowup });
        return;
      }
    }
    if (stage.index + 1 < questions.length) {
      setStage({ kind: 'question', index: stage.index + 1, followupIndex: null });
    } else {
      setStage({ kind: 'outro' });
    }
  }

  const question = currentQuestion();
  const key = question
    ? answerKey(question.id, stage.kind === 'question' ? stage.followupIndex : null)
    : '';

  return (
    <PreviewFrame>
      {/* Intro ---------------------------------------------------------- */}
      {stage.kind === 'intro' && (
        <div className="max-w-2xl mx-auto text-center py-16">
          {preview.kit.settings.logoUrl && (
            <img
              src={preview.kit.settings.logoUrl}
              alt="Employer logo"
              className="h-12 mx-auto mb-6 object-contain"
            />
          )}
          <Badge tone="primary" icon={modeMeta.icon}>
            {modeMeta.label}
          </Badge>
          <h1 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary mt-4">
            {preview.kit.title}
          </h1>
          {(preview.kit.role || preview.kit.level) && (
            <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
              {[preview.kit.role, preview.kit.level].filter(Boolean).join(' · ')}
            </p>
          )}
          {preview.kit.settings.introText && (
            <p className="text-body-md text-on-surface mt-6 whitespace-pre-line">
              {preview.kit.settings.introText}
            </p>
          )}
          <div className="mt-8 flex items-center justify-center gap-4 text-sm text-on-surface-variant">
            <span className="inline-flex items-center gap-1">
              <Icon name="quiz" className="text-base" /> {questions.length} questions
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Icon name="schedule" className="text-base" /> about{' '}
              {formatSeconds(preview.durationEstimateSec)}
            </span>
          </div>
          <Button
            size="lg"
            className="mt-10"
            icon="arrow_forward"
            onClick={() =>
              questions.length > 0
                ? setStage({ kind: 'question', index: 0, followupIndex: null })
                : setStage({ kind: 'outro' })
            }
          >
            Start preview
          </Button>
        </div>
      )}

      {/* Question step --------------------------------------------------- */}
      {stage.kind === 'question' && question && (
        <div className="max-w-3xl mx-auto py-10">
          {/* Progress */}
          <div className="mb-8">
            <div className="flex items-center justify-between text-xs text-on-surface-variant mb-2">
              <span>
                Question {stage.index + 1} of {questions.length}
                {stage.followupIndex !== null && ` · follow-up ${stage.followupIndex + 1}`}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone="neutral">{question.topic}</Badge>
                {question.timeLimitSec !== null && (
                  <Badge
                    tone={question.timeLimitType === 'hard' ? 'error' : 'neutral'}
                    icon="schedule"
                  >
                    {formatSeconds(question.timeLimitSec)} {question.timeLimitType}
                  </Badge>
                )}
              </span>
            </div>
            <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-container rounded-full transition-all"
                style={{ width: `${((stage.index + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          <p className="text-xs font-label-bold uppercase tracking-wider text-on-surface-variant mb-2">
            {stage.followupIndex === null
              ? QUESTION_TYPE_LABELS[question.type]
              : 'Follow-up question'}
          </p>
          <h2 className="font-headline-sm text-headline-sm text-primary mb-8">
            {stage.followupIndex === null
              ? question.prompt
              : question.followupFixed?.[stage.followupIndex]}
          </h2>

          <AnswerSurface
            question={question}
            mode={mode}
            value={answers[key]}
            onChange={(value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
          />

          {stage.followupIndex === null && question.followupPolicy === 'adaptive_ai' && (
            <p className="mt-4 text-xs text-on-surface-variant inline-flex items-center gap-1.5 bg-surface-container-low rounded-full px-3 py-1.5">
              <Icon name="auto_awesome" className="text-sm" />
              In a real interview, AI follow-ups may probe this answer (depth ≤{' '}
              {question.followupDepthCap ?? 2}). Skipped in preview.
            </p>
          )}
          {stage.followupIndex === null &&
            question.followupPolicy === 'fixed' &&
            (question.followupFixed?.length ?? 0) > 0 && (
              <p className="mt-4 text-xs text-on-surface-variant inline-flex items-center gap-1.5 bg-surface-container-low rounded-full px-3 py-1.5">
                <Icon name="playlist_add" className="text-sm" />
                {question.followupFixed!.length} fixed follow-up
                {question.followupFixed!.length > 1 ? 's' : ''} will follow your answer.
              </p>
            )}

          <div className="mt-10 flex justify-end">
            <Button size="lg" icon="arrow_forward" onClick={advance}>
              {stage.index + 1 === questions.length &&
              (stage.followupIndex !== null || (question.followupFixed?.length ?? 0) === 0)
                ? 'Finish preview'
                : 'Continue'}
            </Button>
          </div>
        </div>
      )}

      {/* Outro ------------------------------------------------------------ */}
      {stage.kind === 'outro' && (
        <div className="max-w-2xl mx-auto text-center py-16">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-6">
            <Icon name="check_circle" className="text-3xl text-success" filled />
          </div>
          <h1 className="font-headline-md text-headline-md text-primary">Interview complete</h1>
          {preview.kit.settings.outroText && (
            <p className="text-body-md text-on-surface mt-4 whitespace-pre-line">
              {preview.kit.settings.outroText}
            </p>
          )}
          <p className="text-sm text-on-surface-variant mt-6">
            This was a preview — nothing was recorded or scored.
          </p>
          <Link to={`/kits/${kitId}`}>
            <Button className="mt-8" icon="arrow_back">
              Back to the builder
            </Button>
          </Link>
        </div>
      )}
    </PreviewFrame>
  );
}

/** Full-width takeover frame with the persistent read-only banner. */
function PreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background font-sans flex flex-col">
      <div
        role="status"
        className="sticky top-0 z-50 bg-secondary text-on-secondary px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-label-bold shadow-md"
      >
        <Icon name="visibility" className="text-base" />
        Preview — no data recorded
      </div>
      <main className="flex-1 px-4 sm:px-8 pb-16">{children}</main>
    </div>
  );
}

/** Per-type answer renderer inside the kit mode's capture shell. */
function AnswerSurface({
  question,
  mode,
  value,
  onChange,
}: {
  question: KitQuestion;
  mode: 'text' | 'voice' | 'video';
  value: string | string[] | number | undefined;
  onChange: (value: string | string[] | number) => void;
}) {
  if (question.type === 'mcq_single') {
    const selected = typeof value === 'string' ? value : '';
    return (
      <div className="space-y-3" role="radiogroup" aria-label="Answer options">
        {(question.options ?? []).map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected === option.id}
            onClick={() => onChange(option.id)}
            className={`w-full text-left px-5 py-4 rounded-2xl border transition-colors flex items-center gap-3 ${
              selected === option.id
                ? 'border-primary bg-primary/5'
                : 'border-outline-variant bg-white hover:border-primary/40'
            }`}
          >
            <Icon
              name={selected === option.id ? 'radio_button_checked' : 'radio_button_unchecked'}
              className="text-primary"
            />
            <span className="text-sm text-on-surface">{option.text}</span>
          </button>
        ))}
      </div>
    );
  }

  if (question.type === 'mcq_multi') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-3" role="group" aria-label="Answer options">
        {(question.options ?? []).map((option) => {
          const checked = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() =>
                onChange(
                  checked ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                )
              }
              className={`w-full text-left px-5 py-4 rounded-2xl border transition-colors flex items-center gap-3 ${
                checked
                  ? 'border-primary bg-primary/5'
                  : 'border-outline-variant bg-white hover:border-primary/40'
              }`}
            >
              <Icon
                name={checked ? 'check_box' : 'check_box_outline_blank'}
                className="text-primary"
              />
              <span className="text-sm text-on-surface">{option.text}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === 'rating_scale') {
    const rating = typeof value === 'number' ? value : 0;
    return (
      <div>
        <div
          className="flex gap-3 justify-center"
          role="radiogroup"
          aria-label="Rating from 1 to 5"
        >
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={rating === score}
              aria-label={`Rate ${score} out of 5`}
              onClick={() => onChange(score)}
              className={`w-14 h-14 rounded-2xl border text-lg font-label-bold transition-all ${
                rating === score
                  ? 'bg-primary text-on-primary border-primary shadow-md scale-105'
                  : 'bg-white border-outline-variant text-on-surface hover:border-primary/50'
              }`}
            >
              {score}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-on-surface-variant mt-2 max-w-xs mx-auto">
          <span>Strongly disagree</span>
          <span>Strongly agree</span>
        </div>
      </div>
    );
  }

  // open_ended — the capture surface depends on the kit's interview mode.
  if (mode === 'text') {
    return (
      <textarea
        aria-label="Your answer"
        rows={6}
        placeholder="Type your answer here…"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-5 py-4 bg-white border border-outline-variant rounded-2xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-base text-on-surface resize-y"
      />
    );
  }

  // voice / video: mock capture UI — no real media is captured in preview.
  return <MockCapture mode={mode} />;
}

function MockCapture({ mode }: { mode: 'voice' | 'video' }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  return (
    <div className="bg-white border border-outline-variant rounded-2xl p-8 flex flex-col items-center text-center gap-4">
      {mode === 'video' && (
        <div className="w-full max-w-md aspect-video bg-primary rounded-xl flex items-center justify-center">
          <Icon
            name={recording ? 'videocam' : 'videocam_off'}
            className="text-4xl text-surface-container"
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setRecording((r) => !r);
          if (!recording) setSeconds(0);
        }}
        aria-pressed={recording}
        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-md ${
          recording
            ? 'bg-error text-on-error scale-105'
            : 'bg-primary text-on-primary hover:bg-primary-container'
        }`}
      >
        <Icon name={recording ? 'stop' : 'mic'} className="text-2xl" filled={recording} />
      </button>
      <p className="text-sm text-on-surface-variant">
        {recording
          ? `Recording… ${formatSeconds(seconds)} (simulated)`
          : `Tap to ${mode === 'voice' ? 'record your answer' : 'start your camera'} (simulated)`}
      </p>
      <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-full px-3 py-1.5">
        Preview uses a mock {mode === 'voice' ? 'microphone' : 'camera'} — no media is captured.
      </p>
    </div>
  );
}
