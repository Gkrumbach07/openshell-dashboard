import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ProviderFormModal from '../provider/ProviderFormModal';
import {
  credentialStorageKey,
  parseCredentialExpiry,
} from '../../utils/providerCredentials';
import {
  profileForProvider,
  profileKey,
  profileWorkspaceFor,
} from '../../utils/providerProfiles';
import type { Provider, ProviderProfile } from '../../types';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
let mockProfiles: ProviderProfile[] = [];

const mutation = (mutate: jest.Mock) => ({
  mutate,
  reset: jest.fn(),
  isPending: false,
  isError: false,
  error: null,
});

jest.mock('../../api/providers', () => ({
  useProviderProfiles: jest.fn(() => ({
    data: mockProfiles,
    isLoading: false,
  })),
  useCreateProvider: jest.fn(() => mutation(mockCreate)),
  useUpdateProvider: jest.fn(() => mutation(mockUpdate)),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn() })),
}));

jest.mock('../../slots', () => ({
  useSlots: jest.fn(() => ({})),
}));

const profile = (
  overrides: Partial<ProviderProfile> & Pick<ProviderProfile, 'id'>,
): ProviderProfile => ({
  displayName: overrides.id,
  category: 'INFERENCE',
  credentials: [],
  inferenceCapable: true,
  resourceVersion: 1,
  ...overrides,
});

// The profile upstream publishes for OpenAI: the credential has a name of its
// own and is injected under a differently named environment variable. It is
// built in, and the gateway reports a built-in profile with no scope.
const openai = profile({
  id: 'openai',
  credentials: [
    { name: 'api_key', envVars: ['OPENAI_API_KEY'], required: true },
  ],
});

// A profile imported into the workspace. Its first credential is one the
// gateway brokers without injecting it, so it declares no environment variable
// and is stored under its name.
const tokenExchange = profile({
  id: 'token-exchange',
  scope: 'workspace',
  credentials: [
    { name: 'subject_token', required: true },
    {
      name: 'access_token',
      envVars: ['ACCESS_TOKEN', 'ACCESS_TOKEN_FALLBACK'],
      required: false,
    },
  ],
});

// One id in two scopes: a platform profile and the workspace profile that
// shadows it. The gateway lists both, the platform one first, and they take
// their credential under different keys.
const acmePlatform = profile({
  id: 'acme',
  scope: 'platform',
  credentials: [
    { name: 'key', envVars: ['ACME_PLATFORM_KEY'], required: true },
  ],
});
const acmeWorkspace = profile({
  id: 'acme',
  scope: 'workspace',
  credentials: [
    { name: 'token', envVars: ['ACME_WORKSPACE_TOKEN'], required: true },
  ],
});

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

const renderEdit = (existing: Provider) =>
  render(
    <ProviderFormModal
      mode="edit"
      provider={existing}
      workspace="team-a"
      isOpen
      onClose={jest.fn()}
    />,
  );

const fillCreateForm = (
  chosen: ProviderProfile,
  values: Record<string, string>,
) => {
  fireEvent.change(screen.getByTestId('provider-name-input'), {
    target: { value: 'my-provider' },
  });
  fireEvent.change(screen.getByTestId('provider-type-select'), {
    target: { value: profileKey(chosen) },
  });
  for (const [credential, value] of Object.entries(values)) {
    fireEvent.change(
      screen.getByTestId(`create-credential-${credential}-input`),
      { target: { value } },
    );
  }
  fireEvent.click(screen.getByTestId('create-provider-submit'));
};

describe('credentialStorageKey', () => {
  it('is the env var when the credential declares one', () => {
    expect(credentialStorageKey(openai.credentials[0])).toBe('OPENAI_API_KEY');
  });

  it('is the name when the credential declares no env var', () => {
    expect(credentialStorageKey(tokenExchange.credentials[0])).toBe(
      'subject_token',
    );
    expect(
      credentialStorageKey({ name: 'api_key', envVars: [], required: true }),
    ).toBe('api_key');
  });

  it('is the first of several env vars unless the provider already uses another', () => {
    const credential = tokenExchange.credentials[1];
    expect(credentialStorageKey(credential)).toBe('ACCESS_TOKEN');
    expect(credentialStorageKey(credential, ['subject_token'])).toBe(
      'ACCESS_TOKEN',
    );
    expect(
      credentialStorageKey(credential, [
        'subject_token',
        'ACCESS_TOKEN_FALLBACK',
      ]),
    ).toBe('ACCESS_TOKEN_FALLBACK');
  });
});

