import { useState, useCallback } from 'react';

// One input of a credential refresh: a client id, a private key and so on.
// Whether it is secret is a property of the entry and not of the text of its
// key. Kept by key, an entry stopped being secret the moment its key was
// edited: its value was then shown as plain text and sent as plain material.
export type MaterialEntry = {
  key: string;
  value: string;
  secret: boolean;
};

export const useMaterialEntries = () => {
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([]);

  const update = useCallback(
    (index: number, change: Partial<MaterialEntry>) =>
      setMaterialEntries((prev) =>
        prev.map((entry, i) => (i === index ? { ...entry, ...change } : entry)),
      ),
    [],
  );

  const addEntry = useCallback(() => {
    setMaterialEntries((prev) => [
      ...prev,
      { key: '', value: '', secret: false },
    ]);
  }, []);

  const removeEntry = useCallback((index: number) => {
    setMaterialEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateKey = useCallback(
    (index: number, key: string) => update(index, { key }),
    [update],
  );

  const updateValue = useCallback(
    (index: number, value: string) => update(index, { value }),
    [update],
  );

  const toggleSecret = useCallback(
    (index: number, secret: boolean) => update(index, { secret }),
    [update],
  );

  const reset = useCallback(() => {
    setMaterialEntries([]);
  }, []);

  // Replaces every entry with the named ones, values empty, for a form that
  // knows which material is needed and which of it is secret.
  const replace = useCallback((keys: string[], secrets: string[]) => {
    setMaterialEntries(
      keys.map((key) => ({ key, value: '', secret: secrets.includes(key) })),
    );
  }, []);

  // The material as the request carries it. An entry without a key is not
  // material, and a key given twice keeps its last value.
  const toMaterialMap = useCallback(
    (): Record<string, string> =>
      Object.fromEntries(
        materialEntries
          .filter((entry) => entry.key)
          .map((entry) => [entry.key, entry.value]),
      ),
    [materialEntries],
  );

  // The keys of the material that is secret. A key given twice is secret when
  // any entry of that key is marked so: the value that is sent may be the one
  // that was meant to be hidden.
  const getSecretMaterialKeys = useCallback(
    (): string[] => [
      ...new Set(
        materialEntries
          .filter((entry) => entry.key && entry.secret)
          .map((entry) => entry.key),
      ),
    ],
    [materialEntries],
  );

  return {
    materialEntries,
    addEntry,
    removeEntry,
    updateKey,
    updateValue,
    toggleSecret,
    reset,
    replace,
    toMaterialMap,
    getSecretMaterialKeys,
  };
};
