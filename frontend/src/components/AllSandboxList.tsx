import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAllSandboxPage } from '../api/allWorkspaces';
import {
  isCursorPagePending,
  useCursorListPage,
  useCursorPageResult,
} from '../hooks/useCursorListPage';
import { combineSandboxLabelSelector } from '../utils/sandboxLabelSelector';
import { formatAge } from '../utils/formatters';
import type { Sandbox } from '../types';
import {
  sandboxPath,
  scopedName,
  workspaceOf,
  workspacePath,
} from '../utils/workspaceNames';
import ImageReference from './sandbox/ImageReference';
import LabelsList from './LabelsList';
import PhaseLabel from './PhaseLabel';
import ResourceTable from './ResourceTable';
import type { ResourceTableColumn } from './ResourceTable';

// The Sandboxes page's list: it owns its gateway cursor, type-label filter and columns.
// Other all-workspaces resources continue to use local table pagination.
const AllSandboxList: React.FC = () => {
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

  // Name leads so the sandbox is what the row is about; workspace follows.
  // Both are links, so they open in a new tab and read as links.
  const columns: ResourceTableColumn<Sandbox>[] = [
    {
      title: 'Name',
      modifier: 'nowrap',
      render: (sandbox) => (
        <Link
          to={sandboxPath(workspaceOf(sandbox), sandbox.metadata.name)}
          data-testid={`sandbox-link-${scopedName(sandbox)}`}
        >
          {sandbox.metadata.name}
        </Link>
      ),
    },
    {
      title: 'Workspace',
      modifier: 'nowrap',
      render: (sandbox) => (
        <Link
          to={workspacePath(workspaceOf(sandbox))}
          data-testid={`workspace-link-${scopedName(sandbox)}`}
        >
          {workspaceOf(sandbox)}
        </Link>
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
