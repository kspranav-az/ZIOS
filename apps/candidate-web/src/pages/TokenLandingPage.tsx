import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiErrorResponse, resolveInviteByToken } from '../api';
import { loadRecovery, SESSION_ID_KEY, storeRecovery, useInterview } from '../InterviewContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';

export function TokenLandingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token, setToken, setLoading, setError, setResolvedData, error, loading } = useInterview();

  useEffect(() => {
    const rawToken = searchParams.get('token');
    if (!rawToken) {
      setError('No invite link found. Please check the URL or contact your recruiter.');
      setLoading(false);
      return;
    }
    if (token === rawToken && !loading) return;

    setToken(rawToken);
    setLoading(true);
    setError(null);

    resolveInviteByToken(rawToken)
      .then((data) => {
        setResolvedData({
          invite: data.invite,
          candidate: data.candidate,
          kit: data.kit,
          questions: data.questions,
          session: data.session,
          consent: data.consent,
          recoveryToken: null,
          turn: null,
        });

        // Already completed — go straight to the thank-you page.
        if (data.invite.status === 'completed' || data.session?.status === 'completed') {
          navigate('/complete', { replace: true });
          return;
        }

        // Expired invite.
        if (data.invite.status === 'expired' || new Date(data.invite.expiresAt) < new Date()) {
          navigate('/expired', { replace: true });
          return;
        }

        // OTP gate.
        if (data.otpRequired && !data.otpVerified) {
          navigate('/otp', { replace: true });
          return;
        }

        // Recover an existing live/preflight session.
        if (
          data.session &&
          (data.session.status === 'live' || data.session.status === 'preflight')
        ) {
          const storedSessionId = sessionStorage.getItem(SESSION_ID_KEY);
          const recoveryToken =
            storedSessionId === data.session.id ? loadRecovery(data.session.id) : null;
          if (recoveryToken) {
            storeRecovery(data.session.id, recoveryToken);
            setResolvedData({ recoveryToken });
          }
          // Human-facilitated video interviews use the live room, not the AI text flow.
          if (data.session.conductor === 'human' && data.session.mode === 'video') {
            navigate('/live', { replace: true });
          } else {
            navigate('/interview', { replace: true });
          }
          return;
        }

        // Fresh invite — show consent.
        navigate('/consent', { replace: true });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiErrorResponse) {
          setError(err.message || 'This invite link is invalid or has expired.');
        } else {
          setError('Unable to reach InterviewOS. Please check your connection and try again.');
        }
      })
      .finally(() => setLoading(false));
  }, [searchParams, navigate, setToken, setLoading, setError, setResolvedData, token, loading]);

  if (loading) return <LoadingState message="Loading your interview…" />;
  if (error) {
    return (
      <ErrorState
        title="Invite link issue"
        message={error}
        onRetry={() => {
          setError(null);
          setLoading(true);
          window.location.reload();
        }}
        onReturnHome={() => {
          window.location.href = '/';
        }}
      />
    );
  }
  return <LoadingState message="Loading your interview…" />;
}