describe('parseCredentialExpiry', () => {
  // A fixed "now" for the parser: 2026-10-06T00:00:00Z.
  const now = Date.UTC(2026, 9, 6);
  const parse = (text: string) => parseCredentialExpiry(text, now);

  it('reads epoch milliseconds and RFC 3339 dates', () => {
    expect(parse('1893456000000')).toBe(1893456000000);
    expect(parse(' 1893456000000 ')).toBe(1893456000000);
    expect(parse('2030-01-01T00:00:00Z')).toBe(1893456000000);
    expect(parse('2030-01-01t00:00:00z')).toBe(1893456000000);
    expect(parse('2030-01-01 00:00Z')).toBe(1893456000000);
    expect(parse('2030-01-01T01:00:00+01:00')).toBe(1893456000000);
    expect(parse('2030-01-01')).toBe(1893456000000);
  });

  it('leaves the expiry alone when the field is empty', () => {
    expect(parse('')).toBeUndefined();
    expect(parse('   ')).toBeUndefined();
  });

  // The gateway withholds a credential whose expiry has passed, so each of
  // these would switch the credential off. Read as milliseconds, a number in
  // epoch seconds is a day in January 1970.
  it('refuses anything that is not a time still to come', () => {
    for (const text of [
      '0',
      '-5',
      '1893456000', // 2030-01-01 in epoch seconds
      '2030',
      '20300101',
      '1969-12-31T23:59:59Z',
      '2020-01-01',
      '2026-10-05T23:59:59Z',
      'tomorrow',
      'Jan 1 2030',
      '2030-01-01T00:00:00', // no offset: whose midnight?
      '1.5',
      '2030-13-45T00:00:00Z',
      '2030-02-30', // not a day; Date.parse would make it March 2
    ]) {
      expect(parse(text)).toBeNaN();
    }
  });

  it('takes the present as its default for what is still to come', () => {
    expect(parseCredentialExpiry(String(Date.now() + 60_000))).not.toBeNaN();
    expect(parseCredentialExpiry(String(Date.now() - 60_000))).toBeNaN();
  });
});

describe('profile scope', () => {
  it('names the workspace only for a profile that lives in it', () => {
    expect(profileWorkspaceFor(tokenExchange, 'team-a')).toBe('team-a');
    expect(profileWorkspaceFor(acmeWorkspace, 'team-a')).toBe('team-a');
    expect(profileWorkspaceFor(acmePlatform, 'team-a')).toBeUndefined();
    expect(profileWorkspaceFor(openai, 'team-a')).toBeUndefined();
  });

  it('finds the profile a provider resolves to when its id is listed twice', () => {
    const listed = [openai, acmePlatform, acmeWorkspace];
    expect(
      profileForProvider(listed, { type: 'acme', profileWorkspace: 'team-a' }),
    ).toBe(acmeWorkspace);
    expect(profileForProvider(listed, { type: 'acme' })).toBe(acmePlatform);
    expect(
      profileForProvider(listed, {
        type: 'openai',
        profileWorkspace: 'team-a',
      }),
    ).toBe(openai);
    expect(profileForProvider(listed, { type: 'openai' })).toBe(openai);
    expect(profileForProvider(listed, { type: 'missing' })).toBeUndefined();
  });
});

