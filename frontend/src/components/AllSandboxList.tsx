import { useState } from 'react';
import { Button } from '@patternfly/react-core';

import { useAllSandboxPage } from '../api/allWorkspaces';
import {
  isCursorPagePending,
  useCursorListPage,
  useCursorPageResult,
} from '../hooks/useCursorListPage';
import { combineSandboxLabelSelector } from '../utils/sandboxLabelSelector';
import { formatAge } from '../utils/formatters';
import type { Sandbox } from '../types';
import { ImageReference, scopedName, workspaceOf } from './AllWorkspaceCells';
import LabelsList from './LabelsList';
import PhaseLabel from './PhaseLabel';
import ResourceTable from './ResourceTable';
import type { ResourceTableColumn } from './ResourceTable';

type AllSandboxListProps = {
  onSelectWorkspace: (workspace: string) => void;
  onSelectSandbox: (workspace: string, name: string) => void;
};

// The sandbox tab owns its Gateway cursor, type-label filter and columns.
// Other all-workspaces resources continue to use local table pagination.
const AllSandboxList: React.FC<AllSandboxListProps> = ({
  onSelectWorkspace,
  onSelectSandbox,
}) => {
  const [selector, setSelector] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [filterError, setFilterError] = useState('');
  const pager = useCursorListPage(`${selector}\0${typeLabel}`);
  const combinedSelector = combineSandboxLabelSelector(
    selector,
    typeLabel,
  ).selector;
  const sandboxes = useAllSandboxPage({
    pageSize: pager.perPage,
    pageToken: pager.pageToken,
    labelSelector: combinedSelector || undefined,
  });
  useCursorPageResult(pager, sandboxes);

  const applyFilters = (generic: string, type: string) => {
    const result = combineSandboxLabelSelector(generic, type);
    if (result.error) {
      setFilterError(result.error);
      return;
    }
    setFilterError('');
    setSelector(generic.trim());
    setTypeLabel(type.trim());
  };

  const columns: ResourceTableColumn<Sandbox>[] = [
    {
      title: 'Workspace',
      modifier: 'nowrap',
      render: (sandbox) => (
        <Button
          variant="link"
          isInline
          onClick={() => onSelectWorkspace(workspaceOf(sandbox))}
        >
          {workspaceOf(sandbox)}
        </Button>
      ),
    },
    {
      title: 'Name',
      modifier: 'nowrap',
      render: (sandbox) => (
        <Button
          variant="link"
          isInline
          onClick={() =>
            onSelectSandbox(workspaceOf(sandbox), sandbox.metadata.name)
          }
          data-testid={`sandbox-link-${scopedName(sandbox)}`}
        >
          {sandbox.metadata.name}
        </Button>
      ),
    },
    {
      title: 'Status',
      render: (sandbox) => (
        <PhaseLabel
          phase={sandbox.status.phase}
          exitCode={sandbox.status.exitCode}
        />
      ),
    },
    {
      title: 'Image',
      modifier: 'truncate',
      render: (sandbox) => <ImageReference image={sandbox.spec.image} />,
    },
    {
      title: 'Labels',
      render: (sandbox) => (
        <LabelsList labels={sandbox.metadata.labels} numLabels={2} />
      ),
    },
    {
      title: 'Age',
      render: (sandbox) => formatAge(sandbox.metadata.createdAtMs),
    },
  ];

  return (
    <ResourceTable
      title="Sandboxes"
      testId="all-sandboxes"
      query={{ ...sandboxes, data: sandboxes.data?.items }}
      columns={columns}
      rowKey={scopedName}
      filterText={scopedName}
      filterPlaceholder="Filter current page by workspace or name"
      emptyBody="No workspace on this gateway has a sandbox."
      labelSelector={{
        value: selector,
        onApply: (value) => applyFilters(value, typeLabel),
      }}
      typeLabel={{
        value: typeLabel,
        onApply: (value) => applyFilters(selector, value),
        error: filterError,
      }}
      cursorPage={{
        page: pager.page,
        perPage: pager.perPage,
        hasNext: Boolean(sandboxes.data?.nextPageToken),
        isLoading: isCursorPagePending(sandboxes, pager.isTransitioning),
        isTransitioning: pager.isTransitioning,
        onPrevious: pager.previous,
        onNext: () => pager.next(sandboxes.data?.nextPageToken ?? ''),
        onPerPageSelect: pager.onPerPageSelect,
        onReset: pager.reset,
      }}
    />
  );
};

export default AllSandboxList;
