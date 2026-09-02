import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
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
import { formatAge } from '../utils/formatters';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import CreateSandboxFromTemplateModal from './CreateSandboxFromTemplateModal';
import CreateTemplateModal from './CreateTemplateModal';
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
      resources.gpu.count ? `${resources.gpu.count} GPU` : 'default GPU',
    );
  }
  return parts.length > 0 ? parts.join(' · ') : '-';
};

const TemplatesTab: React.FC<TemplatesTabProps> = ({ workspace }) => {
  const templates = useTemplates(workspace);
  const deleteTemplate = useDeleteTemplate(workspace);
  const { isWorkspaceAdmin } = useWorkspaceRole(workspace);
  const { addSuccess } = useAlerts();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [useTarget, setUseTarget] = useState<string | null>(null);

  if (templates.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading templates" />
      </Bullseye>
    );
  }

  if (templates.isError) {
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
              onSuccess: () => {
                addSuccess(`Template "${deleteTarget}" deleted`);
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

  if (rows.length === 0) {
    return (
      <>
        <EmptyState variant="lg" titleText="No templates" icon={CubeIcon}>
          <EmptyStateBody>
            Templates are reusable workload shapes (image, environment,
            resources). Create one to spin up sandboxes — such as a claude,
            codex, or opencode harness — with a single click.
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
        {modals}
      </>
    );
  }

  return (
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
            <Th>Name</Th>
            <Th>Image</Th>
            <Th>Resources</Th>
            <Th>Labels</Th>
            <Th>Age</Th>
            <Th screenReaderText="Actions" />
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((template) => {
            const labels = template.metadata.labels ?? {};
            return (
              <Tr key={template.metadata.name}>
                <Td dataLabel="Name">
                  <strong>{template.metadata.name}</strong>
                </Td>
                <Td dataLabel="Image">
                  <span className="pf-v6-u-font-family-monospace">
                    {template.spec.workload?.image ?? '-'}
                  </span>
                </Td>
                <Td dataLabel="Resources">{resourceSummary(template)}</Td>
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
            );
          })}
        </Tbody>
      </Table>
      {modals}
    </>
  );
};

export default TemplatesTab;
