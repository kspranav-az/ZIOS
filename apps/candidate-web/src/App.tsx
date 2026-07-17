import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { InterviewProvider } from './InterviewContext';
import { CompletionPage } from './pages/CompletionPage';
import { ConsentPage } from './pages/ConsentPage';
import { ExpiredPage } from './pages/ExpiredPage';
import { InterviewPage } from './pages/InterviewPage';
import { OtpPage } from './pages/OtpPage';
import { VoiceInterviewPage } from './pages/VoiceInterviewPage';
import { PreflightPage } from './pages/PreflightPage';
import { TokenLandingPage } from './pages/TokenLandingPage';

function RootProviders() {
  return (
    <InterviewProvider>
      <Outlet />
    </InterviewProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootProviders />,
    children: [
      { path: '/', element: <TokenLandingPage /> },
      { path: '/otp', element: <OtpPage /> },
      { path: '/consent', element: <ConsentPage /> },
      { path: '/preflight', element: <PreflightPage /> },
      { path: '/interview', element: <InterviewPage /> },
      { path: '/voice', element: <VoiceInterviewPage /> },
      { path: '/complete', element: <CompletionPage /> },
      { path: '/expired', element: <ExpiredPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
