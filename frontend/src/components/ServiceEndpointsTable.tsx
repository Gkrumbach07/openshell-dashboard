import { Button, Content } from '@patternfly/react-core';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';

import ResourceTable from './ResourceTable';
import type { ResourceTableColumn, ResourceTableQuery } from './ResourceTable';
import type { ServiceEndpoint } from '../types';

type ServiceEndpointsTableProps = {
  query: ResourceTableQuery<ServiceEndpoint>;
  // The workspace every endpoint is in, for the list of one workspace. Leave
  // it out for a list across workspaces: the table then has a workspace
  // column and reads each endpoint's own.
  workspace?: string;
  // Only the list across workspaces has a workspace to select.
  onSelectWorkspace?: (workspace: string) => void;
  onSelectSandbox: (workspace: string, sandboxName: string) => void;
};

// What the CLI prints for a sandbox's unnamed endpoint.
export const serviceDisplayName = (serviceName: string): string =>
  serviceName || '-';

// The service endpoints of more than one sandbox: `openshell service list`
// without a sandbox, for one workspace or, with --all-workspaces, for all of
// them. Read-only; an endpoint is exposed and deleted on its sandbox's
// Services tab, which the sandbox column links to.
const ServiceEndpointsTable: React.FC<ServiceEndpointsTableProps> = ({
  query,
  workspace,
  onSelectWorkspace,
  onSelectSandbox,
}) => {
  const workspaceOf = (endpoint: ServiceEndpoint): string =>
    workspace ?? endpoint.workspace ?? '';

  const columns: ResourceTableColumn<ServiceEndpoint>[] = [
    ...(workspace === undefined
      ? [
          {
            title: 'Workspace',
            render: (endpoint: ServiceEndpoint) => (
              <Button
                variant="link"
                isInline
                onClick={() => onSelectWorkspace?.(workspaceOf(endpoint))}
              >
                {workspaceOf(endpoint)}
              </Button>
            ),
          },
        ]
      : []),
    {
      title: 'Sandbox',
      render: (endpoint) => (
        <Button
          variant="link"
          isInline
          onClick={() =>
            onSelectSandbox(workspaceOf(endpoint), endpoint.sandboxName)
          }
          data-testid={`service-sandbox-link-${workspaceOf(endpoint)}-${endpoint.sandboxName}`}
        >
          {endpoint.sandboxName}
        </Button>
      ),
    },
    {
      title: 'Service',
      render: (endpoint) => serviceDisplayName(endpoint.serviceName),
    },
    {
      title: 'Target',
      render: (endpoint) => (
        <span className="pf-v6-u-font-family-monospace">
          127.0.0.1:{endpoint.targetPort}
        </span>
      ),
    },
    {
      title: 'URL',
      render: (endpoint) =>
        endpoint.url ? (
          <a href={endpoint.url} target="_blank" rel="noopener noreferrer">
            {endpoint.url} <ExternalLinkAltIcon />
          </a>
        ) : (
          <Content component="small">-</Content>
        ),
    },
  ];

  return (
    <ResourceTable
      title="Services"
      testId={workspace === undefined ? 'all-services' : 'workspace-services'}
      query={query}
      columns={columns}
      rowKey={(endpoint) =>
        `${workspaceOf(endpoint)}/${endpoint.sandboxName}/${endpoint.serviceName}`
      }
      filterText={(endpoint) =>
        `${workspaceOf(endpoint)}/${endpoint.sandboxName}/${endpoint.serviceName}`
      }
      filterPlaceholder={
        workspace === undefined
          ? 'Filter by workspace, sandbox or service'
          : 'Filter by sandbox or service'
      }
      emptyBody="No sandbox has a service exposed. Expose one on a sandbox's Services tab, or with `openshell service expose`."
    />
  );
};

export default ServiceEndpointsTable;
