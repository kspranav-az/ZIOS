import { useNavigate } from 'react-router-dom';
import { Badge, BrandLogo, Button, Card, Icon } from '@zios/ui';
import { useAuth } from '../../auth/AuthContext';

/**
 * Screen 3 of the signup flow (email → code → workspace): shown right after
 * the first-ever verify, when the api has auto-created the org with this
 * user as admin (AuthResponse.isNewUser).
 */
export function WelcomePage() {
  const { state } = useAuth();
  const navigate = useNavigate();

  if (state.status !== 'authenticated') return null;

  const { user, org } = state;

  return (
    <div className="min-h-screen bg-background text-on-background font-sans flex items-center justify-center p-5">
      <Card radius="2xl" padding="lg" className="w-full max-w-lg text-center space-y-8">
        <div className="flex justify-center pb-6 border-b border-[#e7edee]">
          <BrandLogo size={132} />
        </div>

        <div className="space-y-3">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon name="check_circle" className="text-3xl text-primary" filled />
          </div>
          <h1 className="text-headline-md font-headline-md text-primary">
            Your workspace is ready
          </h1>
          <p className="text-body-md text-on-surface-variant">
            Welcome aboard, {user.name}. We created a workspace for your organization — you are its
            admin.
          </p>
        </div>

        <div className="bg-surface-container-low rounded-2xl px-6 py-5 flex items-center justify-between gap-4">
          <div className="text-left">
            <p className="text-xs font-label-bold uppercase tracking-wider text-on-surface-variant">
              Organization
            </p>
            <p className="text-headline-sm font-headline-sm text-primary">{org.name}</p>
          </div>
          <Badge tone="secondary" icon="workspace_premium">
            {org.plan}
          </Badge>
        </div>

        <Button size="lg" className="w-full" icon="arrow_forward" onClick={() => navigate('/')}>
          Go to your dashboard
        </Button>
      </Card>
    </div>
  );
}
