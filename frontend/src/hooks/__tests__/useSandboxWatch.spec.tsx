import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { useSandboxWatch } from '../useSandboxWatch';
import { policyKeys, sandboxKeys } from '../../api/queryKeys';

const mockUseFeatureFlags = jest.fn();
jest.mock('../../api/auth', () => ({
  useFeatureFlags: () => mockUseFeatureFlags(),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }
}

describe('useSandboxWatch', () => {
  let queryClient: QueryClient;
  const realWebSocket = window.WebSocket;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    jest.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    FakeWebSocket.instances = [];
    (window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    mockUseFeatureFlags.mockReturnValue({ liveUpdates: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    (window as unknown as { WebSocket: unknown }).WebSocket = realWebSocket;
  });

  it('does not open a socket when the flag is off', () => {
    mockUseFeatureFlags.mockReturnValue({ liveUpdates: false });
    const { result } = renderHook(() => useSandboxWatch('default', 'sb1'), {
      wrapper,
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.isLive).toBe(false);
  });

  it('opens a socket to the watch endpoint and reports live on open', () => {
    const { result } = renderHook(() => useSandboxWatch('default', 'sb1'), {
      wrapper,
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain(
      '/api/v1/workspaces/default/sandboxes/sb1/watch',
    );
    expect(result.current.isLive).toBe(false);

    act(() => FakeWebSocket.instances[0].onopen?.());
    expect(result.current.isLive).toBe(true);
  });

  it('pushes sandbox snapshots into the cache and invalidates draft queries', () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useSandboxWatch('default', 'sb1'), { wrapper });
    const ws = FakeWebSocket.instances[0];
    act(() => ws.onopen?.());

    const sandbox = {
      metadata: { id: 'id-1', name: 'sb1', workspace: 'default' },
      spec: {},
      status: { phase: 'READY' },
    };
    act(() =>
      ws.onmessage?.({ data: JSON.stringify({ type: 'sandbox', sandbox }) }),
    );

    expect(
      queryClient.getQueryData(sandboxKeys.detail('default', 'sb1')),
    ).toEqual(sandbox);

    act(() => jest.advanceTimersByTime(300));
    const invalidatedKeys = invalidateSpy.mock.calls.map(
      ([filters]) => filters?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(policyKeys.drafts('default', 'sb1'));
    expect(invalidatedKeys).toContainEqual(
      policyKeys.sandbox('default', 'sb1'),
    );
    expect(invalidatedKeys).toContainEqual(
      policyKeys.draftHistory('default', 'sb1'),
    );
  });

  it('coalesces bursts of events into one invalidation round', () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useSandboxWatch('default', 'sb1'), { wrapper });
    const ws = FakeWebSocket.instances[0];
    act(() => ws.onopen?.());

    act(() => {
      for (let i = 0; i < 5; i += 1) {
        ws.onmessage?.({
          data: JSON.stringify({ type: 'warning', warning: 'lag' }),
        });
      }
      jest.advanceTimersByTime(300);
    });

    const draftInvalidations = invalidateSpy.mock.calls.filter(
      ([filters]) =>
        JSON.stringify(filters?.queryKey) ===
        JSON.stringify(policyKeys.drafts('default', 'sb1')),
    );
    expect(draftInvalidations).toHaveLength(1);
  });

  it('drops back to polling after the socket closes', () => {
    const { result } = renderHook(() => useSandboxWatch('default', 'sb1'), {
      wrapper,
    });
    const ws = FakeWebSocket.instances[0];
    act(() => ws.onopen?.());
    expect(result.current.isLive).toBe(true);

    act(() => ws.onclose?.());
    expect(result.current.isLive).toBe(false);

    // A reconnect attempt is scheduled with backoff.
    act(() => jest.advanceTimersByTime(2_000));
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });

  it('closes the socket on unmount', () => {
    const { unmount } = renderHook(() => useSandboxWatch('default', 'sb1'), {
      wrapper,
    });
    const ws = FakeWebSocket.instances[0];
    unmount();
    expect(ws.closed).toBe(true);
  });
});
