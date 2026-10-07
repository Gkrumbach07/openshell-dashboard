import { Alert, Button } from '@patternfly/react-core';

type RefreshErrorAlertProps = {
  // What could not be refreshed, as a sentence: "The settings could not be
  // refreshed".
  title: string;
  // The error of the refresh that failed. Its message is shown as it is.
  error: unknown;
  onRetry: () => void;
  // Defaults to English. A page that is translated passes its own.
  retryLabel?: string;
  staleNote?: string;
  className?: string;
  'data-testid'?: string;
};

// The part of a query a page reads to tell a refresh that failed from a first
// load that failed.
type RefreshableQuery = {
  isError: boolean;
  data?: unknown;
  isPlaceholderData?: boolean;
};

// Whether a query that is polled failed to refresh data it already has. A
// page keeps showing that data, with this alert above it, instead of putting
// an error in its place: what was on screen was right a moment ago, and a
// form or a dialog that is open on the page must not be thrown away because
// one request in the background did not get through.
//
// Data a query only holds in place of its own (the rows of the last filter,
// kept while the next one loads) is not data it has.
export const isRefreshError = (query: RefreshableQuery): boolean =>
  query.isError && query.data !== undefined && !query.isPlaceholderData;

const RefreshErrorAlert: React.FC<RefreshErrorAlertProps> = ({
  title,
  error,
  onRetry,
  retryLabel = 'Retry',
  staleNote = 'What is shown was loaded earlier and may be out of date.',
  className,
  'data-testid': testId = 'refresh-error',
}) => (
  <Alert
    variant="warning"
    isInline
    title={title}
    className={className}
    data-testid={testId}
    actionLinks={
      <Button variant="link" isInline onClick={onRetry}>
        {retryLabel}
      </Button>
    }
  >
    {(error as Error | null)?.message} {staleNote}
  </Alert>
);

export default RefreshErrorAlert;
