import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  Candidate,
  ConsentRecord,
  InterviewSession,
  Invite,
  KitQuestion,
  KitSnapshotKit,
  SessionTurnResponse,
} from '@zios/shared-types';

export interface ResolvedInterviewData {
  invite: Invite;
  candidate: Candidate;
  kit: KitSnapshotKit;
  questions: KitQuestion[];
  session: InterviewSession | null;
  consent: ConsentRecord | null;
  recoveryToken: string | null;
  turn: SessionTurnResponse | null;
}

export interface InterviewContextValue extends ResolvedInterviewData {
  token: string | null;
  loading: boolean;
  error: string | null;
  setToken: (token: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setResolvedData: (data: Partial<ResolvedInterviewData>) => void;
  setRecoveryToken: (token: string) => void;
  setSession: (session: InterviewSession) => void;
  setTurn: (turn: SessionTurnResponse | null) => void;
  clearError: () => void;
}

const InterviewContext = createContext<InterviewContextValue | null>(null);

const initialData: ResolvedInterviewData = {
  invite: null as unknown as Invite,
  candidate: null as unknown as Candidate,
  kit: null as unknown as KitSnapshotKit,
  questions: [],
  session: null,
  consent: null,
  recoveryToken: null,
  turn: null,
};

export function InterviewProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResolvedInterviewData>(initialData);

  const value = useMemo<InterviewContextValue>(
    () => ({
      ...data,
      token,
      loading,
      error,
      setToken,
      setLoading,
      setError,
      setResolvedData: (patch) => setData((prev) => ({ ...prev, ...patch })),
      setRecoveryToken: (recoveryToken) => setData((prev) => ({ ...prev, recoveryToken })),
      setSession: (session) => setData((prev) => ({ ...prev, session })),
      setTurn: (turn) => setData((prev) => ({ ...prev, turn })),
      clearError: () => setError(null),
    }),
    [data, token, loading, error],
  );

  return <InterviewContext.Provider value={value}>{children}</InterviewContext.Provider>;
}

export function useInterview(): InterviewContextValue {
  const context = useContext(InterviewContext);
  if (!context) {
    throw new Error('useInterview must be used within an InterviewProvider');
  }
  return context;
}

export function recoveryTokenKey(sessionId: string): string {
  return `zios:recoveryToken:${sessionId}`;
}

export const SESSION_ID_KEY = 'zios:sessionId';

export function storeRecovery(sessionId: string, recoveryToken: string): void {
  try {
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    sessionStorage.setItem(recoveryTokenKey(sessionId), recoveryToken);
  } catch {
    // Ignore storage failures; recovery is a best-effort convenience.
  }
}

export function loadRecovery(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(recoveryTokenKey(sessionId));
  } catch {
    return null;
  }
}

export function loadStoredSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_ID_KEY);
  } catch {
    return null;
  }
}

export function answerDraftKey(sessionId: string): string {
  return `zios:answerDraft:${sessionId}`;
}

export function storeAnswerDraft(sessionId: string, draft: string): void {
  try {
    if (draft.trim()) {
      sessionStorage.setItem(answerDraftKey(sessionId), draft);
    } else {
      sessionStorage.removeItem(answerDraftKey(sessionId));
    }
  } catch {
    // Ignore storage failures.
  }
}

export function loadAnswerDraft(sessionId: string): string {
  try {
    return sessionStorage.getItem(answerDraftKey(sessionId)) ?? '';
  } catch {
    return '';
  }
}
