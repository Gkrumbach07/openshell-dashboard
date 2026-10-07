import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ProviderDetailPage from '../ProviderDetailPage';
import ProviderListPage from '../ProviderListPage';
import type {
  CredentialRefreshStatus,
  Provider,
  ProviderProfile,
} from '../../types';

// The pages, their dialogs and the hooks under them are the real ones, on a
// real query client. Only the HTTP calls are stubbed, so that a poll can be
// made to fail, or to bring in something somebody else changed, while a
// dialog is open.
jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: () => ({ isWorkspaceAdmin: true, isLoading: false }),
  useUserRole: () => ({ isPlatformAdmin: true, isLoading: false }),
}));

const provider = (
  name: string,
  overrides: Partial<Provider> = {},
): Provider => ({
  metadata: {
    id: `id-${name}`,
    name,
    workspace: 'team-a',
    createdAtMs: 1,
    resourceVersion: 3,
  },
  type: 'openai',
  credentialNames: ['OPENAI_API_KEY'],
  config: {},
  ...overrides,
});

const openai = (scope: 'platform' | 'workspace'): ProviderProfile => ({
  id: 'openai',
  displayName: `OpenAI (${scope})`,
  category: 'INFERENCE',
  inferenceCapable: true,
  resourceVersion: 1,
  scope,
  source: 'user',
  credentials: [
    { name: 'api_key', envVars: ['OPENAI_API_KEY'], required: true },
  ],
  endpoints: ['api.openai.com:443'],
  networkEndpoints: [{ host: 'api.openai.com', port: 443, protocol: 'rest' }],
});

const refreshing: CredentialRefreshStatus = {
  credentialKey: 'OPENAI_API_KEY',
  strategy: 'OAUTH2_CLIENT_CREDENTIALS',
  status: 'active',
};

// What the gateway answers. A request that is refused gets `refusal`.
let providers: Provider[] = [];
let profiles: ProviderProfile[] = [];
let refreshStatuses: CredentialRefreshStatus[] = [];
let refused: Array<'providers' | 'provider' | 'refresh-status'> = [];
const requests: { path: string; method: string; body?: string }[] = [];

const refusal = { code: 'gateway_unavailable', message: 'gateway away' };

const answer = (status: number, body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);

const serve = (path: string, init?: RequestInit): Promise<Response> => {
  const method = init?.method ?? 'GET';
  requests.push({ path, method, body: init?.body as string | undefined });
  if (path.endsWith('/provider-profiles')) {
    return answer(200, profiles);
  }
  if (path.endsWith('/refresh-status')) {
    return refused.includes('refresh-status')
      ? answer(502, refusal)
      : answer(200, refreshStatuses);
  }
  if (path.endsWith('/refresh') && method === 'POST') {
    return answer(200, refreshing);
  }
  if (path.endsWith('/providers')) {
    return refused.includes('providers')
      ? answer(502, refusal)
      : answer(200, providers);
  }
  const named = providers.find((item) =>
    path.endsWith(`/providers/${item.metadata.name}`),
  );
  if (named) {
    return refused.includes('provider')
      ? answer(502, refusal)
      : answer(200, named);
  }
  return answer(404, { code: 'not_found', message: 'not found' });
};

let client: QueryClient;

const renderPage = (page: React.ReactNode) => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {page}
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

// One poll of a query, as its interval would run it.
const poll = async (queryKey: unknown[]) => {
  await act(async () => {
    await client.refetchQueries({ queryKey, exact: true });
  });
  // React hears of the answer on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  providers = [provider('p1')];
  profiles = [openai('platform')];
  refreshStatuses = [];
  refused = [];
  requests.length = 0;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
    serve(String(input), init),
  ) as jest.Mock;
});

afterEach(() => {
  client.clear();
});

