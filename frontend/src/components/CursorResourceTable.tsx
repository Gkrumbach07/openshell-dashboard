import { useRef, useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateBody,
  SearchInput,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarToggleGroup,
} from '@patternfly/react-core';
import { CubesIcon, FilterIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';

import { useI18n } from '../i18n';
import CursorPageTransition from './CursorPageTransition';
import CursorPagination from './CursorPagination';
import RefreshErrorAlert, { isRefreshError } from './RefreshErrorAlert';
import type {
  ResourceTableCursorPage,
  ResourceTableProps,
} from './ResourceTable';

type CursorResourceTableProps<T> = ResourceTableProps<T> & {
  cursorPage: ResourceTableCursorPage;
};

// Gateway-backed read-only lists have no total count. The controls and error
// states here follow the cursor contract; ResourceTable keeps local paging.
const CursorResourceTable = <T,>({
  title,
  testId,
  query,
  columns,
  rowKey,
  filterText,
  filterPlaceholder,
  emptyBody,
  labelSelector,
  typeLabel,
  cursorPage,
}: CursorResourceTableProps<T>): React.ReactElement => {
  const [filter, setFilter] = useState('');
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const { t } = useI18n('common');
  const [selectorInput, setSelectorInput] = useState(
    labelSelector?.value ?? '',
  );
  const [typeInput, setTypeInput] = useState(typeLabel?.value ?? '');
  const noun = title.toLocaleLowerCase();
  const refreshFailed = isRefreshError(query);
  const pageFailed = query.isError && cursorPage.page > 1;
  const errorMessage =
    query.isError && (!refreshFailed || pageFailed)
      ? (query.error as Error).message
      : undefined;
  const refreshNotice = refreshFailed && !pageFailed && (
    <RefreshErrorAlert
      title={`The ${noun} could not be refreshed`}
      staleNote={`The ${noun} shown were loaded earlier and may be out of date.`}
      error={query.error}
      onRetry={() => query.refetch()}
      className="pf-v6-u-mb-md"
      data-testid={`${testId}-refresh-error`}
    />
  );

  if (
    errorMessage !== undefined &&
    !labelSelector?.value &&
    !typeLabel?.value &&
    cursorPage.page === 1
  ) {
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
  if (
    all.length === 0 &&
    !labelSelector?.value &&
    !typeLabel?.value &&
    !typeLabel?.error &&
    cursorPage.page === 1 &&
    !query.isLoading &&
    !query.isPlaceholderData &&
    !errorMessage
  ) {
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
  const rows = normalizedFilter
    ? all.filter((item) =>
        filterText(item).toLocaleLowerCase().includes(normalizedFilter),
      )
    : all;
  const paginationProps = {
    ...cursorPage,
    isLoading: cursorPage.isLoading,
    isError: query.isError,
  };

  return (
    <>
      {refreshNotice}
      <Toolbar aria-label={`${title} filters`}>
        <ToolbarContent>
          <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="lg">
            <ToolbarItem>
              <SearchInput
                aria-label={`Filter current page of ${noun}`}
                placeholder={filterPlaceholder}
                value={filter}
                onChange={(_event, value) => setFilter(value)}
                onClear={() => setFilter('')}
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
                  onSearch={(_event, value) =>
                    labelSelector.onApply(value.trim())
                  }
                  onClear={() => {
                    setSelectorInput('');
                    labelSelector.onApply('');
                  }}
                  submitSearchButtonLabel="Apply label selector"
                  resetButtonLabel="Clear label selector"
                  data-testid={`${testId}-label-selector`}
                />
              </ToolbarItem>
            )}
            {typeLabel && (
              <ToolbarItem>
                <SearchInput
                  aria-label={`Filter ${noun} by type label`}
                  inputProps={{
                    'aria-invalid': Boolean(typeLabel.error),
                    'aria-describedby': typeLabel.error
                      ? `${testId}-type-label-error`
                      : undefined,
                  }}
                  placeholder="Type label, e.g. type=tool"
                  value={typeInput}
                  onChange={(_event, value) => setTypeInput(value)}
                  onSearch={(_event, value) => typeLabel.onApply(value.trim())}
                  onClear={() => {
                    setTypeInput('');
                    typeLabel.onApply('');
                  }}
                  submitSearchButtonLabel="Apply type label"
                  resetButtonLabel="Clear type label"
                  data-testid={`${testId}-type-label`}
                />
              </ToolbarItem>
            )}
          </ToolbarToggleGroup>
          <ToolbarItem variant="pagination" align={{ default: 'alignEnd' }}>
            <CursorPagination variant="top" {...paginationProps} />
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {errorMessage !== undefined && (
        <Alert
          variant="danger"
          isInline
          title={
            pageFailed
              ? 'Could not load this page'
              : 'The label selector could not be applied'
          }
          data-testid={`${testId}-error`}
        >
          {errorMessage}
          {pageFailed && (
            <Button variant="link" onClick={cursorPage.onReset}>
              Start at first page
            </Button>
          )}
        </Alert>
      )}
      {typeLabel?.error && (
        <Alert
          id={`${testId}-type-label-error`}
          variant="danger"
          isInline
          title={typeLabel.error}
          data-testid={`${testId}-type-label-error`}
        />
      )}
      <h2 ref={resultsRef} tabIndex={-1} className="pf-v6-screen-reader">
        {t('pagination.resourceResults', { title })}
      </h2>
      {query.isLoading ||
      (cursorPage.isTransitioning && !query.data && !query.isError) ? (
        <Bullseye>
          <Spinner aria-label={`Loading ${noun}`} />
        </Bullseye>
      ) : (
        <CursorPageTransition
          loading={Boolean(
            cursorPage.isTransitioning && query.isPlaceholderData,
          )}
          loadingLabel={`Loading ${noun}`}
        >
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
                    No {noun} match{' '}
                    {all.length === 0 ? 'this label selector' : 'on this page'}.
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CursorPageTransition>
      )}
      <CursorPagination
        variant="bottom"
        resultsRef={resultsRef}
        {...paginationProps}
      />
    </>
  );
};

export default CursorResourceTable;
