import { useMemo } from 'react';

export const useJsonValidation = (
  text: string,
): { error: string | null; parsed: unknown | null } =>
  useMemo(() => {
    if (!text.trim()) {
      return { error: null, parsed: null };
    }
    try {
      return { error: null, parsed: JSON.parse(text) };
    } catch (e) {
      return { error: (e as Error).message, parsed: null };
    }
  }, [text]);
