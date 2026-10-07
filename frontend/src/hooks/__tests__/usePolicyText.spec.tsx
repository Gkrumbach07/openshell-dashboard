import { renderHook } from '@testing-library/react';

import { useJsonValidation } from '../useJsonValidation';
import { usePolicyText } from '../usePolicyText';

describe('usePolicyText', () => {
  // The forms that used useJsonValidation switch on these two fields.
  it('answers an empty text as useJsonValidation does: no policy, no error', () => {
    for (const text of ['', '  \n']) {
      const { result } = renderHook(() => usePolicyText(text));
      const { result: json } = renderHook(() => useJsonValidation(text));
      expect(result.current.error).toBe(json.current.error);
      expect(result.current.parsed).toBe(json.current.parsed);
      expect(result.current.diagnostics).toEqual([]);
    }
  });

  it('reads the JSON of the API as useJsonValidation does', () => {
    const text = '{"version": 1, "networkPolicies": {}}';
    const { result } = renderHook(() => usePolicyText(text));
    const { result: json } = renderHook(() => useJsonValidation(text));
    expect(result.current.error).toBeNull();
    expect(result.current.parsed).toEqual(json.current.parsed);
    expect(result.current.format).toBe('json');
  });

  it('reads a YAML policy file as the policy it converts to', () => {
    const { result } = renderHook(() =>
      usePolicyText('version: 1\nlandlock:\n  compatibility: best_effort\n'),
    );
    expect(result.current).toEqual({
      error: null,
      parsed: { version: 1, landlock: { compatibility: 'best_effort' } },
      format: 'yaml',
      diagnostics: [],
    });
  });

  it('gives every reason a text is not a policy, one to a line', () => {
    const { result } = renderHook(() =>
      usePolicyText('version: 1\nbogus: 1\nmore: 2\n'),
    );
    expect(result.current.parsed).toBeNull();
    expect(result.current.error).toBe(
      "unknown field 'bogus' in authored policy\nunknown field 'more' in authored policy",
    );
    expect(result.current.diagnostics.map((d) => d.path)).toEqual([
      'bogus',
      'more',
    ]);
  });

  it('reads the same text once', () => {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => usePolicyText(text),
      { initialProps: { text: 'version: 1\n' } },
    );
    const first = result.current;
    rerender({ text: 'version: 1\n' });
    expect(result.current).toBe(first);
    rerender({ text: 'version: 2\n' });
    expect(result.current.error).toBe(
      'unsupported policy version 2; expected version 1',
    );
  });
});
