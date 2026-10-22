import { useCallback, useEffect, useRef, useState } from 'react';

// Selection is by stable resource name, so moving a row to another page does
// not clear it. A changed workspace or selector starts a new selection scope.
export const useCursorSelection = (scope: string) => {
  const [currentScope, setCurrentScope] = useState(scope);
  const [selected, setSelected] = useState<string[]>([]);
  const observedPages = useRef(new Map<string, Set<string>>());

  if (currentScope !== scope) {
    setCurrentScope(scope);
    setSelected([]);
  }

  useEffect(() => {
    observedPages.current.clear();
  }, [scope]);

  // A refresh can remove a selected row from a page we have already seen.
  // Keep selections from other pages, whose contents are not loaded here.
  const reconcilePage = useCallback((pageKey: string, pageNames: string[]) => {
    const previousNames = observedPages.current.get(pageKey);
    const currentNames = new Set(pageNames);
    observedPages.current.set(pageKey, currentNames);
    if (!previousNames) return;

    const disappeared = new Set(
      [...previousNames].filter((name) => !currentNames.has(name)),
    );
    if (disappeared.size === 0) return;
    setSelected((current) => {
      const remaining = current.filter((name) => !disappeared.has(name));
      return remaining.length === current.length ? current : remaining;
    });
  }, []);

  const toggleAll = (pageNames: string[], isSelecting: boolean) => {
    setSelected((current) =>
      isSelecting
        ? [...new Set([...current, ...pageNames])]
        : current.filter((name) => !pageNames.includes(name)),
    );
  };
  const toggleOne = (name: string, isSelecting: boolean) => {
    setSelected((current) =>
      isSelecting
        ? [...new Set([...current, name])]
        : current.filter((item) => item !== name),
    );
  };
  const pageAllSelected = (pageNames: string[]) =>
    pageNames.length > 0 && pageNames.every((name) => selected.includes(name));

  return {
    selected,
    toggleAll,
    toggleOne,
    pageAllSelected,
    reconcilePage,
    clearSelection: () => setSelected([]),
  };
};
