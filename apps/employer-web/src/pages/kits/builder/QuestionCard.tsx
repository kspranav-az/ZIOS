import { useState, type HTMLAttributes, type Ref } from 'react';
import type { KitQuestion, QuestionType, UpdateQuestionBody } from '@zios/shared-types';
import { Badge, Icon } from '@zios/ui';
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  SOURCE_LABELS,
  isMcq,
  rubricWeightsValid,
  uid,
  validateQuestionDraft,
} from '../../../lib/kit-utils';
import { FieldLabel, SelectField, Toggle } from './fields';
import { McqOptionsEditor } from './McqOptionsEditor';
import { FollowupEditor } from './FollowupEditor';
import { RubricEditor } from './RubricEditor';

/** Inline question editor card within the builder's ordered list (FR-E2-1…E2-4). */

export interface QuestionCardProps {
  question: KitQuestion;
  index: number;
  topics: string[];
  disabled: boolean;
  saving: boolean;
  hasPublishError: boolean;
  defaultExpanded: boolean;
  /** dnd-kit sortable bindings for the card wrapper. */
  wrapperRef?: Ref<HTMLDivElement>;
  wrapperStyle?: React.CSSProperties;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  onPatch: (questionId: string, patch: UpdateQuestionBody) => void;
  onDelete: (questionId: string) => void;
}

