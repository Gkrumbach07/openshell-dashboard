import { useState, useCallback } from 'react';

type MaterialEntry = {
  key: string;
  value: string;
};

export const useMaterialEntries = () => {
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([]);
  const [secretKeys, setSecretKeys] = useState<Set<string>>(new Set());

  const addEntry = useCallback(() => {
    setMaterialEntries((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const removeEntry = useCallback(
    (index: number) => {
      setSecretKeys((prev) => {
        const next = new Set(prev);
        next.delete(materialEntries[index]?.key);
        return next;
      });
      setMaterialEntries((prev) => prev.filter((_, i) => i !== index));
    },
    [materialEntries],
  );

  const updateKey = useCallback((index: number, key: string) => {
    setMaterialEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, key } : e)),
    );
  }, []);

  const updateValue = useCallback((index: number, value: string) => {
    setMaterialEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, value } : e)),
    );
  }, []);

  const toggleSecret = useCallback((key: string, checked: boolean) => {
    setSecretKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setMaterialEntries([]);
    setSecretKeys(new Set());
  }, []);

  const toMaterialMap = useCallback((): Record<string, string> => {
    const material: Record<string, string> = {};
    for (const entry of materialEntries) {
      if (entry.key) {
        material[entry.key] = entry.value;
      }
    }
    return material;
  }, [materialEntries]);

  const getSecretMaterialKeys = useCallback(
    (material: Record<string, string>): string[] =>
      Array.from(secretKeys).filter((k) => k in material),
    [secretKeys],
  );

  return {
    materialEntries,
    secretKeys,
    addEntry,
    removeEntry,
    updateKey,
    updateValue,
    toggleSecret,
    reset,
    toMaterialMap,
    getSecretMaterialKeys,
  };
};
