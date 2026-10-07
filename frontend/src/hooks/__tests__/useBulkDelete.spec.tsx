import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { useBulkDelete } from '../useBulkDelete';

const setup = (deleteOne: (name: string) => Promise<unknown>) => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useBulkDelete(deleteOne, ['sandboxes', 'team-a']),
    { wrapper },
  );
  return { ...hook, invalidate };
};

describe('useBulkDelete', () => {
  it('hands the caller what the gateway answered for each name, in order', async () => {
    const answers: Record<string, unknown> = {
      a: { outcome: 'completed', deleted: true },
      b: { outcome: 'accepted', deleted: false },
      c: { outcome: 'already_absent', deleted: true },
    };
    // The deletes run together and finish out of order.
    const deleteOne = jest.fn(
      (name: string) =>
        new Promise<unknown>((resolve) =>
          setTimeout(() => resolve(answers[name]), name === 'a' ? 20 : 1),
        ),
    );
    const { result } = setup(deleteOne);
    const onDone = jest.fn();

    await act(async () => {
      await result.current.run(['a', 'b', 'c'], onDone);
    });

    expect(deleteOne.mock.calls.map(([name]) => name)).toEqual(['a', 'b', 'c']);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith([
      'completed',
      'accepted',
      'already_absent',
    ]);
    expect(result.current.error).toBeUndefined();
    expect(result.current.isDeleting).toBe(false);
  });

  it('does not read an answer it cannot place as a deletion', async () => {
    const { result } = setup(() => Promise.resolve({ outcome: 'archived' }));
    const onDone = jest.fn();
    await act(async () => {
      await result.current.run(['a'], onDone);
    });
    expect(onDone).toHaveBeenCalledWith(['unspecified']);
  });

  it('reads an endpoint that only says deleted: true as completed', async () => {
    const { result } = setup(() => Promise.resolve({ deleted: true }));
    const onDone = jest.fn();
    await act(async () => {
      await result.current.run(['a'], onDone);
    });
    expect(onDone).toHaveBeenCalledWith(['completed']);
  });

  it('reports a failed delete as an error and does not call onDone', async () => {
    const { result } = setup((name) =>
      name === 'b'
        ? Promise.reject(new Error('sandbox not found'))
        : Promise.resolve({ outcome: 'completed', deleted: true }),
    );
    const onDone = jest.fn();
    await act(async () => {
      await result.current.run(['a', 'b'], onDone);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.error).toBe('1 of 2 deletions failed');

    act(() => result.current.clearError());
    expect(result.current.error).toBeUndefined();
  });

  it('refreshes the list whatever the outcome', async () => {
    const { result, invalidate } = setup(() =>
      Promise.resolve({ outcome: 'accepted', deleted: false }),
    );
    await act(async () => {
      await result.current.run(['a'], jest.fn());
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['sandboxes', 'team-a'],
    });
  });
});
