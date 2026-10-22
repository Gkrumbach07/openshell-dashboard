import { act, renderHook } from '@testing-library/react';
import { useCursorListPage } from '../useCursorListPage';
import { useCursorSelection } from '../useCursorSelection';

describe('useCursorListPage', () => {
  it('remembers opaque tokens for Previous and resets when filters change', () => {
    const { result } = renderHook(() => useCursorListPage());
    expect(result.current.pageToken).toBe('');
    act(() => result.current.next('one'));
    expect(result.current.page).toBe(2);
    expect(result.current.pageToken).toBe('one');
    act(() => result.current.next('two'));
    expect(result.current.pageToken).toBe('two');
    act(() => result.current.previous());
    expect(result.current.pageToken).toBe('one');
    act(() => result.current.reset());
    expect(result.current.page).toBe(1);
    expect(result.current.pageToken).toBe('');
  });

  it('preserves selections across pages and selects only visible names', () => {
    const { result } = renderHook(() => useCursorSelection('team-a'));
    act(() => result.current.toggleAll(['first'], true));
    act(() => result.current.toggleAll(['second'], true));
    expect(result.current.selected).toEqual(['first', 'second']);
    act(() => result.current.toggleAll(['second'], false));
    expect(result.current.selected).toEqual(['first']);
    act(() => result.current.clearSelection());
    expect(result.current.selected).toEqual([]);
  });

  it('changes page size and clears continuation history', () => {
    const { result } = renderHook(() => useCursorListPage());
    act(() => result.current.next('next'));
    act(() => result.current.onPerPageSelect(20));
    expect(result.current.page).toBe(1);
    expect(result.current.pageToken).toBe('');
    expect(result.current.perPage).toBe(20);
  });

  it('resets tokens and selections when the workspace scope changes', () => {
    const { result, rerender } = renderHook(
      ({ scope }) => ({
        pager: useCursorListPage(scope),
        selection: useCursorSelection(scope),
      }),
      {
        initialProps: { scope: 'team-a' },
      },
    );
    act(() => result.current.selection.toggleOne('agent', true));
    act(() => result.current.pager.next('team-a-token'));
    rerender({ scope: 'team-b' });
    expect(result.current.pager.page).toBe(1);
    expect(result.current.pager.pageToken).toBe('');
    expect(result.current.selection.selected).toEqual([]);
  });
});
