import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Icon, Input, OtpInput } from '@zios/ui';
import { useAuth } from '../../auth/AuthContext';
import { AuthLoadingScreen } from '../../auth/guards';
import { ApiRequestError } from '../../lib/api';
import { retryAfterSeconds, userMessageForError } from '../../lib/errors';
import { formatMmSs, useCountdown } from '../../lib/useCountdown';
import { AuthLayout } from './AuthLayout';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface OtpChallenge {
  email: string;
  /** Timestamp (ms) when the current code stops being valid. */
  expiresAt: number;
  /** Timestamp (ms) before which resend is blocked. */
  resendAvailableAt: number;
}

/**
 * Email + OTP sign-in (FR-E1-1). Three screens max: email → code → workspace.
 * Layout ported from the reference's pages/auth/Login.jsx; the password
 * field and social buttons are gone (passwordless phase; OAuth is Phase 06).
 *
 * The "already signed in" bounce lives here (not in a route guard) so the
 * post-verify navigation (welcome vs. return target) is decided in exactly
 * one place and cannot race a guard redirect.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, requestOtp, verifyOtp } = useAuth();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string>();
  const [otpResetKey, setOtpResetKey] = useState(0);
  const [info, setInfo] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  /** Set once handleVerify has navigated — suppresses the signed-in bounce. */
  const completedRef = useRef(false);

  const resendIn = useCountdown(challenge?.resendAvailableAt ?? null);
  const expiresIn = useCountdown(challenge?.expiresAt ?? null);

  const isEmailValid = EMAIL_PATTERN.test(email.trim());

  /** Where the user was headed before being sent to /login, if anywhere. */
  function fromTarget(): string | null {
    const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
    return from?.pathname ? `${from.pathname}${from.search ?? ''}` : null;
  }

  function destination(): string {
    return fromTarget() ?? '/';
  }

  // Visiting /login while already signed in (e.g. stale bookmark) returns
  // the user to where they were headed.
  useEffect(() => {
    if (state.status === 'authenticated' && !completedRef.current) {
      navigate(destination(), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  async function sendCode(targetEmail: string) {
    const response = await requestOtp(targetEmail);
    const now = Date.now();
    setCode('');
    setChallenge({
      email: targetEmail,
      expiresAt: now + response.expiresInSeconds * 1000,
      resendAvailableAt: now + response.resendAvailableInSeconds * 1000,
    });
  }

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Email address is required.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    setEmailError(undefined);
    setInfo(undefined);
    setSubmitting(true);
    try {
      await sendCode(trimmed);
      setOtpError(undefined);
      setOtpResetKey((key) => key + 1);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'OTP_COOLDOWN') {
        // A code was issued moments ago — let the user type it instead of
        // making them wait on this screen; the resend timer reflects the cooldown.
        const retry = retryAfterSeconds(error) ?? 60;
        setChallenge({
          email: trimmed,
          expiresAt: Date.now() + 600 * 1000,
          resendAvailableAt: Date.now() + retry * 1000,
        });
        setOtpError(undefined);
        setInfo('A code was sent to that address recently — check your inbox for it.');
      } else {
        setEmailError(userMessageForError(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(code: string) {
    if (!challenge || verifying) return;
    setVerifying(true);
    setOtpError(undefined);
    setInfo(undefined);
    try {
      const response = await verifyOtp(challenge.email, code);
      completedRef.current = true;
      // A pending destination (e.g. /accept-invite?token=…) always wins —
      // for a brand-new invitee the accept retry IS the onboarding.
      const from = fromTarget();
      navigate(response.isNewUser && !from ? '/welcome' : (from ?? '/'), { replace: true });
    } catch (error) {
      setOtpError(userMessageForError(error));
      setOtpResetKey((key) => key + 1);
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (!challenge || resendIn > 0) return;
    setSubmitting(true);
    setOtpError(undefined);
    setInfo(undefined);
    try {
      await sendCode(challenge.email);
      setOtpResetKey((key) => key + 1);
      setInfo('A new code is on its way to your inbox.');
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'OTP_COOLDOWN') {
        const retry = retryAfterSeconds(error) ?? 60;
        setChallenge((current) =>
          current ? { ...current, resendAvailableAt: Date.now() + retry * 1000 } : current,
        );
      }
      setOtpError(userMessageForError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') return <AuthLoadingScreen />;
  // Signed-in visitors bounce via the effect above; avoid flashing the form.
  if (state.status === 'authenticated') return <AuthLoadingScreen />;

  if (challenge) {
    return (
      <AuthLayout step={2}>
        <button
          type="button"
          onClick={() => {
            setChallenge(null);
            setCode('');
            setOtpError(undefined);
            setInfo(undefined);
          }}
          className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
        >
          <Icon name="arrow_back" className="text-base" />
          Use a different email
        </button>

        <div className="space-y-2.5">
          <h2 className="text-[30px] font-bold leading-[1.25] text-primary tracking-tight">
            Check your email
          </h2>
          <p className="text-[15px] leading-[1.6] text-on-surface-variant">
            We sent a 6-digit sign-in code to{' '}
            <span className="font-bold text-on-surface">{challenge.email}</span>. Enter it below to
            continue.
          </p>
        </div>

        {info && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-primary bg-primary/5 border border-primary/15 rounded-xl px-4 py-3"
          >
            <Icon name="mark_email_read" className="text-lg" />
            {info}
          </p>
        )}

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length === 6) void handleVerify(code);
            else setOtpError('Enter the 6-digit code from your email.');
          }}
        >
          <div className="space-y-1.5">
            <span className="block text-sm font-bold leading-none text-primary">Sign-in code</span>
            <OtpInput
              length={6}
              onComplete={(value) => void handleVerify(value)}
              onChange={(value) => {
                setCode(value);
                if (otpError) setOtpError(undefined);
              }}
              error={otpError}
              disabled={verifying}
              resetKey={otpResetKey}
            />
            <p className="text-xs text-on-surface-variant flex items-center gap-1.5 pt-1">
              <Icon name="schedule" className="text-sm" />
              {expiresIn > 0
                ? `Code expires in ${formatMmSs(expiresIn)}`
                : 'This code has expired — request a new one.'}
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full" loading={verifying}>
            Verify and sign in
          </Button>
        </form>

        <p className="text-center text-sm leading-[1.6] text-on-surface-variant">
          Didn&apos;t get the code?{' '}
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resendIn > 0 || submitting}
            className="text-secondary font-bold hover:underline disabled:text-outline disabled:no-underline disabled:cursor-not-allowed"
          >
            {resendIn > 0 ? `Resend in ${formatMmSs(resendIn)}` : 'Resend code'}
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout step={1}>
      <div className="space-y-2.5">
        <h2 className="text-[30px] font-bold leading-[1.25] text-primary tracking-tight">
          Welcome back
        </h2>
        <p className="text-[15px] leading-[1.6] text-on-surface-variant">
          Log in to manage your AI-driven interviews and find top talent.
        </p>
      </div>

      <form className="space-y-6" onSubmit={(event) => void handleEmailSubmit(event)} noValidate>
        <Input
          id="email"
          label="Email Address"
          icon="mail"
          type="email"
          placeholder="name@company.com"
          autoComplete="email"
          value={email}
          error={emailError}
          valid={isEmailValid && !emailError}
          onChange={(event) => {
            setEmail(event.target.value);
            if (emailError) setEmailError(undefined);
          }}
        />

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Continue with email
        </Button>
      </form>

      <p className="text-center text-sm leading-[1.6] text-on-surface-variant">
        New to InterviewOS? Entering your work email creates your workspace automatically — no
        password needed.
      </p>
    </AuthLayout>
  );
}
