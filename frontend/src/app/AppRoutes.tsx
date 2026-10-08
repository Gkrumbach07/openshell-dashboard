import { useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Content,
  Spinner,
} from '@patternfly/react-core';
import { Route, Routes } from 'react-router-dom';

import LoginPage from '../pages/LoginPage';
import { useAuthConfig, useCurrentUser } from '../api/auth';
import type { ApiError } from '../api/client';
import { setSessionExpiredHandler } from '../api/client';
import { useI18n } from '../i18n';
import AuthenticatedRoutes from './AuthenticatedRoutes';
import AuthRequiredPage from './AuthRequiredPage';
import { clearDevSession, isDevSession } from './authStore';
import {
  clearProxyReauthReloadFlag,
  reloadPageForProxyReauth,
  reloadOnceForProxyReauth,
} from './authSession';

const isUnauthorized = (error: unknown): boolean =>
  (error as ApiError)?.status === 401;

const AuthBootstrapLoading: React.FC = () => {
  const { t } = useI18n('auth');
  return (
    <Bullseye style={{ minHeight: '100vh' }}>
      <Spinner aria-label={t('sessionLoading')} />
    </Bullseye>
  );
};

const AppRoutes: React.FC = () => {
  const { t } = useI18n('auth');
  const { t: tCommon } = useI18n('common');
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

    if (!authRequired || !user || whoamiError) {
      setSessionExpiredHandler(null);
      return;
    }

    clearProxyReauthReloadFlag();
    setSessionExpiredHandler(reloadOnceForProxyReauth);
    return () => setSessionExpiredHandler(null);
  }, [config?.authDisabled, devAuthenticated, authRequired, user, whoamiError]);

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

  if (whoamiError) {
    const apiError = whoamiQueryError as ApiError | null;
    if (isUnauthorized(apiError) && apiError?.code !== 'unauthenticated') {
      return <AuthRequiredPage />;
    }
    const rejected = isUnauthorized(apiError);
    const message = rejected
      ? t('sessionRejectedBody')
      : typeof apiError?.status === 'number'
        ? apiError.message
        : t('sessionBffUnreachable');
    const guidance =
      apiError?.code === 'gateway_unavailable'
        ? t('sessionGatewayUnavailableHelp')
        : apiError?.code === 'permission_denied'
          ? t('sessionPermissionDeniedHelp')
          : null;
    return (
      <Bullseye style={{ minHeight: '100vh' }}>
        <Alert
          variant="danger"
          title={
            rejected ? t('sessionRejectedTitle') : t('sessionVerifyFailed')
          }
          actionLinks={
            <Button
              variant="link"
              onClick={
                rejected ? reloadPageForProxyReauth : () => void refetchWhoami()
              }
            >
              {rejected ? t('sessionReload') : tCommon('actions.retry')}
            </Button>
          }
        >
          <Content component="p">{message}</Content>
          {guidance && <Content component="p">{guidance}</Content>}
        </Alert>
      </Bullseye>
    );
  }

  if (!user) {
    return null;
  }

  return <AuthenticatedRoutes />;
};

export default AppRoutes;
