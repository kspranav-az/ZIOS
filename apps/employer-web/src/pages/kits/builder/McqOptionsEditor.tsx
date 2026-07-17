import type { McqOption, QuestionType } from '@zios/shared-types';
import { Icon } from '@zios/ui';
import { uid } from '../../../lib/kit-utils';

/** MCQ options editor: add/remove options, correct flags (FR-E2-2, §6.2). */

interface McqOptionsEditorProps {
  type: Extract<QuestionType, 'mcq_single' | 'mcq_multi'>;
  options: McqOption[];
  disabled: boolean;
  onChange: (options: McqOption[]) => void;
}

export function McqOptionsEditor({ type, options, disabled, onChange }: McqOptionsEditorProps) {
  const single = type === 'mcq_single';

  function updateOption(id: string, patch: Partial<McqOption>) {
    onChange(options.map((option) => (option.id === id ? { ...option, ...patch } : option)));
  }

  function toggleCorrect(id: string) {
    if (single) {
      // Radio behavior: exactly one correct option at a time.
      onChange(options.map((option) => ({ ...option, correct: option.id === id })));
    } else {
      onChange(
        options.map((option) =>
          option.id === id ? { ...option, correct: option.correct !== true } : option,
        ),
      );
    }
  }

  function addOption() {
    onChange([...options, { id: uid(), text: '' }]);
  }

  function removeOption(id: string) {
    onChange(options.filter((option) => option.id !== id));
  }

  return (
    <div>
      <p className="text-xs font-label-bold text-primary uppercase tracking-wide mb-2">
        Options{' '}
        <span className="text-on-surface-variant normal-case font-body-md">
          ({single ? 'mark the one correct answer' : 'mark every correct answer'})
        </span>
      </p>
      <div className="space-y-2">
        {options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            <button
              type="button"
              role={single ? 'radio' : 'checkbox'}
              aria-checked={option.correct === true}
              aria-label={`Option ${index + 1} correct`}
              title={option.correct === true ? 'Correct answer' : 'Mark as correct'}
              disabled={disabled}
              onClick={() => toggleCorrect(option.id)}
              className={`shrink-0 w-6 h-6 ${single ? 'rounded-full' : 'rounded-md'} border flex items-center justify-center transition-colors ${
                option.correct === true
                  ? 'bg-success border-success text-white'
                  : 'border-outline-variant bg-white hover:border-success/60'
              }`}
            >
              {option.correct === true && <Icon name="check" className="text-sm" />}
            </button>
            <input
              aria-label={`Option ${index + 1} text`}
              placeholder={`Option ${index + 1}`}
              value={option.text}
              disabled={disabled}
              onChange={(event) => updateOption(option.id, { text: event.target.value })}
              className="flex-1 px-3 py-2 bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface"
            />
            <button
              type="button"
              aria-label={`Remove option ${index + 1}`}
              disabled={disabled || options.length <= 2}
              onClick={() => removeOption(option.id)}
              className="shrink-0 p-1.5 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40 disabled:hover:text-on-surface-variant"
            >
              <Icon name="close" className="text-lg" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={addOption}
        className="mt-2 inline-flex items-center gap-1 text-xs font-label-bold text-primary hover:underline disabled:opacity-50"
      >
        <Icon name="add" className="text-sm" /> Add option
      </button>
    </div>
  );
}
