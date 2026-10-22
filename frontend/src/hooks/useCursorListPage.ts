import { useCallback, useEffect, useState } from 'react';

// One token per visited page. The first page has no token, and only a
// successful response can provide the token for the next page.
export const useCursorListPage = (scope?: string) => {
  const [currentScope, setCurrentScope] = useState(scope);
  const [tokens, setTokens] = useState(['']);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [isTransitioning, setTransitioning] = useState(false);

  if (currentScope !== scope) {
    setCurrentScope(scope);
    setTokens(['']);
    setPage(1);
    setTransitioning(true);
  }

  const reset = useCallback(() => {
    setTokens(['']);
    setPage(1);
    setTransitioning(true);
  }, []);
  const next = (token: string) => {
    if (!token) return;
    setTokens((current) => [...current.slice(0, page), token]);
    setPage((current) => current + 1);
    setTransitioning(true);
  };
  const previous = () => {
    setPage((current) => Math.max(1, current - 1));
    setTransitioning(true);
  };
  const onPerPageSelect = (size: number) => {
    if (size === perPage) return;
    setPerPage(size);
    reset();
  };
  const markLoaded = useCallback(() => setTransitioning(false), []);

  return {
    page,
    pageToken: tokens[page - 1] ?? '',
    perPage,
    onPerPageSelect,
    reset,
    next,
    previous,
    isTransitioning,
    markLoaded,
  };
};

type PageResult = {
  data?: { items: readonly unknown[]; nextPageToken: string };
  isFetching: boolean;
  isError: boolean;
  isPlaceholderData?: boolean;
};

// A background refresh already has usable rows. Only block page controls
// while the requested page has no result of its own yet.
export const isCursorPagePending = (
  query: PageResult,
  isTransitioning: boolean,
): boolean =>
  !query.isError &&
  (query.isFetching || isTransitioning) &&
  (!query.data || Boolean(query.isPlaceholderData));

// A completed page settles the transition. If deletion makes a later page
// empty, return to the first page rather than displaying a stranded cursor.
export const useCursorPageResult = (
  pager: Pick<
    ReturnType<typeof useCursorListPage>,
    'page' | 'markLoaded' | 'reset'
  >,
  query: PageResult,
) => {
  const { page, markLoaded, reset } = pager;
  const { data, isFetching, isError, isPlaceholderData } = query;
  useEffect(() => {
    if (isError) {
      markLoaded();
      return;
    }
    if (!data || isPlaceholderData) return;
    markLoaded();
    if (isFetching) return;
    if (page > 1 && data.items.length === 0 && !data.nextPageToken) reset();
  }, [data, isFetching, isError, isPlaceholderData, page, markLoaded, reset]);
};
