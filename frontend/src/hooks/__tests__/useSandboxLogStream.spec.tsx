import { act, renderHook } from '@testing-library/react';

import { useSandboxLogStream } from '../useSandboxLogStream';

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

const logFrame = (message: string) =>
  JSON.stringify({
    type: 'log',
    log: { message, timestampMs: 1, level: 'INFO' },
  });

describe('useSandboxLogStream', () => {
  const realWebSocket = window.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.instances = [];
    (window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    mockUseFeatureFlags.mockReturnValue({ liveUpdates: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    (window as unknown as { WebSocket: unknown }).WebSocket = realWebSocket;
  });

  it('does not open a socket when disabled or flag is off', () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useSandboxLogStream('default', 'sb1', { lines: 100 }, enabled),
      { initialProps: { enabled: false } },
    );
    expect(FakeWebSocket.instances).toHaveLength(0);

    mockUseFeatureFlags.mockReturnValue({ liveUpdates: false });
    rerender({ enabled: true });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('opens a socket with log params and collects streamed lines', () => {
    const { result } = renderHook(() =>
      useSandboxLogStream(
        'default',
        'sb1',
        { lines: 100, level: 'WARN', sources: ['sandbox'] },
        true,
      ),
    );
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toContain('/sandboxes/sb1/watch?');
    expect(ws.url).toContain('logs=true');
    expect(ws.url).toContain('lines=100');
    expect(ws.url).toContain('level=WARN');
    expect(ws.url).toContain('source=sandbox');

    act(() => ws.onopen?.());
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      ws.onmessage?.({ data: logFrame('first') });
      ws.onmessage?.({ data: logFrame('second') });
      // Non-log frames are ignored by this hook.
      ws.onmessage?.({
        data: JSON.stringify({ type: 'warning', warning: 'x' }),
      });
    });
    expect(result.current.lines.map((l) => l.message)).toEqual([
      'first',
      'second',
    ]);
  });

  it('caps the buffer at the requested line count', () => {
    const { result } = renderHook(() =>
      useSandboxLogStream('default', 'sb1', { lines: 3 }, true),
    );
    const ws = FakeWebSocket.instances[0];
    act(() => ws.onopen?.());
    act(() => {
      for (let i = 1; i <= 5; i += 1) {
        ws.onmessage?.({ data: logFrame(`line-${i}`) });
      }
    });
    expect(result.current.lines.map((l) => l.message)).toEqual([
      'line-3',
      'line-4',
      'line-5',
    ]);
  });

  it('clears the buffer on reconnect so the tail replay is not duplicated', () => {
    const { result } = renderHook(() =>
      useSandboxLogStream('default', 'sb1', { lines: 100 }, true),
    );
    const ws = FakeWebSocket.instances[0];
    act(() => ws.onopen?.());
    act(() => ws.onmessage?.({ data: logFrame('old') }));
    expect(result.current.lines).toHaveLength(1);

    act(() => ws.onclose?.());
    expect(result.current.isStreaming).toBe(false);

    act(() => jest.advanceTimersByTime(2_000));
    const reconnected = FakeWebSocket.instances[1];
    act(() => reconnected.onopen?.());
    expect(result.current.lines).toHaveLength(0);

    act(() => reconnected.onmessage?.({ data: logFrame('replayed') }));
    expect(result.current.lines.map((l) => l.message)).toEqual(['replayed']);
  });

  it('closes the socket on unmount', () => {
    const { unmount } = renderHook(() =>
      useSandboxLogStream('default', 'sb1', { lines: 100 }, true),
    );
    const ws = FakeWebSocket.instances[0];
    unmount();
    expect(ws.closed).toBe(true);
  });
});
