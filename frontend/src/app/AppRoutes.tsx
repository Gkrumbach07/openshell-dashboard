import { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, Bullseye, Button, Spinner } from '@patternfly/react-core';
import { Route, Routes } from 'react-router-dom';

import LoginPage from '../pages/LoginPage';
import { useAuthConfig, useCurrentUser } from '../api/auth';
import type { ApiError } from '../api/client';
import { setSessionExpiredHandler } from '../api/client';
import AuthenticatedRoutes from './AuthenticatedRoutes';
import AuthRequiredPage from './AuthRequiredPage';
import { clearDevSession, isDevSession } from './authStore';
import {
  clearProxyReauthReloadFlag,
  reloadOnceForProxyReauth,
} from './authSession';

const isUnauthorized = (error: unknown): boolean =>
  (error as ApiError)?.status === 401;

const AuthBootstrapLoading: React.FC = () => (
  <Bullseye style={{ minHeight: '100vh' }}>
    <Spinner aria-label="Loading session" />
  </Bullseye>
);

const AppRoutes: React.FC = () => {
  const { data: config, isLoading: configLoading } = useAuthConfig();
  const [devAuthenticated, setDevAuthenticated] = useState(isDevSession());
  const authRequired = Boolean(config && !config.authDisabled);
  const {
    data: user,
    isPending: whoamiPending,
    isError: whoamiError,
    error: whoamiQueryError,
    refetch: refetchWhoami,
  } = useCurrentUser({ enabled: authRequired });

  // Stale dev-mode flag from a prior `make dev` run must not trigger 401 redirects.
  useLayoutEffect(() => {
    if (config && !config.authDisabled) {
      clearDevSession();
    }
  }, [config]);

  useEffect(() => {
    if (config?.authDisabled) {
      if (!devAuthenticated) {
        setSessionExpiredHandler(null);
        return;
      }
      setSessionExpiredHandler(() => {
        clearDevSession();
        window.location.assign('/login');
      });
      return () => setSessionExpiredHandler(null);
    }

    if (!authRequired || !user) {
      setSessionExpiredHandler(null);
      return;
    }

    clearProxyReauthReloadFlag();
    setSessionExpiredHandler(reloadOnceForProxyReauth);
    return () => setSessionExpiredHandler(null);
  }, [config?.authDisabled, devAuthenticated, authRequired, user]);

  if (configLoading) {
    return <AuthBootstrapLoading />;
  }

  // Dev mode (AUTH_DISABLED=true): show login page for "Continue as developer".
  if (config?.authDisabled) {
    if (devAuthenticated) {
      return <AuthenticatedRoutes />;
    }
    return (
      <Routes>
        <Route
          path="*"
          element={
            <LoginPage
              config={config}
              onAuthenticated={() => setDevAuthenticated(true)}
            />
          }
        />
      </Routes>
    );
  }

  if (!config) {
    return null;
  }

  // Auth-on: prove session via whoami before mounting privileged UI (ADR 0002).
  if (whoamiPending) {
    return <AuthBootstrapLoading />;
  }

  if (!user) {
    if (whoamiError && isUnauthorized(whoamiQueryError)) {
      return <AuthRequiredPage />;
    }
    if (whoamiError) {
      return (
        <Bullseye style={{ minHeight: '100vh' }}>
          <Alert
            variant="danger"
            title="Cannot verify session"
            actionLinks={
              <Button variant="link" onClick={() => void refetchWhoami()}>
                Retry
              </Button>
            }
          >
            Check that the BFF is running and reachable.
          </Alert>
        </Bullseye>
      );
    }
    return null;
  }

  return <AuthenticatedRoutes />;
};

export default AppRoutes;