describe('ProviderFormModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles = [openai, tokenExchange, acmePlatform, acmeWorkspace];
  });

  it('creates a provider with credentials under the key the gateway stores them at', () => {
    renderCreate();
    fillCreateForm(openai, { api_key: 'sk-test' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    // A built-in profile is not in the workspace, so no profile scope is named.
    expect(mockCreate.mock.calls[0][0]).toEqual({
      name: 'my-provider',
      type: 'openai',
      profileWorkspace: undefined,
      credentials: { OPENAI_API_KEY: 'sk-test' },
      config: undefined,
    });
  });

  it('names the workspace as the profile scope for a profile imported into it', () => {
    renderCreate();
    fillCreateForm(tokenExchange, {
      subject_token: 'subject',
      access_token: 'access',
    });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      type: 'token-exchange',
      profileWorkspace: 'team-a',
      credentials: { subject_token: 'subject', ACCESS_TOKEN: 'access' },
    });
  });

  // The same id in two scopes is two choices. Each sends the scope that makes
  // the gateway resolve the profile whose fields were filled in.
  it('offers a shadowed id once per scope and sends the scope that was chosen', () => {
    renderCreate();
    const options = Array.from(
      screen.getByTestId('provider-type-select').querySelectorAll('option'),
    ).map((option) => option.textContent);
    expect(options).toContain('acme (INFERENCE, platform profile)');
    expect(options).toContain('acme (INFERENCE, workspace profile)');
    expect(options).toContain('openai (INFERENCE)');

    fillCreateForm(acmeWorkspace, { token: 'ws-secret' });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      type: 'acme',
      profileWorkspace: 'team-a',
      credentials: { ACME_WORKSPACE_TOKEN: 'ws-secret' },
    });
  });

  it('sends no profile scope for the platform profile a workspace profile shadows', () => {
    renderCreate();
    fillCreateForm(acmePlatform, { key: 'platform-secret' });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      type: 'acme',
      profileWorkspace: undefined,
      credentials: { ACME_PLATFORM_KEY: 'platform-secret' },
    });
  });

  it('edits a provider with the fields of the profile it resolves to', () => {
    const { unmount } = renderEdit(
      provider({ type: 'acme', profileWorkspace: 'team-a' }),
    );
    expect(
      screen.getByTestId('edit-credential-token-input'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('edit-credential-key-input'),
    ).not.toBeInTheDocument();
    unmount();

    renderEdit(provider({ type: 'acme' }));
    expect(screen.getByTestId('edit-credential-key-input')).toBeInTheDocument();
    expect(
      screen.queryByTestId('edit-credential-token-input'),
    ).not.toBeInTheDocument();
  });

  it('rotates a credential and sets its expiry under the stored key', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_API_KEY'] }));
    fireEvent.change(screen.getByTestId('edit-credential-api_key-input'), {
      target: { value: 'sk-rotated' },
    });
    // Far enough ahead that the form, which compares with the clock, takes it
    // as a time still to come for as long as this test is likely to run.
    fireEvent.change(screen.getByLabelText('api_key expiry'), {
      target: { value: '2099-01-01T00:00:00Z' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: { OPENAI_API_KEY: 'sk-rotated' },
      credentialExpiresAtMs: { OPENAI_API_KEY: 4070908800000 },
      config: {},
    });
  });

  // 0, epoch seconds and text that is no date used to be sent as an expiry in
  // 1970, which makes the gateway withhold the credential from every sandbox.
  it('does not send an expiry that is not a time still to come', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_API_KEY'] }));
    const expiry = screen.getByLabelText('api_key expiry');
    const save = screen.getByTestId('edit-provider-submit');

    for (const text of [
      '0',
      '1893456000',
      '2020-01-01',
      'next week',
      '2099-01-01T00:00:00',
    ]) {
      fireEvent.change(expiry, { target: { value: text } });
      expect(save).toBeDisabled();
      expect(
        screen.getByText(/Enter a future date such as/),
      ).toBeInTheDocument();
      fireEvent.click(save);
    }
    expect(mockUpdate).not.toHaveBeenCalled();

    fireEvent.change(expiry, { target: { value: '' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      credentialExpiresAtMs: undefined,
    });
  });

  it('rotates the key a provider already holds instead of adding a second one', () => {
    renderEdit(
      provider({
        type: 'token-exchange',
        profileWorkspace: 'team-a',
        credentialNames: ['subject_token', 'ACCESS_TOKEN_FALLBACK'],
      }),
    );
    fireEvent.change(screen.getByTestId('edit-credential-access_token-input'), {
      target: { value: 'rotated' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      credentials: { ACCESS_TOKEN_FALLBACK: 'rotated' },
    });
  });

  it('sends no credentials when an edit leaves them blank', () => {
    renderEdit(provider({ config: { region: 'us' } }));
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: undefined,
      credentialExpiresAtMs: undefined,
      config: { region: 'us' },
    });
  });
});
