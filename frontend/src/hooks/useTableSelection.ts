import { useState } from 'react';

// The page, page size and row selection of a list.
//
// The hook does not hold the list, so it cannot know by itself when the list
// got shorter than the page it is on, or lost a row that is selected. A page
// tells it by taking its rows from `pageOf`.
export const useTableSelection = () => {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);

  const toggleAll = (pageNames: string[], isSelecting: boolean) => {
    setSelected(isSelecting ? pageNames : []);
  };

  const toggleOne = (name: string, isSelecting: boolean) => {
    setSelected((current) =>
      isSelecting
        ? [...current, name]
        : current.filter((item) => item !== name),
    );
  };

  const pageAllSelected = (pageNames: string[]) =>
    pageNames.length > 0 && pageNames.every((n) => selected.includes(n));

  const clearSelection = () => setSelected([]);

  const onPerPageSelect = (pp: number) => {
    setPerPage(pp);
    setPage(1);
  };

  // The rows of the page being shown, out of the rows the list holds now:
  // all of them, after the page's filters and before pagination. Call it
  // while rendering, with that list, in place of slicing the list by `page`.
  //
  // Two things are put right on the way, each by a state update during the
  // render, which React applies before anything is shown:
  //
  // - A list that became shorter than the page it is on (rows were deleted,
  //   here or elsewhere, or a poll brought fewer) is shown at its last page.
  //   Left alone, the page would be an empty table beside a list that has
  //   rows.
  // - With `nameOf`, a selected row that is no longer in the list is dropped
  //   from the selection. A row a filter has hidden, or that was deleted
  //   elsewhere, must not stay selected: "Delete selected" would act on a row
  //   nobody can see. It stays dropped when the filter is cleared.
  const pageOf = <T>(
    items: readonly T[],
    nameOf?: (item: T) => string,
  ): T[] => {
    const lastPage = Math.max(1, Math.ceil(items.length / perPage));
    const shownPage = Math.min(page, lastPage);
    if (shownPage !== page) {
      setPage(shownPage);
    }
    if (nameOf && selected.length > 0) {
      const names = new Set(items.map(nameOf));
      const kept = selected.filter((name) => names.has(name));
      if (kept.length !== selected.length) {
        setSelected(kept);
      }
    }
    const start = (shownPage - 1) * perPage;
    return items.slice(start, start + perPage);
  };

  return {
    page,
    setPage,
    perPage,
    onPerPageSelect,
    selected,
    numSelected: selected.length,
    toggleAll,
    toggleOne,
    pageAllSelected,
    clearSelection,
    pageOf,
  };
};
