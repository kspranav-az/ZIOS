import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Icon, Badge } from '@zios/ui';
import type { JdProfile } from '@zios/shared-types';
import { generationApi } from '../../lib/generation-api';
import { userMessageForError } from '../../lib/errors';
import { defaultSampleJd } from './generation-utils';

/**
 * /kits/generate — paste a JD, see a quick analysis preview, then create a
 * generation proposal and move to mandatory review (FR-E3-1…E3-4).
 */
export function JdInputPage() {
  const navigate = useNavigate();
  const [jdText, setJdText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [profile, setProfile] = useState<JdProfile | null>(null);
  const [error, setError] = useState<string>();

  async function handleAnalyze() {
    setError(undefined);
    setProfile(null);
    setAnalyzing(true);
    try {
      const response = await generationApi.analyze(jdText);
      setProfile(response.profile);
    } catch (err) {
      setError(userMessageForError(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGenerate() {
    setError(undefined);
    setProposing(true);
    try {
      const response = await generationApi.propose(jdText);
      navigate(`/kits/generate/${response.generation.id}/review`);
    } catch (err) {
      setError(userMessageForError(err));
      setProposing(false);
    }
  }

  const sampleJd = defaultSampleJd();
  const charCount = jdText.length;
  const canGenerate = jdText.trim().length > 0;

  return (
    <div className="max-w-3xl mx-auto">
      <section className="mb-6">
        <Link
          to="/kits/new"
          className="text-primary font-label-bold text-sm inline-flex items-center gap-1 hover:underline mb-4"
        >
          <Icon name="arrow_back" className="text-sm" /> Back to start options
        </Link>
        <h2 className="font-display-lg-mobile text-display-lg-mobile sm:font-display-lg sm:text-display-lg text-primary">
          Generate from a job description
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">
          Paste the full JD text. AI extracts the role profile and drafts an interview kit. You will
          review and edit every question before publishing.
        </p>
      </section>

      {error && (
        <Card className="mb-6 border-error/40 bg-[#fff5f5] flex items-center gap-3" padding="md">
          <Icon name="error" className="text-error" />
          <p className="text-sm text-error font-label-bold">{error}</p>
        </Card>
      )}

      <Card className="mb-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label htmlFor="jd-text" className="text-sm font-bold text-primary">
              Job description
            </label>
            <span className="text-xs text-on-surface-variant">{charCount} characters</span>
          </div>
          <textarea
            id="jd-text"
            value={jdText}
            onChange={(event) => setJdText(event.target.value)}
            placeholder={sampleJd}
            rows={14}
            className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:ring-2 focus:border-primary outline-none transition-all text-base leading-relaxed text-on-surface resize-y"
          />
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              icon="auto_awesome"
              disabled={!canGenerate || analyzing}
              loading={analyzing}
              onClick={() => void handleAnalyze()}
            >
              Preview analysis
            </Button>
            <Button
              icon="bolt"
              loading={proposing}
              disabled={!canGenerate || proposing}
              onClick={() => void handleGenerate()}
            >
              Generate interview kit
            </Button>
          </div>
        </div>
      </Card>

      {profile && (
        <Card className="border-primary/20">
          <div className="flex items-center gap-2 mb-4">
            <Icon name="psychology" className="text-primary" />
            <h3 className="font-headline-sm text-headline-sm text-primary">
              Extracted role profile
            </h3>
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
            <div>
              <dt className="text-on-surface-variant font-label-bold">Skills</dt>
              <dd className="flex flex-wrap gap-1 mt-1">
                {profile.skills.length === 0 ? (
                  <span className="text-primary">—</span>
                ) : (
                  profile.skills.slice(0, 8).map((skill) => (
                    <Badge key={skill} tone="primary">
                      {skill}
                    </Badge>
                  ))
                )}
              </dd>
            </div>
            <div>
              <dt className="text-on-surface-variant font-label-bold">Tools</dt>
              <dd className="flex flex-wrap gap-1 mt-1">
                {profile.tools.length === 0 ? (
                  <span className="text-primary">—</span>
                ) : (
                  profile.tools.map((tool) => (
                    <Badge key={tool} tone="neutral">
                      {tool}
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
                    {profile.responsibilities.slice(0, 6).map((resp) => (
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
      )}
    </div>
  );
}
