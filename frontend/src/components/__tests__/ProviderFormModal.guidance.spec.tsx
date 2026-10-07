import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import ProviderFormModal from '../provider/ProviderFormModal';
import type { Provider, ProviderProfile } from '../../types';

// What the form says, and leaves out, when what it offers could not be
// carried out: a provider type cannot be chosen, a credential belongs to a
// refresh, or an expiry would be set on a credential the provider does not
// hold.

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRefetchProfiles = jest.fn();

type ProfilesQuery = {
  data?: ProviderProfile[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockProfilesQuery: ProfilesQuery;

const loaded = (profiles: ProviderProfile[]): ProfilesQuery => ({
  data: profiles,
  isLoading: false,
  isError: false,
  error: null,
  refetch: mockRefetchProfiles,
});

const mutation = (mutate: jest.Mock) => ({
  mutate,
  reset: jest.fn(),
  isPending: false,
  isError: false,
  error: null,
});

jest.mock('../../api/providers', () => ({
  useProviderProfiles: jest.fn(() => mockProfilesQuery),
  useProviders: jest.fn(() => ({ data: [], isLoading: false })),
  useCreateProvider: jest.fn(() => mutation(mockCreate)),
  useUpdateProvider: jest.fn(() => mutation(mockUpdate)),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn() })),
}));

jest.mock('../../slots', () => ({
  useSlots: jest.fn(() => ({})),
}));

const openai: ProviderProfile = {
  id: 'openai',
  displayName: 'OpenAI',
  category: 'INFERENCE',
  inferenceCapable: true,
  resourceVersion: 1,
  scope: 'platform',
  credentials: [
    { name: 'api_key', envVars: ['OPENAI_API_KEY'], required: true },
    {
      name: 'org',
      envVars: ['OPENAI_ORG', 'OPENAI_ORGANIZATION'],
      required: false,
    },
  ],
};

const provider = (overrides: Partial<Provider> = {}): Provider => ({
  metadata: {
    id: 'p-1',
    name: 'my-openai',
    workspace: 'team-a',
    createdAtMs: 0,
    resourceVersion: 3,
  },
  type: 'openai',
  ...overrides,
});

const renderCreate = () =>
  render(
    <ProviderFormModal
      mode="create"
      workspace="team-a"
      isOpen
      onClose={jest.fn()}
    />,
  );

const renderEdit = (existing: Provider, refreshManagedKeys?: string[]) =>
  render(
    <ProviderFormModal
      mode="edit"
      provider={existing}
      workspace="team-a"
      isOpen
      onClose={jest.fn()}
      refreshManagedKeys={refreshManagedKeys}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockProfilesQuery = loaded([openai]);
});

