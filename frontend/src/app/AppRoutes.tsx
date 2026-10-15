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
  reloadOnceForProxyReauth,
} from './authSession';
import { redirectToProxySignOut } from './logout';

const isTransientWhoamiError = (error: unknown): boolean => {
  const status = (error as ApiError)?.status;
  return (
    typeof status !== 'number' ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
};

const AuthBootstrapLoading: React.FC = () => {
  const { t } = useI18n('auth');
  return (
    <Bullseye className="pf-v6-u-h-100vh">
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
    isFetching: whoamiFetching,
    isError: whoamiError,
    error: whoamiQueryError,
    refetch: refetchWhoami,
  } = useCurrentUser({
    enabled: authRequired,
    notifySessionExpired: false,
  });
  const cachedTransientError = Boolean(
    user && whoamiError && isTransientWhoamiError(whoamiQueryError),
  );

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

    if (!authRequired || !user || (whoamiError && !cachedTransientError)) {
      setSessionExpiredHandler(null);
      return;
    }

    if (!whoamiError && !whoamiFetching) {
      clearProxyReauthReloadFlag();
    }
    setSessionExpiredHandler(reloadOnceForProxyReauth);
    return () => setSessionExpiredHandler(null);
  }, [
    config?.authDisabled,
    devAuthenticated,
    authRequired,
    user,
    whoamiError,
    whoamiFetching,
    cachedTransientError,
  ]);

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

  let sessionAlert: React.ReactNode;
  if (whoamiError) {
    const apiError = whoamiQueryError as ApiError | null;
    if (apiError?.status === 401 && apiError.code === 'unauthorized') {
      return <AuthRequiredPage />;
    }
    const unauthorized = apiError?.status === 401;
    const accessDenied = apiError?.status === 403;
    const signOut = unauthorized || accessDenied;
    const rejected = unauthorized && apiError?.code === 'unauthenticated';
    const message = rejected
      ? apiError.message
      : unauthorized
        ? t('sessionUnknownUnauthorizedBody')
        : typeof apiError?.status === 'number'
          ? apiError.message
          : t('sessionBffUnreachable');
    const guidance = unauthorized
      ? t('sessionRejectedBody')
      : accessDenied
        ? t('sessionPermissionDeniedHelp')
        : apiError?.code === 'gateway_unavailable'
          ? t('sessionGatewayUnavailableHelp')
          : null;
    sessionAlert = (
      <Alert
        variant="danger"
        isInline={cachedTransientError}
        title={rejected ? t('sessionRejectedTitle') : t('sessionVerifyFailed')}
        actionLinks={
          <Button
            variant="link"
            onClick={
              signOut
                ? () => redirectToProxySignOut(config.logoutUrl)
                : () => void refetchWhoami()
            }
          >
            {signOut ? t('sessionSignOut') : tCommon('actions.retry')}
          </Button>
        }
      >
        <Content component="p">{message}</Content>
        {guidance && <Content component="p">{guidance}</Content>}
      </Alert>
    );
    if (!cachedTransientError) {
      return <Bullseye className="pf-v6-u-h-100vh">{sessionAlert}</Bullseye>;
    }
  }

  if (!user) {
    return null;
  }

  return <AuthenticatedRoutes sessionAlert={sessionAlert} />;
};

export default AppRoutes;
