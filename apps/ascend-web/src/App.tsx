import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { getToken } from './auth';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';

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
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
