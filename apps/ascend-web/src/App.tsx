import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { getToken } from './auth';
import { AscendLayout } from './components/AscendLayout';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PracticeConsentPage } from './pages/PracticeConsentPage';
import { PracticeInterviewPage } from './pages/PracticeInterviewPage';
import { PracticeLivePage } from './pages/PracticeLivePage';
import { PracticeReportPage } from './pages/PracticeReportPage';
import { PracticeSetupPage } from './pages/PracticeSetupPage';
import { ProgressPage } from './pages/ProgressPage';
import { ResumePage } from './pages/ResumePage';
import { WalletPage } from './pages/WalletPage';

function RequireAuth() {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        // Chrome pages: sidebar + topbar layout. Immersive flows (onboarding,
        // consent, interview) stay chrome-free below.
        element: <AscendLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/practice', element: <PracticeSetupPage /> },
          { path: '/resume', element: <ResumePage /> },
          { path: '/progress', element: <ProgressPage /> },
          { path: '/wallet', element: <WalletPage /> },
          { path: '/practice/:sessionId/report', element: <PracticeReportPage /> },
        ],
      },
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/practice/:sessionId/consent', element: <PracticeConsentPage /> },
      { path: '/practice/:sessionId/interview', element: <PracticeInterviewPage /> },
      { path: '/practice/:sessionId/live', element: <PracticeLivePage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
