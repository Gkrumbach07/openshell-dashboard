import { Spinner } from '@patternfly/react-core';

import './CursorPageTransition.css';

type CursorPageTransitionProps = {
  loading: boolean;
  loadingLabel: string;
  children: React.ReactNode;
};

// Keep the table's footprint while a cursor request replaces its rows.
const CursorPageTransition: React.FC<CursorPageTransitionProps> = ({
  loading,
  loadingLabel,
  children,
}) => (
  <div className="cursor-page-transition" aria-busy={loading}>
    <div
      className={
        loading ? 'cursor-page-transition__content--loading' : undefined
      }
      aria-hidden={loading}
      {...(loading ? { inert: '' } : {})}
    >
      {children}
    </div>
    {loading && (
      <div className="cursor-page-transition__loading">
        <Spinner aria-label={loadingLabel} />
      </div>
    )}
  </div>
);

export default CursorPageTransition;
