import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  CodeBlock,
  CodeBlockCode,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Label,
  LabelGroup,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubeIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';

import { useDeleteTemplate, useTemplates } from '../api/templates';
import { useWorkspaceRole } from '../api/rbac';
import { useAlerts } from '../app/AlertContext';
import { deletionOutcome, describeDeletion } from '../utils/deletion';
import { formatAge } from '../utils/formatters';
import { formatDurationMs } from '../utils/sandboxOptions';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import CreateSandboxFromTemplateModal from './CreateSandboxFromTemplateModal';
import CreateTemplateModal from './CreateTemplateModal';
import LabelsList from './LabelsList';
import RefreshErrorAlert, { isRefreshError } from './RefreshErrorAlert';
import type { SandboxTemplate } from '../types';

type TemplatesTabProps = {
  workspace: string;
};

const resourceSummary = (template: SandboxTemplate): string => {
  const resources = template.spec.workload?.resources;
  if (!resources) {
    return '-';
  }
  const parts: string[] = [];
  if (resources.cpu) {
    parts.push(`${resources.cpu} CPU`);
  }
  if (resources.memory) {
    parts.push(resources.memory);
  }
  if (resources.gpu) {
    parts.push(
      resources.gpu.count !== undefined
        ? `${resources.gpu.count} GPU`
        : 'default GPU',
    );
  }
  return parts.length > 0 ? parts.join(' · ') : '-';
};

