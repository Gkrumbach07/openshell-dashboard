import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Breadcrumb,
  BreadcrumbItem,
  PageBreadcrumb,
} from '@patternfly/react-core';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';

import { SlotProvider } from '../slots';
import LoginPage from '../pages/LoginPage';
import GatewayOverviewPage from '../pages/GatewayOverviewPage';
import WorkspaceListPage from '../pages/WorkspaceListPage';
import WorkspaceDetailPage from '../pages/WorkspaceDetailPage';
import SandboxDetailPage from '../pages/SandboxDetailPage';
import ProviderDetailPage from '../pages/ProviderDetailPage';
import GlobalPolicyPage from '../pages/GlobalPolicyPage';
import SettingsPage from '../pages/SettingsPage';
import { AlertProvider } from './AlertContext';
import AppLayout from './AppLayout';
import AuthCallbackPage from './AuthCallbackPage';
import { useAuthConfig } from '../api/auth';
import { useUserRole } from '../api/rbac';
import { hasSession, isDevSession } from './authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const WorkspaceListRoute: React.FC = () => {
  const navigate = useNavigate();
  return (
    <WorkspaceListPage onSelect={(name) => navigate(`/workspaces/${name}`)} />
  );
};

const WorkspaceCrumbs: React.FC<{ workspace: string; leaf?: string }> = ({
  workspace,
  leaf,
}) => (
  <PageBreadcrumb>
    <Breadcrumb>
      <BreadcrumbItem
        render={({ className }) => (
          <Link className={className} to="/workspaces">
            Workspaces
          </Link>
        )}
      />
      {leaf ? (
        <>
          <BreadcrumbItem
            render={({ className }) => (
              <Link className={className} to={`/workspaces/${workspace}`}>
                {workspace}
              </Link>
            )}
          />
          <BreadcrumbItem isActive>{leaf}</BreadcrumbItem>
        </>
      ) : (
        <BreadcrumbItem isActive>{workspace}</BreadcrumbItem>
      )}
    </Breadcrumb>
  </PageBreadcrumb>
);

const WorkspaceDetailRoute: React.FC = () => {
  const { workspace } = useParams<{ workspace: string }>();
  const navigate = useNavigate();
  if (!workspace) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <>
      <WorkspaceCrumbs workspace={workspace} />
      <WorkspaceDetailPage
        workspace={workspace}
        onSelectSandbox={(name) =>
          navigate(`/workspaces/${workspace}/sandboxes/${name}`)
        }
        onSelectProvider={(name) =>
          navigate(`/workspaces/${workspace}/providers/${name}`)
        }
      />
    </>
  );
};

const SandboxDetailRoute: React.FC = () => {
  const { workspace, sandbox } = useParams<{
    workspace: string;
    sandbox: string;
  }>();
  if (!workspace || !sandbox) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <>
      <WorkspaceCrumbs workspace={workspace} leaf={sandbox} />
      <SandboxDetailPage workspace={workspace} sandboxName={sandbox} />
    </>
  );
};

const ProviderDetailRoute: React.FC = () => {
  const { workspace, provider } = useParams<{
    workspace: string;
    provider: string;
  }>();
  if (!workspace || !provider) {
    return <Navigate to="/workspaces" replace />;
  }
  return (
    <>
      <WorkspaceCrumbs workspace={workspace} leaf={provider} />
      <ProviderDetailPage workspace={workspace} providerName={provider} />
    </>
  );
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isPlatformAdmin, isLoading } = useUserRole();
  if (isLoading) {
    return null;
  }
  if (!isPlatformAdmin) {
    return <Navigate to="/workspaces" replace />;
  }
  return <>{children}</>;
};

const AuthenticatedApp: React.FC = () => (
  <AppLayout>
    <Routes>
      <Route
        path="/gateway"
        element={
          <AdminRoute>
            <GatewayOverviewPage />
          </AdminRoute>
        }
      />
      <Route
        path="/global-policy"
        element={
          <AdminRoute>
            <GlobalPolicyPage />
          </AdminRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <AdminRoute>
            <SettingsPage />
          </AdminRoute>
        }
      />
      <Route path="/workspaces" element={<WorkspaceListRoute />} />
      <Route path="/workspaces/:workspace" element={<WorkspaceDetailRoute />} />
      <Route
        path="/workspaces/:workspace/sandboxes/:sandbox"
        element={<SandboxDetailRoute />}
      />
      <Route
        path="/workspaces/:workspace/providers/:provider"
        element={<ProviderDetailRoute />}
      />
      <Route path="*" element={<Navigate to="/workspaces" replace />} />
    </Routes>
  </AppLayout>
);

const AppRoutes: React.FC = () => {
  const { data: config, isLoading } = useAuthConfig();
  const [authenticated, setAuthenticated] = useState(hasSession());

  if (isLoading) {
    return null;
  }

  // Dev mode (AUTH_DISABLED=true): show login page for "Continue as developer".
  if (config?.authDisabled) {
    if (authenticated) {
      return <AuthenticatedApp />;
    }
    return (
      <Routes>
        <Route
          path="*"
          element={
            <LoginPage
              config={config}
              onAuthenticated={() => setAuthenticated(true)}
            />
          }
        />
      </Routes>
    );
  }

  // Standalone OIDC mode: issuer/clientId configured, frontend handles login.
  if (config?.issuer && config?.clientId) {
    return (
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/login"
          element={
            authenticated ? (
              <Navigate to="/workspaces" replace />
            ) : (
              <LoginPage
                config={config}
                onAuthenticated={() => setAuthenticated(true)}
              />
            )
          }
        />
        <Route
          path="*"
          element={
            authenticated ? (
              <AuthenticatedApp />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    );
  }

  // Proxy-delegated mode: no issuer configured, auth proxy handles login.
  return <AuthenticatedApp />;
};

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <SlotProvider slots={{}}>
      <AlertProvider>
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AppRoutes />
        </BrowserRouter>
      </AlertProvider>
    </SlotProvider>
  </QueryClientProvider>
);

export default App;
