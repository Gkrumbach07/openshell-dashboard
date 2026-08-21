import {
  Breadcrumb,
  BreadcrumbItem,
  PageBreadcrumb,
} from '@patternfly/react-core';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';

import GatewayOverviewPage from '../pages/GatewayOverviewPage';
import WorkspaceListPage from '../pages/WorkspaceListPage';
import WorkspaceDetailPage from '../pages/WorkspaceDetailPage';
import SandboxDetailPage from '../pages/SandboxDetailPage';
import ProviderDetailPage from '../pages/ProviderDetailPage';
import GlobalPolicyPage from '../pages/GlobalPolicyPage';
import SettingsPage from '../pages/SettingsPage';
import { useUserRole } from '../api/rbac';
import { useI18n } from '../i18n';
import AppLayout from './AppLayout';

const WorkspaceListRoute: React.FC = () => {
  const navigate = useNavigate();
  return (
    <WorkspaceListPage onSelect={(name) => navigate(`/workspaces/${name}`)} />
  );
};

const WorkspaceCrumbs: React.FC<{ workspace: string; leaf?: string }> = ({
  workspace,
  leaf,
}) => {
  const { t } = useI18n('common');
  return (
    <PageBreadcrumb>
      <Breadcrumb>
        <BreadcrumbItem
          render={({ className }) => (
            <Link className={className} to="/workspaces">
              {t('nav.workspaces')}
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
};

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

const AuthenticatedRoutes: React.FC = () => (
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

export default AuthenticatedRoutes;