// The startup service level of a template: the time a sandbox made from it
// should be ready within, and the startup burst, as far as either is set.
export const startupSummary = (template: SandboxTemplate): string => {
  const startup = template.spec.desiredServiceLevel?.startup;
  const parts: string[] = [];
  if (startup?.readyWithinMs) {
    parts.push(`ready within ${formatDurationMs(startup.readyWithinMs)}`);
  }
  if (startup?.maxBurst) {
    parts.push(`burst ${startup.maxBurst}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '-';
};

const TemplatesTab: React.FC<TemplatesTabProps> = ({ workspace }) => {
  const templates = useTemplates(workspace);
  const deleteTemplate = useDeleteTemplate(workspace);
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const { addAlert } = useAlerts();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [useTarget, setUseTarget] = useState<string | null>(null);
  // The templates whose row is expanded to show what does not fit a column.
  const [expanded, setExpanded] = useState<string[]>([]);

  if (templates.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading templates" />
      </Bullseye>
    );
  }

  // The templates are re-read while the tab is open. A refresh that fails
  // leaves the list, and a form open over it, as they were, with a note
  // above; only a list that never loaded is replaced by the error.
  const refreshFailed = isRefreshError(templates);
  if (templates.isError && !refreshFailed) {
    return (
      <Alert
        variant="danger"
        title="Failed to load templates"
        actionLinks={
          <Button variant="link" onClick={() => templates.refetch()}>
            Retry
          </Button>
        }
      >
        {(templates.error as Error).message}
      </Alert>
    );
  }

  const rows = templates.data ?? [];

  const refreshNote = refreshFailed && (
    <RefreshErrorAlert
      title="The templates could not be refreshed"
      error={templates.error}
      onRetry={() => templates.refetch()}
      className="pf-v6-u-mb-md"
      data-testid="templates-refresh-error"
    />
  );

  const modals = (
    <>
      <CreateTemplateModal
        workspace={workspace}
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
      />
      {useTarget && (
        <CreateSandboxFromTemplateModal
          workspace={workspace}
          templateName={useTarget}
          isOpen={useTarget !== null}
          onClose={() => setUseTarget(null)}
        />
      )}
      <ConfirmDeleteModal
        title="Delete template?"
        body={`Template "${deleteTarget ?? ''}" will be deleted. Sandboxes already created from it keep running.`}
        isOpen={deleteTarget !== null}
        isDeleting={deleteTemplate.isPending}
        error={
          deleteTemplate.isError
            ? (deleteTemplate.error as Error).message
            : undefined
        }
        onConfirm={() => {
          if (deleteTarget) {
            deleteTemplate.mutate(deleteTarget, {
              onSuccess: (result) => {
                const notice = describeDeletion(
                  { singular: 'template', plural: 'templates' },
                  deleteTarget,
                  deletionOutcome(result),
                );
                addAlert(notice.title, notice.variant);
                setDeleteTarget(null);
                deleteTemplate.reset();
              },
            });
          }
        }}
        onCancel={() => {
          setDeleteTarget(null);
          deleteTemplate.reset();
        }}
      />
    </>
  );

  const emptyState = (
    <EmptyState variant="lg" titleText="No templates" icon={CubeIcon}>
      <EmptyStateBody>
        Templates are reusable workload shapes (image, environment, resources).
        Create one to spin up sandboxes — such as a claude, codex, or opencode
        harness — with a single click.
      </EmptyStateBody>
      {isWorkspaceAdmin && (
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button
              onClick={() => setCreateOpen(true)}
              data-testid="create-template-empty"
            >
              Create template
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      )}
    </EmptyState>
  );

  const list = (
    <>
      {isWorkspaceAdmin && (
        <Toolbar aria-label="Template actions">
          <ToolbarContent>
            <ToolbarItem>
              <Button
                onClick={() => setCreateOpen(true)}
                data-testid="create-template"
              >
                Create template
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      )}
      <Table aria-label="Templates" data-testid="templates-table">
        <Thead>
          <Tr>
            <Th screenReaderText="Details" />
            <Th>Name</Th>
            <Th>Image</Th>
            <Th>Resources</Th>
            <Th>Startup</Th>
            <Th>Labels</Th>
            <Th>Age</Th>
            <Th screenReaderText="Actions" />
          </Tr>
        </Thead>
        {rows.map((template, rowIndex) => {
          const labels = template.metadata.labels ?? {};
          const name = template.metadata.name;
          const isExpanded = expanded.includes(name);
          const driverConfig = template.spec.driverConfig;
          return (
            <Tbody key={name} isExpanded={isExpanded}>
              <Tr>
                <Td
                  expand={{
                    rowIndex,
                    isExpanded,
                    onToggle: () =>
                      setExpanded((current) =>
                        isExpanded
                          ? current.filter((item) => item !== name)
                          : [...current, name],
                      ),
                    expandId: 'template-details',
                  }}
                  data-testid={`template-expand-${name}`}
                />
                <Td dataLabel="Name">
                  <strong>{template.metadata.name}</strong>
                </Td>
                {/* An image pinned by digest is one long word. Left unbroken
                    it pushes every column after it out of view. */}
                <Td
                  dataLabel="Image"
                  modifier="breakWord"
                  data-testid={`template-image-${name}`}
                >
                  {/* A template without an image is one for the gateway's
                      default image, which the CLI lists as "<default>". */}
                  {template.spec.workload?.image ? (
                    <span className="pf-v6-u-font-family-monospace">
                      {template.spec.workload.image}
                    </span>
                  ) : (
                    'Gateway default'
                  )}
                </Td>
                <Td dataLabel="Resources">{resourceSummary(template)}</Td>
                <Td
                  dataLabel="Startup"
                  modifier="nowrap"
                  data-testid={`template-startup-${name}`}
                >
                  {startupSummary(template)}
                </Td>
                <Td dataLabel="Labels">
                  {Object.keys(labels).length === 0 ? (
                    '-'
                  ) : (
                    <LabelGroup numLabels={4}>
                      {Object.entries(labels).map(([key, value]) => (
                        <Label key={key} isCompact color="blue">
                          {key}={value}
                        </Label>
                      ))}
                    </LabelGroup>
                  )}
                </Td>
                <Td dataLabel="Age">
                  {formatAge(template.metadata.createdAtMs)}
                </Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      {
                        title: 'Create sandbox',
                        onClick: () => setUseTarget(template.metadata.name),
                      },
                      ...(isWorkspaceAdmin
                        ? [
                            {
                              title: 'Delete',
                              onClick: () =>
                                setDeleteTarget(template.metadata.name),
                            },
                          ]
                        : []),
                    ]}
                  />
                </Td>
              </Tr>
              <Tr isExpanded={isExpanded}>
                <Td />
                <Td colSpan={7} dataLabel="Details">
                  <ExpandableRowContent>
                    <DescriptionList
                      isHorizontal
                      isCompact
                      data-testid={`template-details-${name}`}
                    >
                      <DescriptionListGroup>
                        <DescriptionListTerm>Environment</DescriptionListTerm>
                        <DescriptionListDescription>
                          <LabelsList
                            labels={template.spec.workload?.environment}
                          />
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Annotations</DescriptionListTerm>
                        <DescriptionListDescription>
                          <LabelsList labels={template.metadata.annotations} />
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Driver config</DescriptionListTerm>
                        <DescriptionListDescription>
                          {driverConfig &&
                          Object.keys(driverConfig).length > 0 ? (
                            <CodeBlock>
                              <CodeBlockCode>
                                {JSON.stringify(driverConfig, null, 2)}
                              </CodeBlockCode>
                            </CodeBlock>
                          ) : (
                            '-'
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </ExpandableRowContent>
                </Td>
              </Tr>
            </Tbody>
          );
        })}
      </Table>
    </>
  );

  // The empty state and the list take turns in one place, and the dialogs
  // follow in a place of their own. A poll that takes the list from empty to
  // not empty, or back, then swaps what is in that one place and leaves an
  // open form, and what was typed into it, where it is.
  return (
    <>
      {refreshNote}
      {rows.length === 0 ? emptyState : list}
      {modals}
    </>
  );
};

export default TemplatesTab;
