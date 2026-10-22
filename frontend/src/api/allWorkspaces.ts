import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { RESOURCE_POLL_MS, SANDBOX_POLL_MS } from '../constants';
import { get } from './client';
import { allWorkspacesKeys } from './queryKeys';
import { pagedPath } from './pagination';
import type { ListPage, PageRequest } from './pagination';
import type {
  Provider,
  Sandbox,
  SandboxTemplate,
  ServiceEndpoint,
} from '../types';

// The lists that span every workspace: what `--all-workspaces` does on the
// CLI's sandbox, provider, sandbox template and service lists. The gateway
// answers them for platform admins only; anyone else gets its refusal (403).
// Every item says which workspace it lives in: metadata.workspace, or
// workspace on a service endpoint.

const withLabelSelector = (path: string, labelSelector?: string): string =>
  labelSelector
    ? `${path}?labelSelector=${encodeURIComponent(labelSelector)}`
    : path;

export const listAllSandboxes = (labelSelector?: string): Promise<Sandbox[]> =>
  get<Sandbox[]>(withLabelSelector('/api/v1/sandboxes', labelSelector));

export const listAllSandboxPage = (
  request: PageRequest,
): Promise<ListPage<Sandbox>> =>
  get<ListPage<Sandbox>>(pagedPath('/api/v1/sandboxes', request));

export const useAllSandboxPage = (request: PageRequest) =>
  useQuery({
    queryKey: allWorkspacesKeys.sandboxPage(request),
    queryFn: () => listAllSandboxPage(request),
    placeholderData: keepPreviousData,
    refetchInterval: SANDBOX_POLL_MS,
  });

// The gateway has no filter for providers, in a workspace or across them.
export const listAllProviders = (): Promise<Provider[]> =>
  get<Provider[]>('/api/v1/providers');

export const listAllTemplates = (
  labelSelector?: string,
): Promise<SandboxTemplate[]> =>
  get<SandboxTemplate[]>(withLabelSelector('/api/v1/templates', labelSelector));

// The gateway refuses a sandbox filter across workspaces, so there is none.
export const listAllServices = (): Promise<ServiceEndpoint[]> =>
  get<ServiceEndpoint[]>('/api/v1/services');

// While a new label selector is being fetched the rows of the last one stay
// on screen, so the box the selector is typed in is not replaced by a spinner.
//
// All four are polled. The sandboxes keep the pace of a workspace's own
// sandbox list, because their phase changes by itself. The other three change
// when someone changes them, in a workspace this page is not looking at, and
// are read again at the slower pace of such lists.

// `enabled` and `refetchInterval` are for the shell, which counts sandboxes on
// every page: it must not ask a user the gateway will refuse, and it reads at
// NAV_COUNT_POLL_MS. The Gateway page reads at GATEWAY_PAGE_POLL_MS. The
// Sandboxes page leaves both alone.
export const useAllSandboxes = (
  labelSelector?: string,
  options: { enabled?: boolean; refetchInterval?: number } = {},
) =>
  useQuery({
    queryKey: allWorkspacesKeys.sandboxes(labelSelector),
    queryFn: () => listAllSandboxes(labelSelector),
    refetchInterval: options.refetchInterval ?? SANDBOX_POLL_MS,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });

// `refetchInterval` is for the Gateway page, which only asks whether any
// provider exists yet; the Resources page leaves it alone.
export const useAllProviders = (options: { refetchInterval?: number } = {}) =>
  useQuery({
    queryKey: allWorkspacesKeys.providers,
    queryFn: listAllProviders,
    refetchInterval: options.refetchInterval ?? RESOURCE_POLL_MS,
  });

export const useAllTemplates = (labelSelector?: string) =>
  useQuery({
    queryKey: allWorkspacesKeys.templates(labelSelector),
    queryFn: () => listAllTemplates(labelSelector),
    placeholderData: keepPreviousData,
    refetchInterval: RESOURCE_POLL_MS,
  });

type UseAllServicesOptions = {
  // False where the services feature is switched off, so nothing is fetched.
  enabled?: boolean;
};

export const useAllServices = (options: UseAllServicesOptions = {}) =>
  useQuery({
    queryKey: allWorkspacesKeys.services,
    queryFn: listAllServices,
    enabled: options.enabled ?? true,
    refetchInterval: RESOURCE_POLL_MS,
  });
