import React from 'react';
import { Alert, Bullseye, Button, Spinner } from '@patternfly/react-core';
import type { UseQueryResult } from '@tanstack/react-query';

type QueryStateRendererProps<T> = {
  query: UseQueryResult<T>;
  children: (data: T) => React.ReactNode;
  emptyCheck?: (data: T) => boolean;
  emptyContent?: React.ReactNode;
  loadingLabel?: string;
};

const QueryStateRenderer = <T,>({
  query,
  children,
  emptyCheck,
  emptyContent,
  loadingLabel = 'Loading',
}: QueryStateRendererProps<T>): React.ReactElement | null => {
  if (query.isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label={loadingLabel} />
      </Bullseye>
    );
  }

  if (query.isError) {
    return (
      <Alert
        variant="danger"
        title="Failed to load data"
        actionLinks={
          <Button variant="link" onClick={() => query.refetch()}>
            Retry
          </Button>
        }
      >
        {(query.error as Error).message}
      </Alert>
    );
  }

  if (query.data !== undefined && emptyCheck?.(query.data) && emptyContent) {
    return <>{emptyContent}</>;
  }

  if (query.data !== undefined) {
    return <>{children(query.data)}</>;
  }

  return null;
};

export default QueryStateRenderer;
