import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/guards';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './pages/auth/LoginPage';
import { WelcomePage } from './pages/auth/WelcomePage';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';
import { ShellLayout } from './pages/shell/ShellLayout';
import { DashboardPage } from './pages/shell/DashboardPage';
import { CandidatesPage } from './pages/shell/CandidatesPage';
import { AnalyticsPage } from './pages/shell/AnalyticsPage';
import { InterviewsListPage } from './pages/reports/InterviewsListPage';
import { InterviewDetailPage } from './pages/reports/InterviewDetailPage';
import { ShareReportPage } from './pages/reports/ShareReportPage';
import { KitsListPage } from './pages/kits/KitsListPage';
import { TemplateGalleryPage } from './pages/kits/TemplateGalleryPage';
import { KitBuilderPage } from './pages/kits/KitBuilderPage';
import { KitPreviewPage } from './pages/kits/KitPreviewPage';
import { DesignSystemPage } from './pages/design-system/DesignSystemPage';

function RootProviders() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </AuthProvider>
  );
}

/**
 * Route map:
 *   /login          public-only — email → OTP → verify (bounces signed-in users)
 *   /accept-invite  protected  — FR-E1-3 invite acceptance (token in query)
 *   /welcome        protected  — post-signup workspace view (isNewUser)
 *   /kits/:id/preview protected — preview-as-candidate takeover (FR-E2-6, no shell)
 *   /               protected shell (RecruiterLayout port)
 *     index                    Dashboard
 *     /kits                    Kit list + create (FR-E2-1)
 *     /kits/new                Template gallery (FR-E2-7)
 *     /kits/:id                Kit builder (FR-E2-1…E2-5)
 *     /candidates              Candidates
 *     /interviews              Interview pipeline (Phase 04 dashboard)
 *     /interviews/:sessionId   Evidence-linked report + transcript (Phase 04)
 *     /analytics               Analytics
 *   /share/:token   public     — read-only shared report (Phase 04)
 *   /design-system  public     — @zios/ui catalog
 */
const router = createBrowserRouter([
  {
    element: <RootProviders />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/accept-invite',
        element: (
          <RequireAuth>
            <AcceptInvitePage />
          </RequireAuth>
        ),
      },
      {
        path: '/welcome',
        element: (
          <RequireAuth>
            <WelcomePage />
          </RequireAuth>
        ),
      },
      {
        path: '/kits/:kitId/preview',
        element: (
          <RequireAuth>
            <KitPreviewPage />
          </RequireAuth>
        ),
      },
      {
        path: '/',
        element: (
          <RequireAuth>
            <ShellLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'kits', element: <KitsListPage /> },
          { path: 'kits/new', element: <TemplateGalleryPage /> },
          { path: 'kits/:kitId', element: <KitBuilderPage /> },
          { path: 'candidates', element: <CandidatesPage /> },
          { path: 'interviews', element: <InterviewsListPage /> },
          { path: 'interviews/:sessionId', element: <InterviewDetailPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
        ],
      },
      { path: '/share/:token', element: <ShareReportPage /> },
      { path: '/design-system', element: <DesignSystemPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