const TYPE_OPTIONS = (Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((value) => ({
  value,
  label: QUESTION_TYPE_LABELS[value],
}));

const DIFFICULTY_OPTIONS = (
  Object.keys(DIFFICULTY_LABELS) as Array<keyof typeof DIFFICULTY_LABELS>
).map((value) => ({ value, label: DIFFICULTY_LABELS[value] }));

export function QuestionCard({
  question,
  index,
  topics,
  disabled,
  saving,
  hasPublishError,
  defaultExpanded,
  wrapperRef,
  wrapperStyle,
  dragHandleProps,
  onPatch,
  onDelete,
}: QuestionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const errors = validateQuestionDraft(question);
  const publishBlocking =
    question.rubricLines.length === 0 || !rubricWeightsValid(question.rubricLines);

  function changeType(next: QuestionType) {
    const patch: UpdateQuestionBody = { type: next };
    if (isMcq(next)) {
      // Seed valid defaults — the api validates option text on every write.
      patch.options =
        question.options && question.options.length >= 2
          ? question.options
          : [
              { id: uid(), text: 'Option 1' },
              { id: uid(), text: 'Option 2' },
            ];
      // adaptive_ai is open-ended-only (§6.2) — drop it on the switch.
      if (question.followupPolicy === 'adaptive_ai') {
        patch.followupPolicy = 'none';
        patch.followupDepthCap = null;
      }
    } else {
      patch.options = null;
    }
    onPatch(question.id, patch);
  }

  const sourceTone = question.source === 'bank' ? 'primary' : 'neutral';

  return (
    <div
      ref={wrapperRef}
      style={wrapperStyle}
      id={`question-${index + 1}`}
      data-question-id={question.id}
      className={`bg-surface-container-lowest shadow-card border rounded-2xl transition-colors ${
        hasPublishError ? 'border-error/60' : 'border-surface-variant/50'
      }`}
    >
      {/* Card header — always visible */}
      <div className="flex items-center gap-2 px-4 py-3">
        {!disabled && (
          <button
            type="button"
            aria-label={`Drag question ${index + 1} to reorder`}
            {...dragHandleProps}
            className="cursor-grab active:cursor-grabbing p-1 text-outline hover:text-primary transition-colors touch-none"
          >
            <Icon name="drag_indicator" className="text-xl" />
          </button>
        )}
        <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-label-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex-1 min-w-0 text-left flex items-center gap-2 group"
        >
          <span className="truncate text-sm font-label-bold text-on-surface group-hover:text-primary transition-colors">
            {question.prompt.trim() || 'Untitled question'}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {saving && (
            <span
              className="text-xs text-on-surface-variant inline-flex items-center gap-1"
              role="status"
            >
              <Icon name="sync" className="text-sm animate-spin" /> Saving
            </span>
          )}
          <Badge tone={sourceTone} icon={question.source === 'bank' ? 'menu_book' : undefined}>
            {SOURCE_LABELS[question.source]}
          </Badge>
          <span className="hidden sm:inline text-xs text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full whitespace-nowrap">
            {QUESTION_TYPE_LABELS[question.type]}
          </span>
          {(errors.length > 0 || publishBlocking) && (
            <span
              title="Needs attention before publishing"
              className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center"
            >
              <Icon name="warning" className="text-xs" />
            </span>
          )}
          {!disabled &&
            (confirmingDelete ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onDelete(question.id)}
                  className="text-xs font-label-bold text-error hover:underline"
                >
                  Delete?
                </button>
                <button
                  type="button"
                  aria-label="Cancel delete"
                  onClick={() => setConfirmingDelete(false)}
                  className="p-1 text-on-surface-variant hover:text-primary"
                >
                  <Icon name="close" className="text-base" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Delete question ${index + 1}`}
                onClick={() => setConfirmingDelete(true)}
                className="p-1 text-on-surface-variant hover:text-error transition-colors"
              >
                <Icon name="delete" className="text-lg" />
              </button>
            ))}
          <button
            type="button"
            aria-label={
              expanded ? `Collapse question ${index + 1}` : `Expand question ${index + 1}`
            }
            onClick={() => setExpanded((open) => !open)}
            className="p-1 text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name={expanded ? 'expand_less' : 'expand_more'} className="text-xl" />
          </button>
        </div>
      </div>

      {/* Editor body */}
      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-surface-variant/50 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
            <SelectField
              label="Question type"
              value={question.type}
              disabled={disabled}
              onChange={(event) => changeType(event.target.value as QuestionType)}
              options={TYPE_OPTIONS}
            />
            <SelectField
              label="Difficulty"
              value={question.difficulty}
              disabled={disabled}
              onChange={(event) =>
                onPatch(question.id, {
                  difficulty: event.target.value as KitQuestion['difficulty'],
                })
              }
              options={DIFFICULTY_OPTIONS}
            />
          </div>

          <div>
            <FieldLabel htmlFor={`prompt-${question.id}`}>Prompt</FieldLabel>
            <textarea
              id={`prompt-${question.id}`}
              rows={2}
              value={question.prompt}
              disabled={disabled}
              onChange={(event) => onPatch(question.id, { prompt: event.target.value })}
              className="w-full px-4 py-2.5 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface resize-y"
            />
          </div>

          {isMcq(question.type) && question.options && (
            <McqOptionsEditor
              type={question.type}
              options={question.options}
              disabled={disabled}
              onChange={(options) => onPatch(question.id, { options })}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel htmlFor={`topic-${question.id}`}>Topic</FieldLabel>
              <input
                id={`topic-${question.id}`}
                list={`topics-${question.id}`}
                value={question.topic}
                disabled={disabled}
                placeholder="e.g. System design"
                onChange={(event) => onPatch(question.id, { topic: event.target.value })}
                className="w-full px-4 py-2.5 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface"
              />
              <datalist id={`topics-${question.id}`}>
                {topics.map((topic) => (
                  <option key={topic} value={topic} />
                ))}
              </datalist>
            </div>
            <div>
              <FieldLabel htmlFor={`limit-${question.id}`}>Time limit (sec)</FieldLabel>
              <input
                id={`limit-${question.id}`}
                type="number"
                min={1}
                step={1}
                placeholder="120 (default)"
                value={question.timeLimitSec ?? ''}
                disabled={disabled}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw === '') {
                    onPatch(question.id, { timeLimitSec: null });
                    return;
                  }
                  const seconds = Number.parseInt(raw, 10);
                  onPatch(question.id, {
                    timeLimitSec: Number.isInteger(seconds) ? seconds : null,
                  });
                }}
                className="w-full px-4 py-2.5 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface"
              />
            </div>
            <div>
              <FieldLabel>Limit type</FieldLabel>
              <div
                className="grid grid-cols-2 gap-1 bg-surface-container-low rounded-xl p-1"
                role="radiogroup"
                aria-label="Time limit type"
              >
                {(['soft', 'hard'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={question.timeLimitType === value}
                    disabled={disabled}
                    onClick={() => onPatch(question.id, { timeLimitType: value })}
                    className={`py-2 rounded-lg text-xs font-label-bold capitalize transition-colors ${
                      question.timeLimitType === value
                        ? 'bg-white text-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Toggle
              label="Mandatory — candidates must answer"
              checked={question.mandatory}
              onChange={(mandatory) => onPatch(question.id, { mandatory })}
            />
          </div>

          <FollowupEditor
            type={question.type}
            policy={question.followupPolicy}
            followupFixed={question.followupFixed}
            followupDepthCap={question.followupDepthCap}
            disabled={disabled}
            onChange={(patch) => onPatch(question.id, patch)}
          />

          <RubricEditor
            lines={question.rubricLines}
            disabled={disabled}
            onChange={(rubricLines) => onPatch(question.id, { rubricLines })}
          />

          {errors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3" role="alert">
              <p className="text-xs font-label-bold text-amber-800 mb-1">Fix before publishing:</p>
              <ul className="text-xs text-amber-800 space-y-0.5 list-disc pl-4">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