// A provider is created from a provider profile. A 0.1.2 gateway has none
// until one is imported, so a dialog with an empty list of types is what a
// new deployment shows first.
describe('Add provider without a provider type to choose', () => {
  it('says so, and where a profile comes from, when the gateway has no profiles', () => {
    mockProfilesQuery = loaded([]);
    renderCreate();

    const notice = screen.getByTestId('create-provider-no-profiles');
    expect(notice).toHaveTextContent('No provider profiles');
    expect(notice).toHaveTextContent('Import');
    expect(notice).toHaveTextContent('openshell provider profile import');
    expect(screen.getByTestId('create-provider-submit')).toBeDisabled();
    expect(
      screen.queryByTestId('create-provider-profiles-error'),
    ).not.toBeInTheDocument();
  });

  it('says the profiles could not be loaded, with a retry, when the request failed', () => {
    mockProfilesQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('OpenShell gateway is unreachable'),
      refetch: mockRefetchProfiles,
    };
    renderCreate();

    const notice = screen.getByTestId('create-provider-profiles-error');
    expect(notice).toHaveTextContent('Provider profiles could not be loaded');
    expect(notice).toHaveTextContent('OpenShell gateway is unreachable');
    // Not the other thing: nothing is known about which profiles there are.
    expect(
      screen.queryByTestId('create-provider-no-profiles'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('create-provider-submit')).toBeDisabled();

    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(mockRefetchProfiles).toHaveBeenCalledTimes(1);
  });

  // Profiles read earlier still stand when reading them again fails.
  it('goes on with the profiles it has when a later read of them fails', () => {
    mockProfilesQuery = {
      ...loaded([openai]),
      isError: true,
      error: new Error('OpenShell gateway is unreachable'),
    };
    renderCreate();

    expect(
      screen.queryByTestId('create-provider-profiles-error'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('create-provider-no-profiles'),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('provider-type-select')).getByRole('option', {
        name: /OpenAI/,
      }),
    ).toBeInTheDocument();
  });

  it('says neither when there are profiles to choose from', () => {
    renderCreate();

    expect(
      screen.queryByTestId('create-provider-no-profiles'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('create-provider-profiles-error'),
    ).not.toBeInTheDocument();
  });
});

// The gateway refuses a provider update that writes a credential a refresh it
// performs manages ("credentials managed by provider refresh cannot be
// updated or deleted with provider update"). Where the form is told which
// those are, it does not offer them.
describe('Edit provider and credentials that refresh manages', () => {
  it('offers no value for a managed credential and says who changes it', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_API_KEY'] }), [
      'OPENAI_API_KEY',
    ]);

    expect(
      screen.queryByTestId('edit-credential-api_key-input'),
    ).not.toBeInTheDocument();
    const note = screen.getByTestId('edit-credential-api_key-managed');
    expect(note).toHaveTextContent('Managed by credential refresh');
    // The credential beside it is as it always was.
    expect(screen.getByTestId('edit-credential-org-input')).toBeInTheDocument();
  });

  it('counts a credential as managed under any key it may be stored at', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_ORGANIZATION'] }), [
      'OPENAI_ORGANIZATION',
    ]);

    expect(
      screen.queryByTestId('edit-credential-org-input'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('edit-credential-org-managed'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('edit-credential-api_key-input'),
    ).toBeInTheDocument();
  });

  it('does the same for a provider without a profile', () => {
    renderEdit(
      provider({ type: 'gone', credentialNames: ['TOKEN', 'OTHER'] }),
      ['TOKEN'],
    );

    expect(
      screen.queryByTestId('edit-credential-TOKEN-input'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('edit-credential-TOKEN-managed'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('edit-credential-OTHER-input'),
    ).toBeInTheDocument();
  });

  it('offers every credential when it is not told of any refresh', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_API_KEY'] }));

    expect(
      screen.getByTestId('edit-credential-api_key-input'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('edit-credential-api_key-managed'),
    ).not.toBeInTheDocument();
  });

  it('sends nothing for a managed credential', () => {
    renderEdit(
      provider({
        credentialNames: ['OPENAI_API_KEY'],
        config: { region: 'us' },
      }),
      ['OPENAI_API_KEY'],
    );
    fireEvent.change(screen.getByTestId('edit-provider-config-value-0'), {
      target: { value: 'eu' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: undefined,
      credentialExpiresAtMs: undefined,
      config: { region: 'eu' },
    });
  });
});

// An expiry is the expiry of a credential the provider holds. Sent for one it
// does not hold, it is an expiry of nothing.
describe('Edit provider and the expiry of a credential the provider does not hold', () => {
  const FUTURE = '2099-01-01T00:00:00Z';
  const FUTURE_MS = 4070908800000;

  it('offers an expiry for a credential the provider holds', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_API_KEY'] }));

    expect(screen.getByLabelText('api_key expiry')).toBeInTheDocument();
    // "org" is declared by the profile and not held.
    expect(screen.queryByLabelText('org expiry')).not.toBeInTheDocument();
  });

  it('offers one once a value is given, and sends both', () => {
    renderEdit(provider({ credentialNames: [] }));
    expect(screen.queryByLabelText('api_key expiry')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('edit-credential-api_key-input'), {
      target: { value: 'sk-first' },
    });
    fireEvent.change(screen.getByLabelText('api_key expiry'), {
      target: { value: FUTURE },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      credentials: { OPENAI_API_KEY: 'sk-first' },
      credentialExpiresAtMs: { OPENAI_API_KEY: FUTURE_MS },
    });
  });

  it('sends no expiry when the value it was typed for is taken out again', () => {
    renderEdit(provider({ credentialNames: [], config: { region: 'us' } }));
    const value = screen.getByTestId('edit-credential-api_key-input');
    fireEvent.change(value, { target: { value: 'sk-first' } });
    fireEvent.change(screen.getByLabelText('api_key expiry'), {
      target: { value: FUTURE },
    });
    fireEvent.change(value, { target: { value: '' } });
    // Something else to save, so that the request is made.
    fireEvent.change(screen.getByTestId('edit-provider-config-value-0'), {
      target: { value: 'eu' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: undefined,
      credentialExpiresAtMs: undefined,
      config: { region: 'eu' },
    });
  });

  // The key chooser can point a credential at a key the provider does not
  // hold. Without a value there is nothing under that key to expire.
  it('sends no expiry under a key that was chosen and is not held', () => {
    renderEdit(
      provider({
        credentialNames: ['OPENAI_ORG'],
        config: { region: 'us' },
      }),
    );
    fireEvent.change(screen.getByLabelText('org expiry'), {
      target: { value: FUTURE },
    });
    fireEvent.change(screen.getByTestId('edit-credential-org-key'), {
      target: { value: 'OPENAI_ORGANIZATION' },
    });
    fireEvent.change(screen.getByTestId('edit-provider-config-value-0'), {
      target: { value: 'eu' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      credentialExpiresAtMs: undefined,
    });
  });
});
