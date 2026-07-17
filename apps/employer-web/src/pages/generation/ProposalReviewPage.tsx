import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Icon, Badge } from '@zios/ui';
import type { ProposedQuestion, FollowupPolicy } from '@zios/shared-types';
import { generationApi } from '../../lib/generation-api';
import { userMessageForError } from '../../lib/errors';
import { useToast } from '../../components/Toast';
import {
  estimateTotalDuration,
  findLowestPriorityQuestionIndex,
  formatDuration,
  groupQuestionsByTopic,
  questionTypeLabel,
  followupPolicyLabel,
  type QuestionEdit,
} from './generation-utils';

const FOLLOWUP_POLICIES: FollowupPolicy[] = ['none', 'fixed', 'adaptive_ai'];

/**
 * /kits/generate/:generationId/review — mandatory review screen for a JD-based
 * proposal. The user must review and confirm before publishing (FR-E3-5).
 */
export function ProposalReviewPage() {
  const { generationId } = useParams<{ generationId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);

  // Proposals are loaded via SSR-less state: this page is navigated to after
  // propose() returns, so we fetch it again to ensure fresh data.
  const [proposalData, setProposalData] = useState<{
    profile: {
      title: string | null;
      seniority: string | null;
      skills: string[];
      responsibilities: string[];
    };
    proposal: {
      topics: string[];
      questions: ProposedQuestion[];
      durationEstimateSec: number;
      withinCap: boolean;
    };
  } | null>(null);

  const [edits, setEdits] = useState<QuestionEdit[]>([]);

  const loadProposal = useCallback(async () => {
    if (!generationId) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await generationApi.get(generationId);
      setProposalData({ profile: response.profile, proposal: response.proposal });
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setLoading(false);
    }
  }, [generationId]);

  // Initial load.
  useEffect(() => {
    void loadProposal();
  }, [loadProposal]);

  const { profile, proposal, duration } = useMemo(() => {
    if (!proposalData) {
      return { profile: null, proposal: null, duration: null };
    }
    return {
      profile: proposalData.profile,
      proposal: proposalData.proposal,
      duration: estimateTotalDuration(proposalData.proposal.questions),
    };
  }, [proposalData]);

  const groupedQuestions = useMemo(() => {
    if (!proposal) return {};
    return groupQuestionsByTopic(proposal.questions, proposal.topics);
  }, [proposal]);

  function recordEdit(edit: QuestionEdit) {
    setEdits((prev) => [...prev, edit]);
  }

  function updateQuestion(index: number, patch: Partial<ProposedQuestion>, fieldName: string) {
    if (!proposal) return;
    const oldValue = proposal.questions[index];
    if (!oldValue) return;
    const updated = { ...oldValue, ...patch } as ProposedQuestion;
    const newQuestions = [...proposal.questions];
    newQuestions[index] = updated;
    setProposalData((prev) =>
      prev
        ? {
            ...prev,
            proposal: {
              ...prev.proposal,
              questions: newQuestions,
            },
          }
        : prev,
    );
    recordEdit({
      field: fieldName,
      questionIndex: index,
      oldValue: (oldValue as unknown as Record<string, unknown>)[fieldName],
      newValue: (patch as unknown as Record<string, unknown>)[fieldName],
      at: new Date().toISOString(),
    });
  }

  async function handleRegenerate(index: number) {
    if (!generationId || !proposal) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await generationApi.regenerate(generationId, index, {
        topic: proposal.questions[index]?.topic,
        type: proposal.questions[index]?.type,
      });
      setProposalData({ profile: response.profile, proposal: response.proposal });
      recordEdit({
        field: 'regenerate',
        questionIndex: index,
        oldValue: 'before',
        newValue: 'after',
        at: new Date().toISOString(),
      });
      toast.push('Question regenerated', 'success');
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleDropLowestPriority() {
    if (!proposal) return;
    const index = findLowestPriorityQuestionIndex(proposal.questions);
    if (index === null) return;
    const removed = proposal.questions[index];
    const newQuestions = proposal.questions.filter((_, i) => i !== index);
    setProposalData((prev) =>
      prev
        ? {
            ...prev,
            proposal: { ...prev.proposal, questions: newQuestions },
          }
        : prev,
    );
    recordEdit({
      field: 'dropQuestion',
      questionIndex: index,
      oldValue: removed?.prompt,
      newValue: null,
      at: new Date().toISOString(),
    });
    toast.push('Lowest-priority question removed to fit the duration cap', 'success');
  }

  async function handlePublish() {
    if (!generationId || !proposal) return;
    setPublishing(true);
    setError(undefined);
    try {
      const result = await generationApi.publish(generationId, proposal, edits);
      toast.push('Kit published from JD proposal', 'success');
      navigate(`/kits/${result.version.kitId}`, { state: { jdPublished: true } });
    } catch (err) {
      setError(userMessageForError(err));
      setPublishing(false);
    }
  }

  if (loading && !proposalData) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-20">
        <Icon name="progress_activity" className="animate-spin text-4xl text-primary" />
        <p className="mt-4 text-on-surface-variant">Loading proposal…</p>
      </div>
    );
  }

  if (!proposalData || !proposal || !profile) {
    return (
      <div className="max-w-3xl mx-auto">
        <Card className="border-error/40 bg-[#fff5f5] flex items-center gap-3" padding="md">
          <Icon name="error" className="text-error" />
          <p className="text-sm text-error font-label-bold">
            {error ?? 'Could not load the generation proposal.'}
          </p>
        </Card>
        <div className="mt-4">
          <Button variant="outline" onClick={() => void loadProposal()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const capSeconds = 1800; // 30 min cap used by the backend estimator.
  const overCap = duration && duration.estimatedSeconds > capSeconds;

  return (
    <div className="max-w-4xl mx-auto">
      <section className="mb-6">
        <Link
          to="/kits/generate"
          className="text-primary font-label-bold text-sm inline-flex items-center gap-1 hover:underline mb-4"
        >
          <Icon name="arrow_back" className="text-sm" /> Back to JD input
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
              Review generated kit
            </h2>
            <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
              Edit prompts, topics and follow-ups. Every change is recorded for audit.
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-on-surface-variant">Estimated duration</p>
            <p className="text-2xl font-bold text-primary">
              {formatDuration(duration?.estimatedSeconds ?? proposal.durationEstimateSec)}
            </p>
            {overCap && (
              <p className="text-error text-sm mt-1">Exceeds {formatDuration(capSeconds)} cap</p>
            )}
          </div>
        </div>
      </section>

      {error && (
        <Card className="mb-6 border-error/40 bg-[#fff5f5] flex items-center gap-3" padding="md">
          <Icon name="error" className="text-error" />
          <p className="text-sm text-error font-label-bold">{error}</p>
        </Card>
      )}

      {!proposal.withinCap && overCap && (
        <Card className="mb-6 border-secondary-container/50 bg-secondary-fixed/20" padding="md">
          <div className="flex items-start gap-3">
            <Icon name="timer" className="text-secondary-container mt-0.5" />
            <div>
              <p className="font-label-bold text-on-surface">Duration over cap</p>
              <p className="text-sm text-on-surface-variant mt-1">
                The current estimate exceeds the recommended cap. You can drop the lowest-priority
                question to bring it under the limit.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => handleDropLowestPriority()}
              >
                Drop lowest-priority question
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="person" className="text-primary" />
          <h3 className="font-headline-sm text-headline-sm text-primary">Extracted role profile</h3>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-on-surface-variant font-label-bold">Title</dt>
            <dd className="text-primary">{profile.title ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant font-label-bold">Seniority</dt>
            <dd className="text-primary">{profile.seniority ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-on-surface-variant font-label-bold">Skills</dt>
            <dd className="flex flex-wrap gap-1 mt-1">
              {profile.skills.length === 0 ? (
                <span className="text-primary">—</span>
              ) : (
                profile.skills.map((skill) => (
                  <Badge key={skill} tone="primary">
                    {skill}
                  </Badge>
                ))
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-on-surface-variant font-label-bold mb-1">Key responsibilities</dt>
            <dd>
              {profile.responsibilities.length === 0 ? (
                <span className="text-primary">—</span>
              ) : (
                <ul className="space-y-1">
                  {profile.responsibilities.map((resp) => (
                    <li key={resp} className="text-primary flex items-start gap-2">
                      <span aria-hidden="true">•</span>
                      {resp}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="space-y-6 mb-8">
        {Object.entries(groupedQuestions).map(([topic, questions]) => (
          <Card key={topic}>
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-headline-sm text-headline-sm text-primary">{topic}</h3>
              <Badge tone="neutral">{questions.length}</Badge>
            </div>
            <div className="space-y-4">
              {questions.map((question) => {
                const index = proposal.questions.indexOf(question);
                return (
                  <QuestionEditor
                    key={index}
                    index={index}
                    question={question}
                    onChange={(patch, field) => updateQuestion(index, patch, field)}
                    onRegenerate={() => void handleRegenerate(index)}
                    loading={loading}
                  />
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-primary/20">
        <div className="flex items-start gap-3">
          <input
            id="review-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 h-5 w-5 accent-primary"
          />
          <label
            htmlFor="review-confirm"
            className="text-sm text-on-surface-variant cursor-pointer"
          >
            I have reviewed this AI-generated proposal, edited it as needed, and confirm it is ready
            to publish. No further generation will occur after publishing.
          </label>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => void loadProposal()}
            disabled={loading || publishing}
          >
            Refresh proposal
          </Button>
          <Button
            icon="publish"
            loading={publishing}
            disabled={!confirmed || publishing || overCap}
            onClick={() => void handlePublish()}
          >
            Publish kit
          </Button>
        </div>
      </Card>
    </div>
  );
}

interface QuestionEditorProps {
  index: number;
  question: ProposedQuestion;
  onChange: (patch: Partial<ProposedQuestion>, field: string) => void;
  onRegenerate: () => void;
  loading: boolean;
}

function QuestionEditor({ index, question, onChange, onRegenerate, loading }: QuestionEditorProps) {
  return (
    <div className="border border-outline-variant/50 rounded-xl p-4 bg-surface-container-low/30">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-xs font-label-bold text-on-surface-variant">
          Question {index + 1}
        </span>
        <div className="flex items-center gap-2">
          <Badge tone="primary">{questionTypeLabel(question.type)}</Badge>
          <Badge tone="neutral">{followupPolicyLabel(question.followupPolicy)}</Badge>
        </div>
      </div>

      <label htmlFor={`prompt-${index}`} className="sr-only">
        Question prompt
      </label>
      <textarea
        id={`prompt-${index}`}
        value={question.prompt}
        onChange={(e) => onChange({ prompt: e.target.value }, 'prompt')}
        rows={3}
        className="w-full px-3 py-2 bg-white border border-outline-variant rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm text-on-surface resize-y"
      />

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`topic-${index}`}
            className="text-xs font-label-bold text-on-surface-variant"
          >
            Topic
          </label>
          <input
            id={`topic-${index}`}
            type="text"
            value={question.topic}
            onChange={(e) => onChange({ topic: e.target.value }, 'topic')}
            className="w-full mt-1 px-3 py-2 bg-white border border-outline-variant rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm text-on-surface"
          />
        </div>
        <div>
          <label
            htmlFor={`followup-${index}`}
            className="text-xs font-label-bold text-on-surface-variant"
          >
            Follow-up policy
          </label>
          <select
            id={`followup-${index}`}
            value={question.followupPolicy}
            onChange={(e) =>
              onChange({ followupPolicy: e.target.value as FollowupPolicy }, 'followupPolicy')
            }
            className="w-full mt-1 px-3 py-2 bg-white border border-outline-variant rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none text-sm text-on-surface"
          >
            {FOLLOWUP_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {followupPolicyLabel(policy)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {question.rubricLines.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-label-bold text-on-surface-variant mb-1">Rubric</p>
          <ul className="text-xs text-on-surface-variant space-y-1">
            {question.rubricLines.map((line) => (
              <li key={line.id} className="flex items-start gap-2">
                <span aria-hidden="true">•</span>
                {line.text} ({Math.round(line.weight * 100)}%)
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          icon="auto_awesome"
          disabled={loading}
          onClick={onRegenerate}
        >
          Regenerate this question
        </Button>
      </div>
    </div>
  );
}
