import { act, renderHook } from '@testing-library/react';

import { useListPage } from '../useListPage';
import { useTableSelection } from '../useTableSelection';

const names = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `row-${i + 1}`);

// A list page as far as the hook is concerned: it takes its rows from pageOf
// while it renders.
const useList = ({
  items,
  prune = true,
}: {
  items: string[];
  prune?: boolean;
}) => {
  const list = useTableSelection();
  const rows = list.pageOf(items, prune ? (name) => name : undefined);
  return { ...list, rows };
};

const renderList = (items: string[], prune = true) =>
  renderHook(useList, { initialProps: { items, prune } });

describe('useTableSelection', () => {
  describe('pageOf', () => {
    it('returns the rows of the page being shown', () => {
      const { result } = renderList(names(25));
      expect(result.current.rows).toEqual(names(10));

      act(() => result.current.setPage(3));
      expect(result.current.rows).toEqual([
        'row-21',
        'row-22',
        'row-23',
        'row-24',
        'row-25',
      ]);
    });

    it('goes back to the last page when the list becomes shorter than the page it is on', () => {
      const { result, rerender } = renderList(names(11));
      act(() => result.current.setPage(2));
      expect(result.current.rows).toEqual(['row-11']);

      // The eleventh row is deleted, here or elsewhere, and the poll lands.
      rerender({ items: names(10), prune: true });

      expect(result.current.page).toBe(1);
      expect(result.current.rows).toEqual(names(10));
    });

    it('goes to the last page that has rows, not always to the first', () => {
      const { result, rerender } = renderList(names(45));
      act(() => result.current.setPage(5));

      rerender({ items: names(21), prune: true });

      expect(result.current.page).toBe(3);
      expect(result.current.rows).toEqual(['row-21']);
    });

    it('shows the first page of a list that became empty', () => {
      const { result, rerender } = renderList(names(25));
      act(() => result.current.setPage(3));

      rerender({ items: [], prune: true });

      expect(result.current.page).toBe(1);
      expect(result.current.rows).toEqual([]);
    });

    it('does not come back to the page it left when the list grows again', () => {
      const { result, rerender } = renderList(names(11));
      act(() => result.current.setPage(2));
      rerender({ items: names(10), prune: true });

      rerender({ items: names(30), prune: true });

      expect(result.current.page).toBe(1);
    });

    it('leaves the page alone while the list still reaches it', () => {
      const { result, rerender } = renderList(names(25));
      act(() => result.current.setPage(2));

      rerender({ items: names(11), prune: true });

      expect(result.current.page).toBe(2);
      expect(result.current.rows).toEqual(['row-11']);
    });

    it('follows the page size', () => {
      const { result } = renderList(names(25));
      act(() => result.current.onPerPageSelect(20));
      expect(result.current.rows).toEqual(names(20));
    });
  });

  describe('the selection', () => {
    it('drops a selected row that the list no longer holds', () => {
      const { result, rerender } = renderList(names(5));
      act(() => result.current.toggleOne('row-2', true));
      act(() => result.current.toggleOne('row-4', true));
      expect(result.current.selected).toEqual(['row-2', 'row-4']);

      // A filter now hides row-4.
      rerender({ items: ['row-1', 'row-2', 'row-3'], prune: true });

      expect(result.current.selected).toEqual(['row-2']);
      expect(result.current.numSelected).toBe(1);
    });

    it('does not select the row again when the list holds it again', () => {
      const { result, rerender } = renderList(names(5));
      act(() => result.current.toggleOne('row-4', true));
      rerender({ items: ['row-1'], prune: true });

      // The filter is cleared.
      rerender({ items: names(5), prune: true });

      expect(result.current.selected).toEqual([]);
    });

    it('keeps a selected row that is on another page of the list', () => {
      const { result } = renderList(names(25));
      act(() => result.current.toggleOne('row-3', true));
      act(() => result.current.setPage(2));
      expect(result.current.selected).toEqual(['row-3']);
    });

    it('is left as it is for a list that does not say what its rows are called', () => {
      const { result, rerender } = renderList(names(5), false);
      act(() => result.current.toggleOne('row-4', true));

      rerender({ items: ['row-1'], prune: false });

      expect(result.current.selected).toEqual(['row-4']);
    });
  });
});

describe('useListPage', () => {
  it('hands on pageOf, with the page and the selection it keeps right', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => {
        const list = useListPage();
        return { ...list, rows: list.pageOf(items, (name) => name) };
      },
      { initialProps: { items: names(11) } },
    );
    act(() => result.current.setPage(2));
    act(() => result.current.toggleOne('row-11', true));
    expect(result.current.deleteSelectedLabel).toBe('Delete selected (1)');

    rerender({ items: names(10) });

    expect(result.current.page).toBe(1);
    expect(result.current.rows).toEqual(names(10));
    expect(result.current.selected).toEqual([]);
    expect(result.current.deleteSelectedLabel).toBe('Delete selected');
  });
});