describe('ProviderListPage while it is polled', () => {
  it('keeps an open Add provider dialog, and what was typed, when a poll fails', async () => {
    renderPage(<ProviderListPage workspace="team-a" />);
    fireEvent.click(await screen.findByTestId('create-provider'));
    fireEvent.change(await screen.findByTestId('provider-name-input'), {
      target: { value: 'typed-by-user' },
    });

    refused = ['providers'];
    await poll(['providers', 'team-a']);

    // The list that loaded is still there, with a note that it is stale.
    const notice = await screen.findByTestId('providers-refresh-error');
    expect(notice).toHaveTextContent('gateway away');
    expect(screen.getByTestId('provider-table')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load providers')).toBeNull();
    // And so is the dialog, as it was.
    expect(screen.getByTestId('provider-name-input')).toHaveValue(
      'typed-by-user',
    );

    refused = [];
    await poll(['providers', 'team-a']);
    await waitFor(() =>
      expect(screen.queryByTestId('providers-refresh-error')).toBeNull(),
    );
    expect(screen.getByTestId('provider-name-input')).toHaveValue(
      'typed-by-user',
    );
  });

  it('retries from the note about a failed poll', async () => {
    renderPage(<ProviderListPage workspace="team-a" />);
    await screen.findByTestId('provider-table');
    refused = ['providers'];
    await poll(['providers', 'team-a']);
    const notice = await screen.findByTestId('providers-refresh-error');

    refused = [];
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.queryByTestId('providers-refresh-error')).toBeNull(),
    );
  });

  it('still replaces the list with the error when it never loaded', async () => {
    refused = ['providers'];
    renderPage(<ProviderListPage workspace="team-a" />);

    expect(
      await screen.findByText('Failed to load providers'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('provider-table')).toBeNull();
    expect(screen.queryByTestId('providers-refresh-error')).toBeNull();
  });

  // The dialog is the same one whether the list behind it is empty or not: a
  // provider somebody else creates must not empty a form that is being
  // filled in.
  it('keeps an Add provider dialog opened over an empty list when a provider appears', async () => {
    providers = [];
    renderPage(<ProviderListPage workspace="team-a" />);
    fireEvent.click(await screen.findByTestId('create-provider-empty'));
    fireEvent.change(await screen.findByTestId('provider-name-input'), {
      target: { value: 'typed-by-user' },
    });

    providers = [provider('from-elsewhere')];
    await poll(['providers', 'team-a']);

    await screen.findByTestId('provider-table');
    expect(screen.getByTestId('provider-name-input')).toHaveValue(
      'typed-by-user',
    );
  });

  it('keeps it when the last provider is deleted elsewhere, too', async () => {
    renderPage(<ProviderListPage workspace="team-a" />);
    fireEvent.click(await screen.findByTestId('create-provider'));
    fireEvent.change(await screen.findByTestId('provider-name-input'), {
      target: { value: 'typed-by-user' },
    });

    providers = [];
    await poll(['providers', 'team-a']);

    await screen.findByText('No providers');
    expect(screen.getByTestId('provider-name-input')).toHaveValue(
      'typed-by-user',
    );
  });

  // The page a list is on can cease to exist: the list is polled, and rows
  // are deleted here and elsewhere.
  it('goes back to the last page that has rows when the list shrinks', async () => {
    providers = Array.from({ length: 11 }, (_unused, index) =>
      provider(`p${String(index + 1).padStart(2, '0')}`),
    );
    renderPage(<ProviderListPage workspace="team-a" />);
    await screen.findByTestId('provider-table');
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(screen.getByTestId('provider-link-p11')).toBeInTheDocument();

    providers = providers.slice(0, 10);
    await poll(['providers', 'team-a']);

    await waitFor(() =>
      expect(screen.queryByTestId('provider-link-p11')).toBeNull(),
    );
    expect(screen.getByTestId('provider-link-p01')).toBeInTheDocument();
    expect(screen.getByTestId('provider-link-p10')).toBeInTheDocument();
  });
});

