import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, Icon } from '@zios/ui';
import type { PracticeMode, SessionTurnResponse } from '@zios/shared-types';
import {
  ApiErrorResponse,
  clearPracticeRecovery,
  fetchPracticeSession,
  loadPracticeRecovery,
  preflightPractice,
  submitPracticeAudio,
  submitPracticeTurn,
} from '../api';
import { PageShell } from '../components/PageShell';

interface HistoryItem {
  prompt: string;
  answer: string | null;
}

function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported unsupported — fall through to the default.
    }
  }
  return 'audio/webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Text-mode practice mock (D5). Mirrors candidate-web's InterviewPage flow:
 * preflight → question/follow-up loop → wrapup → report. The recovery token
 * is tab-scoped in sessionStorage (D12) so a refresh can resume the mock.
 */
export function PracticeInterviewPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Live sessions that already went through the room phase continue here in
  // text (`?room=done`); without the flag we route fresh live sessions to the
  // LiveKit room instead.
  const roomPhaseDone = searchParams.has('room');
  const [turn, setTurn] = useState<SessionTurnResponse | null>(null);
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [sessionMode, setSessionMode] = useState<PracticeMode>('text');
  const [recordingRef, setRecordingRef] = useState<string | null>(null);
  const [recorderState, setRecorderState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Completed-answer tile whose Q&A popup is open (null = closed). */
  const [openTile, setOpenTile] = useState<number | null>(null);

  const recoveryToken = loadPracticeRecovery(sessionId);

  const recover = useCallback(async () => {
    if (!recoveryToken) return;
    try {
      const [preflight, detail] = await Promise.all([
        preflightPractice(sessionId, recoveryToken),
        fetchPracticeSession(sessionId),
      ]);
      setTotalQuestions(detail.questions.length);
      setSessionMode(detail.session.mode);
      if (preflight.session.status === 'completed') {
        navigate(`/practice/${sessionId}/report`, { replace: true });
        return;
      }
      // Live-mode sessions run in the LiveKit room (Phase 12e); preflight
      // above already performed the charge + live transition. Sessions that
      // finished the room phase continue here in text.
      if (detail.session.mode === 'live' && !roomPhaseDone) {
        navigate(`/practice/${sessionId}/live`, { replace: true });
        return;
      }
      setTurn(preflight.turn);
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not resume your mock. Please start a new one.',
      );
    }
  }, [sessionId, recoveryToken, navigate, roomPhaseDone]);

  useEffect(() => {
    if (!recoveryToken) {
      setInitializing(false);
      return;
    }
    recover().finally(() => setInitializing(false));
  }, [recover, recoveryToken]);

  // Close the answer popup with Escape.
  useEffect(() => {
    if (openTile === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenTile(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openTile]);

  const submitAnswer = async (text: string, ref: string | null) => {
    if (!recoveryToken || !text) return;
    setLoading(true);
    setError(null);
    try {
      const response = await submitPracticeTurn(sessionId, recoveryToken, {
        answer: text,
        ...(ref ? { recordingRef: ref } : {}),
      });
      if (turn) {
        setHistory((prev) => [...prev, { prompt: turn.text, answer: text }]);
      }
      setAnswer('');
      setRecordingRef(null);
      setRecorderError(null);
      if (response.turn.type === 'wrapup') {
        clearPracticeRecovery(sessionId);
        navigate(`/practice/${sessionId}/report`, { replace: true });
      } else {
        setTurn(response.turn);
      }
    } catch (err) {
      setError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not submit your answer. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    const text = answer.trim();
    if (!text) return;
    void submitAnswer(text, recordingRef);
  };

  /* ---- voice recorder (Phase 12b: record → transcribe → submit) ---- */

  const startRecording = async () => {
    setRecorderError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecordingMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecorderError('Recording failed. You can type your answer instead.');
        setRecorderState('idle');
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecorderState('recording');
    } catch {
      setRecorderError('Microphone access was denied. Allow the mic, or type your answer instead.');
    }
  };

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      void transcribeRecording(blob);
    };
    recorder.stop();
  };

  const transcribeRecording = async (blob: Blob) => {
    if (!recoveryToken) return;
    setRecorderState('transcribing');
    setRecorderError(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await submitPracticeAudio(sessionId, recoveryToken, {
        audioBase64,
        contentType: blob.type || 'audio/webm',
      });
      setRecorderState('idle');
      // D2: the transcript is never shown for editing — submit immediately
      // with the recording ref so scoring keeps the audio evidence link.
      // An empty transcript (inaudible/noise-only recording) must surface the
      // typed fallback instead of silently doing nothing.
      if (!result.transcript.trim()) {
        setRecorderError(
          'We could not hear anything in that recording. Check your microphone and try again, or type your answer below.',
        );
        return;
      }
      void submitAnswer(result.transcript, result.objectName);
    } catch (err) {
      setRecorderState('idle');
      setRecorderError(
        err instanceof ApiErrorResponse
          ? err.message
          : 'Could not transcribe your recording. You can type your answer instead.',
      );
    }
  };

  if (!recoveryToken) {
    return (
      <PageShell>
        <div className="mx-auto w-full max-w-md pt-12 text-center">
          <h1 className="text-headline-sm text-on-surface">Mock not found</h1>
          <p className="mt-2 text-body-md text-on-surface-variant">
            We could not find this practice session in this tab. Start a new mock from the home
            page.
          </p>
          <Button className="mt-6" onClick={() => navigate('/')}>
            Back to home
          </Button>
        </div>
      </PageShell>
    );
  }

  if (initializing) {
    return (
      <PageShell>
        <p className="mx-auto pt-12 text-body-md text-on-surface-variant">Preparing your mock…</p>
      </PageShell>
    );
  }

  const openTileItem = openTile !== null ? history[openTile] : undefined;

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-headline-sm text-on-surface">Practice mock</h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full bg-surface-container px-3 py-1 text-label-bold text-on-surface-variant">
              {history.length + 1}
              {totalQuestions > 0 ? ` of ~${totalQuestions}` : ''}
            </span>
            {history.length > 0 && (
              <div className="flex flex-wrap items-center gap-1" aria-label="Completed answers">
                {history.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setOpenTile(index)}
                    title={`Answer ${index + 1} — ${item.prompt.slice(0, 60)}`}
                    aria-label={`Review answer ${index + 1}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-low text-label-bold text-on-surface transition-colors hover:border-primary hover:bg-primary hover:text-on-primary"
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex w-full flex-1 flex-col items-center justify-center pb-8">
          <div className="w-full max-w-2xl">
{turn && (
              <Card padding="lg" radius="2xl">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container">
                    <Icon name="smart_toy" className="text-xl text-on-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      {turn.type === 'followup' ? 'Follow-up' : 'Question'}
                    </p>
                    <p className="mt-1 text-body-lg text-on-surface">{turn.text}</p>
                  </div>
                </div>

                {sessionMode === 'voice' && (
                  <div className="mb-4 rounded-xl border border-outline-variant bg-surface-container-low p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-body-md font-bold text-on-surface">Answer by voice</p>
                        <p className="text-body-sm text-on-surface-variant">
                          {recorderState === 'recording'
                            ? 'Recording… speak your answer, then stop.'
                            : recorderState === 'transcribing'
                              ? 'Transcribing your answer…'
                              : loading
                                ? 'Submitting your answer…'
                                : 'Record your answer — we transcribe it and submit it for you.'}
                        </p>
                      </div>
                      {recorderState === 'idle' && !loading && (
                        <Button variant="outline" icon="mic" onClick={() => void startRecording()}>
                          Record
                        </Button>
                      )}
                      {recorderState === 'recording' && (
                        <Button variant="outline" icon="stop" onClick={() => void stopRecording()}>
                          Stop
                        </Button>
                      )}
                      {(recorderState === 'transcribing' || loading) && (
                        <Icon name="progress_activity" className="animate-spin text-2xl text-primary" />
                      )}
                    </div>
                    {recorderError && (
                      <p className="mt-3 rounded-lg bg-error-container p-3 text-body-sm text-on-error-container">
                        {recorderError}
                      </p>
                    )}
                    {recorderError && (
                      <p className="mt-3 text-body-sm text-on-surface-variant">
                        Type your answer below and submit it instead.
                      </p>
                    )}
                  </div>
                )}

                {(sessionMode !== 'voice' || recorderError !== null) && (
                  <>
                    <label htmlFor="practice-answer" className="sr-only">
                      Your answer
                    </label>
                    <textarea
                      id="practice-answer"
                      rows={6}
                      className="w-full resize-y rounded-xl border border-outline-variant bg-white p-4 text-body-md text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
                      placeholder={
                        sessionMode === 'voice'
                          ? 'Type your answer here…'
                          : 'Type your answer here…'
                      }
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      disabled={loading || recorderState === 'transcribing'}
                    />
                  </>
                )}

                {error && (
                  <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
                    {error}
                  </p>
                )}

                <div className="mt-4 flex justify-end">
                  <Button
                    size="lg"
                    onClick={handleSubmit}
                    loading={loading}
                    disabled={answer.trim().length === 0}
                    icon="send"
                  >
                    Submit answer
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {openTileItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Answer ${(openTile ?? 0) + 1}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenTile(null)}
        >
          <div className="w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
            <Card padding="lg" radius="2xl">
              <div className="flex items-start justify-between gap-3">
                <p className="text-label-bold uppercase tracking-wide text-on-surface-variant">
                  Answer {(openTile ?? 0) + 1}
                </p>
                <button
                  type="button"
                  onClick={() => setOpenTile(null)}
                  aria-label="Close"
                  className="rounded-full p-1 text-on-surface-variant transition-colors hover:bg-surface-container"
                >
                  <Icon name="close" className="text-xl" />
                </button>
              </div>
              <p className="mt-3 font-bold text-on-surface">{openTileItem.prompt}</p>
              {openTileItem.answer && (
                <p className="mt-2 whitespace-pre-wrap text-body-md text-on-surface-variant">
                  {openTileItem.answer}
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </PageShell>
  );
}
