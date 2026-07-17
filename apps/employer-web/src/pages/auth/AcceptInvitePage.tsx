import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, BrandLogo, Button, Card, Icon } from '@zios/ui';
import { useAuth } from '../../auth/AuthContext';
import { ApiRequestError } from '../../lib/api';
import { authApi } from '../../lib/auth-api';
import { userMessageForError } from '../../lib/errors';

type AcceptState =
  | { kind: 'accepting' }
  | { kind: 'success'; orgName: string }
  | { kind: 'error'; code: string; message: string };

/**
 * Invite acceptance (FR-E1-3). The accept route requires an authenticated
 * session whose email matches the invite, so the full journey is:
 * click email link → (redirected to /login if needed) → OTP sign-in →
 * land back here → accept. INVITE_EMAIL_MISMATCH gets a dedicated state
 * with a sign-out-and-retry path.
 */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const { state, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [acceptState, setAcceptState] = useState<AcceptState>({ kind: 'accepting' });
  const attempted = useRef(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (state.status !== 'authenticated' || !token || attempted.current) return;
    attempted.current = true;

    authApi
      .acceptInvite(token)
      .then(async (response) => {
        // Membership moved us into a different org — re-resolve the session.
        await refresh();
        setAcceptState({ kind: 'success', orgName: response.org.name });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError) {
          setAcceptState({
            kind: 'error',
            code: error.code,
            message: userMessageForError(error),
          });
        } else {
          setAcceptState({
            kind: 'error',
            code: 'UNKNOWN_ERROR',
            message: userMessageForError(error),
          });
        }
      });
  }, [state.status, token, refresh]);

  async function handleSignInWithInvitedEmail() {
    await logout();
    navigate('/login', { state: { from: location }, replace: true });
  }

  const email = state.status === 'authenticated' ? state.user.email : null;

  return (
    <div className="min-h-screen bg-background text-on-background font-sans flex items-center justify-center p-5">
      <Card radius="2xl" padding="lg" className="w-full max-w-lg text-center space-y-8">
        <div className="flex justify-center pb-6 border-b border-[#e7edee]">
          <BrandLogo size={132} />
        </div>

        {!token && (
          <StateBlock
            icon="link_off"
            tone="error"
            title="This invite link is incomplete"
            body="The link is missing its token. Ask your admin to send you a fresh invite email and use the exact link from it."
          />
        )}

        {token && acceptState.kind === 'accepting' && (
          <div className="space-y-4" role="status" aria-label="Accepting invite">
            <div className="mx-auto h-10 w-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <p className="text-body-md text-on-surface-variant">Accepting your invite…</p>
          </div>
        )}

        {token && acceptState.kind === 'success' && (
          <div className="space-y-6">
            <StateBlock
              icon="domain_add"
              tone="success"
              title="You're in!"
              body={`You've joined ${acceptState.orgName}. Your workspace is ready.`}
            />
            <Button size="lg" className="w-full" icon="arrow_forward" onClick={() => navigate('/')}>
              Continue to dashboard
            </Button>
          </div>
        )}

        {token && acceptState.kind === 'error' && acceptState.code === 'INVITE_EMAIL_MISMATCH' && (
          <div className="space-y-6">
            <StateBlock
              icon="alternate_email"
              tone="error"
              title="This invite is for a different email"
              body={
                <>
                  {acceptState.message}{' '}
                  {email && (
                    <>
                      You are signed in as{' '}
                      <span className="font-bold text-on-surface">{email}</span>.
                    </>
                  )}
                </>
              }
            />
            <Button
              size="lg"
              className="w-full"
              icon="logout"
              onClick={() => void handleSignInWithInvitedEmail()}
            >
              Sign in with the invited email
            </Button>
          </div>
        )}

        {token && acceptState.kind === 'error' && acceptState.code !== 'INVITE_EMAIL_MISMATCH' && (
          <div className="space-y-6">
            <StateBlock
              icon="error"
              tone="error"
              title="Could not accept invite"
              body={acceptState.message}
            />
            <Button size="lg" variant="outline" className="w-full" onClick={() => navigate('/')}>
              Back to dashboard
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function StateBlock({
  icon,
  tone,
  title,
  body,
}: {
  icon: string;
  tone: 'success' | 'error';
  title: string;
  body: React.ReactNode;
}) {
  const isSuccess = tone === 'success';
  return (
    <div className="space-y-3">
      <div
        className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${
          isSuccess ? 'bg-success/10' : 'bg-error/10'
        }`}
      >
        <Icon
          name={icon}
          className={`text-3xl ${isSuccess ? 'text-success' : 'text-error'}`}
          filled
        />
      </div>
      <h1 className="text-headline-sm font-headline-sm text-primary">{title}</h1>
      <p className="text-body-md text-on-surface-variant">{body}</p>
      {isSuccess && <Badge tone="success">Invite accepted</Badge>}
    </div>
  );
}
