import type { PageRequest } from '../../api/pagination';

// Adapts fixtures written for the legacy array hook to the one-page contract.
export const pagedResult = <T>(
  result: { data?: T[]; [key: string]: unknown },
  request: PageRequest,
) => {
  if (!result.data) return result;
  const offset = Number(request.pageToken || '0');
  const items = result.data.slice(offset, offset + request.pageSize);
  return {
    ...result,
    data: {
      items,
      nextPageToken:
        offset + request.pageSize < result.data.length
          ? String(offset + request.pageSize)
          : '',
    },
  };
};
