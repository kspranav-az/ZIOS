import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@zios/ui';

interface VideoRecorderProps {
  maxDurationSec: number;
  onSubmit: (blob: Blob, durationSec: number) => void | Promise<void>;
  onCancel?: () => void;
  onStateChange?: (state: RecorderState) => void;
  disabled?: boolean;
}

export type RecorderState =
  'idle' | 'requesting' | 'preview' | 'recording' | 'review' | 'uploading';

export function VideoRecorder({
  maxDurationSec,
  onSubmit,
  onCancel,
  onStateChange,
  disabled,
}: VideoRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [remainingSec, setRemainingSec] = useState(maxDurationSec);

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
      clearTimer();
    };
  }, [stopStream, clearTimer]);

  const startPreview = async () => {
    setError(null);
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
      setState('preview');
    } catch {
      setError('Could not access camera or microphone. Please check permissions and try again.');
      setState('idle');
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      const elapsed = Math.min((Date.now() - startTimeRef.current) / 1000, maxDurationSec);
      setDurationSec(elapsed);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = URL.createObjectURL(blob);
        videoRef.current.controls = true;
      }
      setState('review');
    };

    recorder.start(250);
    startTimeRef.current = Date.now();
    setRemainingSec(maxDurationSec);
    setState('recording');

    timerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const left = Math.max(0, maxDurationSec - elapsed);
      setRemainingSec(left);
      if (left <= 0) {
        stopRecording();
      }
    }, 250);
  };

  const stopRecording = () => {
    clearTimer();
    mediaRecorderRef.current?.stop();
  };

  const retake = async () => {
    setRecordedBlob(null);
    if (videoRef.current) {
      videoRef.current.src = '';
      videoRef.current.controls = false;
    }
    await startPreview();
  };

  const submit = async () => {
    if (!recordedBlob) return;
    setState('uploading');
    try {
      await onSubmit(recordedBlob, durationSec);
      setRecordedBlob(null);
      setDurationSec(0);
      setState('idle');
    } catch {
      setState('review');
      setError('Upload failed. Please check your connection and try again.');
    }
  };

  const cancel = () => {
    stopStream();
    clearTimer();
    onCancel?.();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl bg-surface-container-low">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={state !== 'review'}
          className="aspect-video w-full object-cover"
        />
        {state === 'recording' && (
          <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-error px-3 py-1 text-label-bold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Recording {Math.ceil(remainingSec)}s
          </div>
        )}
        {(state === 'idle' || state === 'requesting') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-container">
            <Icon name="videocam" className="text-4xl text-on-surface-variant" />
            <p className="text-body-md text-on-surface-variant">Camera preview will appear here</p>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-error-container p-3 text-body-md text-on-error-container">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {state === 'idle' && (
          <Button onClick={startPreview} disabled={disabled} icon="videocam">
            Start camera
          </Button>
        )}
        {state === 'preview' && (
          <>
            <Button onClick={startRecording} icon="radio_button_checked">
              Start recording
            </Button>
            <Button variant="outline" onClick={cancel} icon="close">
              Cancel
            </Button>
          </>
        )}
        {state === 'recording' && (
          <Button onClick={stopRecording} icon="stop">
            Stop recording
          </Button>
        )}
        {state === 'review' && (
          <>
            <Button onClick={submit} disabled={disabled} icon="check">
              Submit answer
            </Button>
            <Button variant="outline" onClick={retake} disabled={disabled} icon="replay">
              Retake
            </Button>
          </>
        )}
        {state === 'uploading' && (
          <Button loading disabled icon="upload">
            Uploading…
          </Button>
        )}
      </div>
    </div>
  );
}
