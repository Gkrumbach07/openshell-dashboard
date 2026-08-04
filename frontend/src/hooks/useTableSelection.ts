import { useState } from 'react';

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
  };
};
