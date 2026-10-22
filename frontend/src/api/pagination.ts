export type PageRequest = {
  pageSize: number;
  pageToken?: string;
  labelSelector?: string;
};

export type ListPage<T> = {
  items: T[];
  nextPageToken: string;
};

export const pagedPath = (path: string, request: PageRequest): string => {
  const params = new URLSearchParams();
  params.set('pageSize', String(request.pageSize));
  if (request.pageToken) params.set('pageToken', request.pageToken);
  if (request.labelSelector) params.set('labelSelector', request.labelSelector);
  return `${path}?${params.toString()}`;
};
