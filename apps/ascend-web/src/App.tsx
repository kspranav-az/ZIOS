import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { getToken } from './auth';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PracticeConsentPage } from './pages/PracticeConsentPage';
import { PracticeInterviewPage } from './pages/PracticeInterviewPage';
import { PracticeReportPage } from './pages/PracticeReportPage';
import { PracticeSetupPage } from './pages/PracticeSetupPage';
import { ResumePage } from './pages/ResumePage';

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
      { path: '/', element: <HomePage /> },
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/practice', element: <PracticeSetupPage /> },
      { path: '/resume', element: <ResumePage /> },
      { path: '/practice/:sessionId/consent', element: <PracticeConsentPage /> },
      { path: '/practice/:sessionId/interview', element: <PracticeInterviewPage /> },
      { path: '/practice/:sessionId/report', element: <PracticeReportPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
