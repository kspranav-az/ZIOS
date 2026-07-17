import type { RubricLine } from '@zios/shared-types';
import { Icon } from '@zios/ui';
import {
  normalizeRubricWeights,
  rubricWeightSum,
  rubricWeightsValid,
  uid,
} from '../../../lib/kit-utils';

/**
 * Rubric lines editor (FR-E2-3): text + weight per line, live weight sum,
 * auto-normalize affordance. Line ids stay stable for evidence linking later.
 */

interface RubricEditorProps {
  lines: RubricLine[];
  disabled: boolean;
  onChange: (lines: RubricLine[]) => void;
}

export function RubricEditor({ lines, disabled, onChange }: RubricEditorProps) {
  const sum = rubricWeightSum(lines);
  const valid = rubricWeightsValid(lines);

  function updateLine(id: string, patch: Partial<RubricLine>) {
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onChange([...lines, { id: uid(), text: '', weight: 0.2 }]);
  }

  function removeLine(id: string) {
    onChange(lines.filter((line) => line.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-label-bold text-primary uppercase tracking-wide">
          Rubric{' '}
          <span className="text-on-surface-variant normal-case font-body-md">
            (what a strong answer covers)
          </span>
        </p>
        <span
          className={`text-xs font-label-bold px-2 py-0.5 rounded-full ${
            valid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}
          role="status"
        >
          Weights sum: {sum.toFixed(2)} {valid ? '✓' : '— must be 1.00'}
        </span>
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={line.id} className="flex items-center gap-2">
            <input
              aria-label={`Rubric line ${index + 1} text`}
              placeholder={`Criterion ${index + 1}, e.g. "Explains trade-offs clearly"`}
              value={line.text}
              disabled={disabled}
              onChange={(event) => updateLine(line.id, { text: event.target.value })}
              className="flex-1 px-3 py-2 bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface"
            />
            <input
              aria-label={`Rubric line ${index + 1} weight`}
              type="number"
              min={0.01}
              max={1}
              step={0.05}
              value={line.weight}
              disabled={disabled}
              onChange={(event) => {
                const weight = Number.parseFloat(event.target.value);
                updateLine(line.id, { weight: Number.isFinite(weight) ? weight : 0 });
              }}
              className="w-20 px-2 py-2 bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none transition-all text-sm text-on-surface text-center"
            />
            <button
              type="button"
              aria-label={`Remove rubric line ${index + 1}`}
              disabled={disabled || lines.length <= 1}
              onClick={() => removeLine(line.id)}
              className="shrink-0 p-1.5 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40 disabled:hover:text-on-surface-variant"
            >
              <Icon name="close" className="text-lg" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-4">
        <button
          type="button"
          disabled={disabled}
          onClick={addLine}
          className="inline-flex items-center gap-1 text-xs font-label-bold text-primary hover:underline disabled:opacity-50"
        >
          <Icon name="add" className="text-sm" /> Add criterion
        </button>
        {!valid && lines.length > 0 && sum > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(normalizeRubricWeights(lines))}
            className="inline-flex items-center gap-1 text-xs font-label-bold text-secondary hover:underline disabled:opacity-50"
          >
            <Icon name="balance" className="text-sm" /> Auto-normalize to 1.00
          </button>
        )}
      </div>
    </div>
  );
}
