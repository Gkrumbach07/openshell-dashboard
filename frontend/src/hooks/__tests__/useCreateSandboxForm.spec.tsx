import { act, renderHook } from '@testing-library/react';

import { useCreateSandboxForm } from '../useCreateSandboxForm';

// The fields the gateway generates or defaults — name, labels, resources —
// are folded away so the form opens on the policy, the image and the
// providers. A value typed into one of them must not be able to block the
// form from somewhere nobody can see, so the section says when it holds
// something that needs correcting and the modal opens it.
describe('useCreateSandboxForm — the generated fields', () => {
  it('starts folded away and with nothing to correct', () => {
    const { result } = renderHook(() => useCreateSandboxForm());
    expect(result.current.isGeneratedExpanded).toBe(false);
    expect(result.current.hasGeneratedError).toBe(false);
  });

  it('asks to be opened for labels that are not key=value pairs', () => {
    const { result } = renderHook(() => useCreateSandboxForm());

    act(() => result.current.setLabelsText('team'));

    expect(result.current.labels).toBeNull();
    expect(result.current.hasGeneratedError).toBe(true);
    expect(result.current.isValid).toBe(false);
  });

  it('asks to be opened for a GPU count that is not a whole number', () => {
    const { result } = renderHook(() => useCreateSandboxForm());

    act(() => result.current.setGpuCount('one'));

    expect(result.current.gpuInvalid).toBe(true);
    expect(result.current.hasGeneratedError).toBe(true);
    expect(result.current.isValid).toBe(false);
  });

  it('leaves a form that fills the fields in properly folded away', () => {
    const { result } = renderHook(() => useCreateSandboxForm());

    act(() => {
      result.current.setName('agent-1');
      result.current.setLabelsText('team=ml');
      result.current.setGpuCount('2');
    });

    expect(result.current.hasGeneratedError).toBe(false);
    expect(result.current.isGeneratedExpanded).toBe(false);
    expect(result.current.buildPayload()).toMatchObject({
      name: 'agent-1',
      labels: { team: 'ml' },
      gpuCount: 2,
    });
  });

  it('folds back up when the form is reset', () => {
    const { result } = renderHook(() => useCreateSandboxForm());

    act(() => result.current.setGeneratedExpanded(true));
    expect(result.current.isGeneratedExpanded).toBe(true);

    act(() => result.current.reset());
    expect(result.current.isGeneratedExpanded).toBe(false);
  });
});
