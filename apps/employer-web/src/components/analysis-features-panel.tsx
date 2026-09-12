import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Icon } from '@zios/ui';
import { ApiRequestError } from '../lib/api';
import { getQuestionFeatures, type InterviewFeatures, type Measurement } from '../lib/analysis-api';

/**
 * Presentational panel for the Level-3 aggregate feature set of one answer.
 * Objective measurements only — no interpretive language anywhere in this
 * component (AGENTS.md §2).
 */

type FormatKind = 'ratio' | 'seconds' | 'hz' | 'wpm' | 'count' | 'degrees' | 'pixels' | 'number';

interface RowSpec {
  key: string;
  label: string;
  format: FormatKind;
}

interface GroupSpec {
  key: keyof Omit<
    InterviewFeatures,
    'schema_version' | 'session_id' | 'question_id' | 'media_kind'
  >;
  title: string;
  icon: string;
  rows: RowSpec[];
}

const GROUPS: GroupSpec[] = [
  {
    key: 'visual',
    title: 'Visual',
    icon: 'face',
    rows: [
      { key: 'face_visible_ratio', label: 'Face visible', format: 'ratio' },
      { key: 'camera_gaze_ratio', label: 'Camera gaze', format: 'ratio' },
      { key: 'looking_away_ratio', label: 'Looking away', format: 'ratio' },
      { key: 'gaze_deviation_mean', label: 'Gaze deviation (mean)', format: 'number' },
      { key: 'gaze_variability', label: 'Gaze variability', format: 'number' },
      { key: 'head_yaw_mean', label: 'Head yaw (mean)', format: 'degrees' },
      { key: 'head_yaw_std', label: 'Head yaw (std dev)', format: 'degrees' },
      { key: 'head_pitch_mean', label: 'Head pitch (mean)', format: 'degrees' },
      { key: 'head_pitch_std', label: 'Head pitch (std dev)', format: 'degrees' },
      { key: 'head_roll_mean', label: 'Head roll (mean)', format: 'degrees' },
      { key: 'head_roll_std', label: 'Head roll (std dev)', format: 'degrees' },
      { key: 'head_movement', label: 'Head movement', format: 'number' },
      { key: 'large_head_turn_count', label: 'Large head turns', format: 'count' },
      { key: 'facial_activity', label: 'Facial activity', format: 'number' },
      { key: 'mouth_movement', label: 'Mouth movement', format: 'number' },
      { key: 'eyebrow_movement', label: 'Eyebrow movement', format: 'number' },
      { key: 'facial_change_frequency', label: 'Facial change frequency', format: 'number' },
    ],
  },
  {
    key: 'body',
    title: 'Body',
    icon: 'accessibility_new',
    rows: [
      { key: 'posture_visibility', label: 'Posture visibility', format: 'ratio' },
      { key: 'upright_ratio', label: 'Upright posture', format: 'ratio' },
      { key: 'body_lean', label: 'Body lean', format: 'degrees' },
      { key: 'posture_stability', label: 'Posture stability', format: 'number' },
      { key: 'upper_body_movement', label: 'Upper-body movement', format: 'number' },
      { key: 'posture_valid', label: 'Posture measurable', format: 'ratio' },
    ],
  },
  {
    key: 'hands',
    title: 'Hands',
    icon: 'back_hand',
    rows: [
      { key: 'hands_visible_ratio', label: 'Hands visible', format: 'ratio' },
      { key: 'hand_movement', label: 'Hand movement', format: 'number' },
      { key: 'gesture_frequency', label: 'Gesture frequency', format: 'number' },
      { key: 'gesture_duration', label: 'Gesture duration (mean)', format: 'seconds' },
    ],
  },
  {
    key: 'speech',
    title: 'Speech',
    icon: 'record_voice_over',
    rows: [
      { key: 'speaking_time', label: 'Speaking time', format: 'seconds' },
      { key: 'silence_time', label: 'Silence time', format: 'seconds' },
      { key: 'pause_count', label: 'Pauses', format: 'count' },
      { key: 'pause_duration_mean', label: 'Pause duration (mean)', format: 'seconds' },
      { key: 'pause_duration_max', label: 'Pause duration (max)', format: 'seconds' },
      { key: 'wpm_mean', label: 'Speaking rate (mean)', format: 'wpm' },
      { key: 'wpm_median', label: 'Speaking rate (median)', format: 'wpm' },
      { key: 'wpm_std', label: 'Speaking rate (std dev)', format: 'wpm' },
      { key: 'fast_segment_count', label: 'Fast segments', format: 'count' },
      { key: 'slow_segment_count', label: 'Slow segments', format: 'count' },
      { key: 'filler_count', label: 'Fillers', format: 'count' },
      { key: 'filler_rate', label: 'Filler rate', format: 'ratio' },
      { key: 'fillers_per_minute', label: 'Fillers per minute', format: 'number' },
      { key: 'repetition_count', label: 'Repetitions', format: 'count' },
      { key: 'false_start_count', label: 'False starts', format: 'count' },
      { key: 'self_correction_count', label: 'Self-corrections', format: 'count' },
    ],
  },
  {
    key: 'voice',
    title: 'Voice',
    icon: 'graphic_eq',
    rows: [
      { key: 'pitch_mean', label: 'Pitch (mean)', format: 'hz' },
      { key: 'pitch_median', label: 'Pitch (median)', format: 'hz' },
      { key: 'pitch_std', label: 'Pitch (std dev)', format: 'hz' },
      { key: 'pitch_range', label: 'Pitch range', format: 'hz' },
      { key: 'rms_mean', label: 'Energy RMS (mean)', format: 'number' },
      { key: 'rms_std', label: 'Energy RMS (std dev)', format: 'number' },
      { key: 'rms_range', label: 'Energy RMS range', format: 'number' },
    ],
  },
  {
    key: 'interaction',
    title: 'Interaction',
    icon: 'groups',
    rows: [
      { key: 'talk_ratio', label: 'Talk ratio', format: 'ratio' },
      { key: 'turn_transition_count', label: 'Turn transitions', format: 'count' },
      { key: 'overlap_time_ratio', label: 'Overlap time', format: 'ratio' },
      { key: 'interruption_count', label: 'Interruptions', format: 'count' },
    ],
  },
  {
    key: 'quality',
    title: 'Quality',
    icon: 'high_quality',
    rows: [
      { key: 'blur_ratio', label: 'Blurred frames', format: 'ratio' },
      { key: 'frame_drop_ratio', label: 'Dropped frames', format: 'ratio' },
      { key: 'resolution', label: 'Resolution', format: 'pixels' },
      { key: 'fps', label: 'Frame rate', format: 'number' },
      { key: 'face_visible_ratio', label: 'Face visible', format: 'ratio' },
      { key: 'posture_available_ratio', label: 'Posture available', format: 'ratio' },
      { key: 'hands_visible_ratio', label: 'Hands visible', format: 'ratio' },
      { key: 'audio_clipped_ratio', label: 'Audio clipped', format: 'ratio' },
    ],
  },
];

