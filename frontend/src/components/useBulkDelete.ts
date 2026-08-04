import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Deletes a set of named resources in parallel (the gateway API is
// delete-by-name only), then invalidates the list query. Partial failures
// surface as an error message while successful deletions stick.
export const useBulkDelete = (
  deleteOne: (name: string) => Promise<unknown>,
  invalidateKey: readonly unknown[],
) => {
  const queryClient = useQueryClient();
  const [isDeleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = async (names: string[], onDone: () => void) => {
    setDeleting(true);
    setError(undefined);
    const results = await Promise.allSettled(
      names.map((name) => deleteOne(name)),
    );
    await queryClient.invalidateQueries({ queryKey: [...invalidateKey] });
    setDeleting(false);
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
      setError(`${failed.length} of ${names.length} deletions failed`);
    } else {
      onDone();
    }
  };

  return { run, isDeleting, error, clearError: () => setError(undefined) };
};
