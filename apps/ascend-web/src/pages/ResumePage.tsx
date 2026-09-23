import { useEffect, useRef, useState } from 'react';
import { Button, Card, Icon } from '@zios/ui';
import type { CandidateResumeResponse, ResumeJdMatchResponse } from '@zios/shared-types';
import { ApiErrorResponse, deleteResume, fetchResume, matchResume, uploadResume } from '../api';
import { PageShell } from '../components/PageShell';

const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-error-container text-on-error-container',
  medium: 'bg-tertiary-container text-on-tertiary-container',
  low: 'bg-surface-container-high text-on-surface-variant',
};

/**
 * Resume intelligence (Phase 12, D10): paste a resume → parsed profile +
 * ATS-readiness card → match against a target JD with honesty-flagged
 * rewrite suggestions. One active resume per account; re-upload replaces.
 */
export function ResumePage() {
  const [resume, setResume] = useState<CandidateResumeResponse | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jdText, setJdText] = useState('');
  const [matching, setMatching] = useState(false);
  const [match, setMatch] = useState<ResumeJdMatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchResume()
      .then(setResume)
      .catch((err: unknown) => {
        if (err instanceof ApiErrorResponse && err.statusCode === 404) return;
        if (err instanceof ApiErrorResponse && (err.statusCode === 401 || err.statusCode === 403)) {
          return; // shell-level handlers redirect
        }
        setError(err instanceof Error ? err.message : 'Could not load your resume.');
      });
  }, []);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleFile = async (file: File) => {
    setError(null);
    setNotice(null);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      // Binary upload: the API forwards the bytes to the orchestrator's
      // extraction port (pypdf) and parses the returned text.
      setUploading(true);
      try {
        const contentBase64 = await fileToBase64(file);
        const uploaded = await uploadResume({ fileName: file.name, contentBase64 });
        setResume(uploaded);
        setMatch(null);
        setResumeText('');
        setFileName(file.name);
        setNotice('PDF uploaded — text extracted, ATS check complete.');
      } catch (err) {
        setError(err instanceof ApiErrorResponse ? err.message : 'PDF upload failed. Please try again.');
      } finally {
        setUploading(false);
      }
      return;
    }
    const text = await file.text().catch(() => '');
    if (!text.trim() || text.includes('')) {
      setError('This file type is not supported yet — upload a .txt or .pdf resume, or paste the plain text below.');
      return;
    }
    setResumeText(text);
    setFileName(file.name);
  };

  const handleUpload = async () => {
    if (resumeText.trim().length < 20) {
      setError('Paste your resume text first (at least a few lines).');
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const uploaded = await uploadResume({
        fileName: fileName ?? 'resume.txt',
        contentBase64: btoa(unescape(encodeURIComponent(resumeText))),
      });
      setResume(uploaded);
      setMatch(null);
      setNotice('Resume parsed — ATS check complete.');
    } catch (err) {
      setError(err instanceof ApiErrorResponse ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleErase = async () => {
    setError(null);
    try {
      await deleteResume();
      setResume(null);
      setResumeText('');
      setFileName(null);
      setMatch(null);
      setNotice('Resume erased.');
    } catch (err) {
      setError(err instanceof ApiErrorResponse ? err.message : 'Could not erase the resume.');
    }
  };

  const handleMatch = async () => {
    if (jdText.trim().length < 40) {
      setError('Paste the full job description (at least 40 characters).');
      return;
    }
    setMatching(true);
    setError(null);
    try {
      setMatch(await matchResume(jdText));
    } catch (err) {
      setError(err instanceof ApiErrorResponse ? err.message : 'Match failed. Please try again.');
    } finally {
      setMatching(false);
    }
  };

  const parsed = resume?.parsed ?? null;
  const ats = resume?.atsReport ?? null;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <h1 className="text-headline-sm text-on-surface">Resume intelligence</h1>
        <p className="text-body-md text-on-surface-variant">
          One active resume drives your ATS-readiness check, JD match, and gap-probing mocks.
          Re-uploading replaces it; erasing deletes the file.
        </p>

        {error && (
          <p className="rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg bg-primary-container p-3 text-body-md text-on-primary-container">
            {notice}
          </p>
        )}

        <Card padding="lg" radius="2xl">
          <h2 className="text-title-md text-on-surface">Your resume</h2>
          {resume && (
            <p className="mt-1 text-body-sm text-on-surface-variant">
              On file: <span className="font-bold">{resume.fileName}</span> (updated{' '}
              {new Date(resume.updatedAt).toLocaleDateString()})
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.md,.pdf,text/plain,application/pdf"
            className="hidden"
            data-testid="resume-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              Choose a .txt or .pdf file
            </Button>
            {resume && (
              <Button variant="ghost" onClick={() => void handleErase()}>
                Erase resume
              </Button>
            )}
          </div>
          <label htmlFor="resume-text" className="mt-4 block text-label-bold uppercase tracking-wide text-on-surface-variant">
            Or paste resume text
          </label>
          <textarea
            id="resume-text"
            rows={8}
            className="mt-2 w-full resize-y rounded-xl border border-outline-variant bg-white p-4 font-mono text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            placeholder="Priya Sharma&#10;priya@example.com&#10;&#10;Skills: …"
            value={resumeText}
            onChange={(e) => {
              setResumeText(e.target.value);
              setFileName(null);
            }}
          />
          <div className="mt-3 flex justify-end">
            <Button
              onClick={() => void handleUpload()}
              loading={uploading}
              disabled={resumeText.trim().length < 20}
              icon="upload"
            >
              {resume ? 'Replace resume' : 'Parse resume'}
            </Button>
          </div>
        </Card>

        {parsed && (
          <Card padding="lg" radius="2xl">
            <h2 className="text-title-md text-on-surface">Parsed profile</h2>
            <p className="mt-2 text-body-md text-on-surface">
              {parsed.name ?? 'Name not detected'}
              {parsed.summary ? ` — ${parsed.summary}` : ''}
            </p>
            {parsed.skills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {parsed.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-surface-container-high px-3 py-1 text-label-bold text-on-surface-variant"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </Card>
        )}

        {ats && (
          <Card padding="lg" radius="2xl" className="border-t-4 border-t-primary">
            <div className="flex items-center justify-between">
              <h2 className="text-title-md text-on-surface">ATS readiness</h2>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-container text-title-md text-on-primary">
                {ats.score}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {ats.issues.map((issue, index) => (
                <div key={index} className="rounded-xl bg-surface-container-low p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-label-bold uppercase ${SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.low}`}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-label-bold uppercase tracking-wide text-on-surface-variant">
                      {issue.section}
                    </span>
                  </div>
                  <p className="mt-1 text-body-md text-on-surface">{issue.issue}</p>
                  <p className="mt-1 text-body-sm text-on-surface-variant">
                    <span className="font-bold">Fix:</span> {issue.fix}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {parsed && (
          <Card padding="lg" radius="2xl">
            <h2 className="text-title-md text-on-surface">Match against a target role</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Paste a job description to see keyword coverage, gaps, and honest rewrite
              suggestions — fabricated metrics are flagged, never presented as yours.
            </p>
            <label htmlFor="jd-text" className="sr-only">
              Job description
            </label>
            <textarea
              id="jd-text"
              rows={6}
              className="mt-3 w-full resize-y rounded-xl border border-outline-variant bg-white p-4 text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="Paste the full job description…"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
            />
            <div className="mt-3 flex justify-end">
              <Button
                variant="outline"
                onClick={() => void handleMatch()}
                loading={matching}
                disabled={jdText.trim().length < 40}
                icon="compare"
              >
                Analyse match
              </Button>
            </div>

            {match && (
              <div className="mt-6 space-y-6" data-testid="match-result">
                <div>
                  <h3 className="text-title-sm text-on-surface">Keyword coverage</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {match.coverage.map((item) => (
                      <span
                        key={item.keyword}
                        className={`flex items-center gap-1 rounded-full px-3 py-1 text-label-bold ${
                          item.present
                            ? 'bg-primary-container text-on-primary-container'
                            : 'bg-surface-container-high text-on-surface-variant line-through'
                        }`}
                      >
                        <Icon name={item.present ? 'check' : 'close'} className="text-sm" />
                        {item.keyword}
                      </span>
                    ))}
                  </div>
                  {match.missingKeywords.length > 0 && (
                    <p className="mt-2 text-body-sm text-on-surface-variant">
                      Missing: {match.missingKeywords.join(', ')}
                    </p>
                  )}
                </div>

                {match.suggestions.length > 0 && (
                  <div>
                    <h3 className="text-title-sm text-on-surface">Honest rewrites</h3>
                    <div className="mt-2 space-y-3">
                      {match.suggestions.map((suggestion, index) => (
                        <div key={index} className="rounded-xl bg-surface-container-low p-4">
                          <p className="text-body-sm text-on-surface-variant">
                            <span className="font-bold text-on-surface">Original:</span>{' '}
                            {suggestion.original}
                          </p>
                          <p className="mt-1 text-body-sm text-on-surface">
                            <span className="font-bold">Improved:</span> {suggestion.improved}
                          </p>
                          {suggestion.honestyFlags.length > 0 && (
                            <p className="mt-2 flex items-start gap-1 rounded-lg bg-error-container p-2 text-body-sm text-on-error-container">
                              <Icon name="warning" className="mt-0.5 text-sm" />
                              This rewrite contains numbers not in your resume — verify before
                              using: {suggestion.honestyFlags.join(', ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </PageShell>
  );
}
