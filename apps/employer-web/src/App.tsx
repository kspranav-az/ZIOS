import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/guards';
import { LoginPage } from './pages/auth/LoginPage';
import { WelcomePage } from './pages/auth/WelcomePage';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';
import { ShellLayout } from './pages/shell/ShellLayout';
import { DashboardPage } from './pages/shell/DashboardPage';
import { CandidatesPage } from './pages/shell/CandidatesPage';
import { InterviewsPage } from './pages/shell/InterviewsPage';
import { AnalyticsPage } from './pages/shell/AnalyticsPage';
import { DesignSystemPage } from './pages/design-system/DesignSystemPage';

/**
 * Route map:
 *   /login          public-only — email → OTP → verify (bounces signed-in users)
 *   /accept-invite  protected  — FR-E1-3 invite acceptance (token in query)
 *   /welcome        protected  — post-signup workspace view (isNewUser)
 *   /               protected shell (RecruiterLayout port)
 *     index                    Dashboard
 *     /candidates              Candidates
 *     /interviews              Interviews
 *     /analytics               Analytics
 *   /design-system  public     — @zios/ui catalog
 */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/accept-invite"
            element={
              <RequireAuth>
                <AcceptInvitePage />
              </RequireAuth>
            }
          />
          <Route
            path="/welcome"
            element={
              <RequireAuth>
                <WelcomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <ShellLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="candidates" element={<CandidatesPage />} />
            <Route path="interviews" element={<InterviewsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
          <Route path="/design-system" element={<DesignSystemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