/** 'single_speaker_recording' → 'Single speaker recording'. */
export function humanizeReason(reason: string): string {
  const words = reason.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatMeasurementValue(value: number, format: FormatKind): string {
  switch (format) {
    case 'ratio':
      return `${Math.round(value * 100)}%`;
    case 'seconds':
      return `${value.toFixed(1)} s`;
    case 'hz':
      return `${Math.round(value)} Hz`;
    case 'wpm':
      return `${Math.round(value)} wpm`;
    case 'count':
      return String(Math.round(value));
    case 'degrees':
      return `${value.toFixed(1)}°`;
    case 'pixels':
      return `${Math.round(value).toLocaleString('en-US')} px`;
    case 'number':
      return String(Math.round(value * 100) / 100);
  }
}

function MeasurementRow({ spec, measurement }: { spec: RowSpec; measurement: Measurement }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-body-md text-on-surface-variant">{spec.label}</span>
      <span className="flex items-center gap-2">
        {measurement.valid && measurement.value !== null ? (
          <span className="text-body-md text-on-surface font-label-bold">
            {formatMeasurementValue(measurement.value, spec.format)}
          </span>
        ) : (
          <span className="text-body-md text-on-surface-variant/70 italic">
            n/a{measurement.reason ? ` — ${humanizeReason(measurement.reason)}` : ''}
          </span>
        )}
        {measurement.heuristic && (
          <Badge tone="neutral" className="text-[10px] px-2 py-0.5">
            heuristic
          </Badge>
        )}
      </span>
    </div>
  );
}

export function AnalysisFeaturesPanel({ features }: { features: InterviewFeatures }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div data-testid="analysis-features-panel">
      {GROUPS.map((group) => {
        const measurements = features[group.key] ?? {};
        const rows = group.rows.filter((row) => measurements[row.key] !== undefined);
        if (rows.length === 0) return null;
        const open = openGroups.has(group.key);
        return (
          <section key={group.key} className="border-b border-surface-variant/50 last:border-b-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`analysis-group-${group.key}`}
              onClick={() => toggle(group.key)}
              className="w-full flex items-center justify-between py-3 px-1 group"
            >
              <span className="flex items-center gap-2 font-label-bold text-label-bold text-primary">
                <Icon
                  name={group.icon}
                  className="text-lg text-on-surface-variant group-hover:text-primary transition-colors"
                />
                {group.title}
              </span>
              <Icon
                name="expand_more"
                className={`text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
            {open && (
              <div
                id={`analysis-group-${group.key}`}
                className="pb-4 px-1 divide-y divide-surface-variant/40"
              >
                {rows.map((row) => (
                  <MeasurementRow key={row.key} spec={row} measurement={measurements[row.key]!} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; features: InterviewFeatures }
  | { status: 'empty' }
  | { status: 'error'; message: string };

/**
 * Self-contained container: fetches the features for one question and renders
 * the panel. A 404 (ANALYSIS_NOT_FOUND) is an empty state, not an error.
 */
export function QuestionAnalysisFeatures({
  sessionId,
  questionId,
}: {
  sessionId: string;
  questionId: string;
}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const result = await getQuestionFeatures(sessionId, questionId);
      setState({ status: 'ready', features: result.features });
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 404) {
        setState({ status: 'empty' });
      } else {
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not load analysis.',
        });
      }
    }
  }, [sessionId, questionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mb-4 rounded-xl bg-surface-container-low p-4" data-testid="analysis-features">
      <p className="text-label-bold text-on-surface-variant">Analysis measurements</p>
      {state.status === 'loading' && (
        <div className="mt-2 animate-pulse space-y-2" aria-label="Loading analysis">
          <div className="h-4 w-1/3 bg-surface-container rounded" />
          <div className="h-4 w-2/3 bg-surface-container rounded" />
        </div>
      )}
      {state.status === 'empty' && (
        <p className="mt-2 text-body-md text-on-surface-variant/70">Analysis not available yet</p>
      )}
      {state.status === 'error' && (
        <div className="mt-2 flex items-center gap-3">
          <p className="text-body-md text-on-surface-variant">{state.message}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {state.status === 'ready' && (
        <div className="mt-1">
          <AnalysisFeaturesPanel features={state.features} />
        </div>
      )}
    </div>
  );
}
