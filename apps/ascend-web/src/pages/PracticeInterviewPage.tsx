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

  const handleSubmit = async () => {
    if (!recoveryToken) return;
    const text = answer.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const response = await submitPracticeTurn(sessionId, recoveryToken, {
        answer: text,
        ...(recordingRef ? { recordingRef } : {}),
      });
      if (turn) {
        setHistory((prev) => [...prev, { prompt: turn.text, answer: text }]);
      }
      setAnswer('');
      setRecordingRef(null);
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
      setAnswer(result.transcript);
      setRecordingRef(result.objectName);
      setRecorderState('idle');
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

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-headline-sm text-on-surface">Practice mock</h1>
          <span className="rounded-full bg-surface-container px-3 py-1 text-label-bold text-on-surface-variant">
            {history.length + 1}
            {totalQuestions > 0 ? ` of ~${totalQuestions}` : ''}
          </span>
        </div>

        {history.length > 0 && (
          <div className="mb-6 space-y-3">
            {history.map((item, index) => (
              <Card key={index} padding="md" radius="xl" className="bg-surface-container-low">
                <p className="font-bold text-on-surface">{item.prompt}</p>
                {item.answer && (
                  <p className="mt-2 whitespace-pre-wrap text-body-md text-on-surface-variant">
                    {item.answer}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}

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
                          : 'Record your answer — we transcribe it and you can edit before submitting.'}
                    </p>
                  </div>
                  {recorderState === 'idle' && (
                    <Button variant="outline" icon="mic" onClick={() => void startRecording()}>
                      Record
                    </Button>
                  )}
                  {recorderState === 'recording' && (
                    <Button variant="outline" icon="stop" onClick={() => void stopRecording()}>
                      Stop
                    </Button>
                  )}
                  {recorderState === 'transcribing' && (
                    <Icon name="progress_activity" className="animate-spin text-2xl text-primary" />
                  )}
                </div>
                {recorderError && (
                  <p className="mt-3 rounded-lg bg-error-container p-3 text-body-sm text-on-error-container">
                    {recorderError}
                  </p>
                )}
                {recordingRef && recorderState === 'idle' && (
                  <p className="mt-3 text-body-sm text-on-surface-variant">
                    Recording attached — review the transcript below, edit if needed, then submit.
                  </p>
                )}
              </div>
            )}

            <label htmlFor="practice-answer" className="sr-only">
              Your answer
            </label>
            <textarea
              id="practice-answer"
              rows={6}
              className="w-full resize-y rounded-xl border border-outline-variant bg-white p-4 text-body-md text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder={
                sessionMode === 'voice'
                  ? 'Your transcribed answer appears here — edit it if needed…'
                  : 'Type your answer here…'
              }
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={loading || recorderState === 'transcribing'}
            />

            {error && (
              <p className="mt-4 rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end">
              <Button
                size="lg"
                onClick={() => void handleSubmit()}
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
    </PageShell>
  );
}