describe('ProviderDetailPage while it is polled', () => {
  const openConfigureRefresh = async () => {
    fireEvent.click(await screen.findByTestId('configure-refresh-button'));
    fireEvent.change(await screen.findByTestId('refresh-credential-key'), {
      target: { value: 'OPENAI_API_KEY' },
    });
    fireEvent.click(screen.getByTestId('add-material-entry'));
    fireEvent.change(screen.getByLabelText('Material key 0'), {
      target: { value: 'client_secret' },
    });
    fireEvent.click(screen.getByLabelText('Secret'));
    fireEvent.change(screen.getByLabelText('Material value 0'), {
      target: { value: 's3cr3t-value' },
    });
  };

  it('keeps an open Configure refresh dialog, and what was typed, when a poll fails', async () => {
    renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);
    await openConfigureRefresh();

    refused = ['provider'];
    await poll(['providers', 'team-a', 'p1']);

    const notice = await screen.findByTestId('provider-refresh-error');
    expect(notice).toHaveTextContent('gateway away');
    expect(screen.queryByText('Failed to load provider p1')).toBeNull();
    expect(screen.getByTestId('provider-details-card')).toBeInTheDocument();
    expect(screen.getByLabelText('Material value 0')).toHaveValue(
      's3cr3t-value',
    );

    refused = [];
    await poll(['providers', 'team-a', 'p1']);
    await waitFor(() =>
      expect(screen.queryByTestId('provider-refresh-error')).toBeNull(),
    );
    expect(screen.getByLabelText('Material value 0')).toHaveValue(
      's3cr3t-value',
    );
  });

  it('keeps an open Edit provider dialog when a poll fails', async () => {
    renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);
    fireEvent.click(await screen.findByTestId('edit-provider-button'));
    fireEvent.change(
      await screen.findByTestId('edit-credential-api_key-input'),
      { target: { value: 'sk-new' } },
    );

    refused = ['provider'];
    await poll(['providers', 'team-a', 'p1']);

    await screen.findByTestId('provider-refresh-error');
    expect(screen.getByTestId('edit-credential-api_key-input')).toHaveValue(
      'sk-new',
    );
  });

  it('still replaces the page with the error when the provider never loaded', async () => {
    refused = ['provider'];
    renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);

    expect(
      await screen.findByText('Failed to load provider p1'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('provider-details-card')).toBeNull();
  });

  // Refresh material is secret. Nothing typed into the dialog may still be
  // there the next time it opens, and nothing of it may be left in the query
  // client once it has closed.
  it('forgets the refresh material once refresh has been configured', async () => {
    renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);
    await openConfigureRefresh();
    fireEvent.click(screen.getByTestId('configure-refresh-submit'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      requests.find((request) => request.method === 'POST')?.body,
    ).toContain('s3cr3t-value');

    await waitFor(() =>
      expect(
        JSON.stringify(
          client
            .getMutationCache()
            .getAll()
            .map((mutation) => mutation.state.variables),
        ),
      ).not.toContain('s3cr3t-value'),
    );

    fireEvent.click(screen.getByTestId('configure-refresh-button'));
    expect(await screen.findByTestId('refresh-credential-key')).toHaveValue('');
    expect(screen.queryByLabelText('Material value 0')).toBeNull();
  });

  it('forgets it when the dialog is cancelled, too', async () => {
    renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);
    await openConfigureRefresh();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByTestId('configure-refresh-button'));
    expect(await screen.findByTestId('refresh-credential-key')).toHaveValue('');
    expect(screen.queryByLabelText('Material value 0')).toBeNull();
  });

  describe('refresh status', () => {
    beforeEach(() => {
      refreshStatuses = [refreshing];
    });

    it('keeps the last known status, and its actions, when reading it again fails', async () => {
      renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);
      await screen.findByTestId('rotate-OPENAI_API_KEY');

      refused = ['refresh-status'];
      await poll(['provider-refresh', 'team-a', 'p1']);

      const notice = await screen.findByTestId('refresh-status-stale');
      expect(notice).toHaveTextContent('gateway away');
      const card = within(screen.getByTestId('provider-refresh-card'));
      expect(card.queryByText('No credential refresh configured')).toBeNull();
      expect(card.getByTestId('rotate-OPENAI_API_KEY')).toBeInTheDocument();
      expect(
        card.getByTestId('delete-refresh-OPENAI_API_KEY'),
      ).toBeInTheDocument();

      refused = [];
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(screen.queryByTestId('refresh-status-stale')).toBeNull(),
      );
    });

    it('does not say no refresh is configured when the status could not be read at all', async () => {
      refused = ['refresh-status'];
      renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);

      const notice = await screen.findByTestId('refresh-status-error');
      expect(notice).toHaveTextContent('gateway away');
      expect(
        within(screen.getByTestId('provider-refresh-card')).queryByText(
          'No credential refresh configured',
        ),
      ).toBeNull();
    });

    it('says no refresh is configured when the gateway says there is none', async () => {
      refreshStatuses = [];
      renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);

      expect(
        await within(
          await screen.findByTestId('provider-refresh-card'),
        ).findByText('No credential refresh configured'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('refresh-status-error')).toBeNull();
      expect(screen.queryByTestId('refresh-status-stale')).toBeNull();
    });

    // The gateway refuses a provider update that writes a credential a
    // refresh it performs manages. The page has the refresh status, so the
    // form does not offer the field.
    it('does not offer a new value for a credential that refresh manages', async () => {
      renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);
      await screen.findByTestId('rotate-OPENAI_API_KEY');
      fireEvent.click(screen.getByTestId('edit-provider-button'));

      expect(
        await screen.findByTestId('edit-credential-api_key-managed'),
      ).toHaveTextContent('credential refresh');
      expect(screen.queryByTestId('edit-credential-api_key-input')).toBeNull();
    });
  });

  // crates/openshell-server/src/provider_profile_sources.rs at v0.1.2,
  // scoped_type_profile_for_scope: a provider that names no profile scope
  // resolves a platform profile and never one imported into its workspace.
  it('shows a provider that names no scope as unprofiled when only the workspace has a profile of its type', async () => {
    profiles = [openai('workspace')];
    providers = [provider('p1', { profileWorkspace: undefined })];
    renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);

    // The workspace does list a profile with that id, so the page says why
    // it is not this provider's.
    expect(
      await screen.findByTestId('provider-unprofiled-alert'),
    ).toHaveTextContent('the provider names no profile scope');
    expect(screen.getByTestId('provider-profile-name')).toHaveTextContent(
      'none (legacy/unprofiled provider)',
    );
    expect(screen.getByTestId('provider-policy-card')).toHaveTextContent(
      'No provider profile found',
    );
  });

  it('shows the workspace profile for a provider that names its workspace', async () => {
    profiles = [openai('workspace')];
    providers = [provider('p1', { profileWorkspace: 'team-a' })];
    renderPage(<ProviderDetailPage workspace="team-a" providerName="p1" />);

    expect(
      await screen.findByTestId('provider-profile-name'),
    ).toHaveTextContent('OpenAI (workspace)');
    expect(screen.queryByTestId('provider-unprofiled-alert')).toBeNull();
  });
});
