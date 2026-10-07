import { useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateBody,
  Pagination,
  SearchInput,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useTableSelection } from '../hooks/useTableSelection';
import RefreshErrorAlert, { isRefreshError } from './RefreshErrorAlert';

export type ResourceTableColumn<T> = {
  title: string;
  render: (item: T) => React.ReactNode;
  // How the column's cells wrap: "nowrap" for a name that should stay on one
  // line, "truncate" for a value that may be too long to show whole.
  modifier?: 'breakWord' | 'fitContent' | 'nowrap' | 'truncate' | 'wrap';
};

// The part of a list query the table reads, so that a caller can pass the
// result of useQuery as it is.
export type ResourceTableQuery<T> = {
  data?: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  // Whether `data` is only held in place of the query's own: the rows of the
  // last label selector, kept on screen while the next one loads.
  isPlaceholderData?: boolean;
};

// A label selector the server applies, in the gateway's own form
// (key1=value1,key2=value2). It is sent when the search is submitted, not on
// every key, because the gateway refuses one that is not key=value pairs.
export type ResourceTableLabelSelector = {
  value: string;
  onApply: (selector: string) => void;
};

type ResourceTableProps<T> = {
  // Names the table, the toolbar and the test ids: "Sandboxes", "sandboxes".
  title: string;
  testId: string;
  query: ResourceTableQuery<T>;
  columns: ResourceTableColumn<T>[];
  rowKey: (item: T) => string;
  // The text a row is matched on by the filter box.
  filterText: (item: T) => string;
  filterPlaceholder: string;
  emptyBody: string;
  labelSelector?: ResourceTableLabelSelector;
};

// A read-only, paginated list of resources: what a list page shows when the
// rows are for looking at and following, not for acting on. The lists across
// workspaces and a workspace's service endpoints are built on it.
const ResourceTable = <T,>({
  title,
  testId,
  query,
  columns,
  rowKey,
  filterText,
  filterPlaceholder,
  emptyBody,
  labelSelector,
}: ResourceTableProps<T>): React.ReactElement => {
  const { page, setPage, perPage, onPerPageSelect, pageOf } =
    useTableSelection();
  const [filter, setFilter] = useState('');
  const [selectorInput, setSelectorInput] = useState(
    labelSelector?.value ?? '',
  );
  const appliedSelector = labelSelector?.value ?? '';
  const noun = title.toLocaleLowerCase();

  if (query.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label={`Loading ${noun}`} />
      </Bullseye>
    );
  }

  // The lists are polled. A refresh that fails leaves the rows that loaded
  // before on screen, with the filter that was typed, and is reported above
  // them; only a list that never loaded, or a selector the gateway refused,
  // is an error in the place of the rows.
  const refreshFailed = isRefreshError(query);
  const refreshNotice = refreshFailed && (
    <RefreshErrorAlert
      title={`The ${noun} could not be refreshed`}
      staleNote={`The ${noun} shown were loaded earlier and may be out of date.`}
      error={query.error}
      onRetry={() => query.refetch()}
      className="pf-v6-u-mb-md"
      data-testid={`${testId}-refresh-error`}
    />
  );

  const errorMessage =
    query.isError && !refreshFailed
      ? (query.error as Error).message
      : undefined;

  // Without a selector there is nothing on this page to correct, so the
  // failure stands alone. With one, it is shown under the box it came from.
  if (errorMessage !== undefined && !appliedSelector) {
    return (
      <Alert
        variant="danger"
        title={`Failed to load ${noun}`}
        data-testid={`${testId}-error`}
        actionLinks={
          <Button variant="link" onClick={() => query.refetch()}>
            Retry
          </Button>
        }
      >
        {errorMessage}
      </Alert>
    );
  }

  const all = query.data ?? [];
  if (all.length === 0 && !appliedSelector) {
    return (
      <>
        {refreshNotice}
        <EmptyState
          variant="lg"
          titleText={`No ${noun}`}
          icon={CubesIcon}
          data-testid={`${testId}-empty`}
        >
          <EmptyStateBody>{emptyBody}</EmptyStateBody>
        </EmptyState>
      </>
    );
  }

  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const filtered = normalizedFilter
    ? all.filter((item) =>
        filterText(item).toLocaleLowerCase().includes(normalizedFilter),
      )
    : all;
  // The rows of the page that is shown. The list is polled and its rows are
  // deleted elsewhere, so the page that was chosen can cease to exist: pageOf
  // shows the last page that has rows then, not an empty table.
  const rows = pageOf(filtered);

  return (
    <>
      {refreshNotice}
      <Toolbar aria-label={`${title} filters`}>
        <ToolbarContent>
          <ToolbarItem>
            <SearchInput
              aria-label={`Filter ${noun}`}
              placeholder={filterPlaceholder}
              value={filter}
              onChange={(_event, value) => {
                setFilter(value);
                setPage(1);
              }}
              onClear={() => {
                setFilter('');
                setPage(1);
              }}
              data-testid={`${testId}-filter`}
            />
          </ToolbarItem>
          {labelSelector && (
            <ToolbarItem>
              <SearchInput
                aria-label={`Filter ${noun} by label selector`}
                placeholder="Label selector, e.g. team=ml"
                value={selectorInput}
                onChange={(_event, value) => setSelectorInput(value)}
                onSearch={(_event, value) => {
                  labelSelector.onApply(value.trim());
                  setPage(1);
                }}
                onClear={() => {
                  setSelectorInput('');
                  labelSelector.onApply('');
                  setPage(1);
                }}
                submitSearchButtonLabel="Apply label selector"
                resetButtonLabel="Clear label selector"
                data-testid={`${testId}-label-selector`}
              />
            </ToolbarItem>
          )}
          <ToolbarItem align={{ default: 'alignEnd' }}>
            <Pagination
              itemCount={filtered.length}
              perPage={perPage}
              page={page}
              onSetPage={(_event, p) => setPage(p)}
              onPerPageSelect={(_event, pp) => onPerPageSelect(pp)}
              isCompact
            />
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {errorMessage !== undefined && (
        <Alert
          variant="danger"
          isInline
          title="The label selector could not be applied"
          data-testid={`${testId}-error`}
        >
          {errorMessage}
        </Alert>
      )}
      <Table aria-label={title} data-testid={`${testId}-table`}>
        <Thead>
          <Tr>
            {columns.map((column) => (
              <Th key={column.title} modifier={column.modifier}>
                {column.title}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((item) => (
            <Tr key={rowKey(item)}>
              {columns.map((column) => (
                <Td
                  key={column.title}
                  dataLabel={column.title}
                  modifier={column.modifier}
                >
                  {column.render(item)}
                </Td>
              ))}
            </Tr>
          ))}
          {rows.length === 0 && errorMessage === undefined && (
            <Tr>
              <Td colSpan={columns.length}>
                {/* The selector left nothing at all, or the filter left
                    nothing of what it did leave. */}
                No {noun} match{' '}
                {all.length === 0 ? 'this label selector' : 'this filter'}.
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </>
  );
};

export default ResourceTable;
