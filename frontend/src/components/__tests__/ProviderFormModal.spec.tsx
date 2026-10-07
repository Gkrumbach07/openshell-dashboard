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
// The providers the workspace already has, which a new one is named against.
let mockProviders: Provider[] = [];

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
  useProviders: jest.fn(() => ({ data: mockProviders, isLoading: false })),
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
    mockProviders = [];
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
    // No configuration was changed, so none is sent: the gateway leaves a
    // map that is absent as it is.
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: { OPENAI_API_KEY: 'sk-rotated' },
      credentialExpiresAtMs: { OPENAI_API_KEY: 4070908800000 },
      config: undefined,
    });
  });

  // 0, epoch seconds and text that is no date used to be sent as an expiry in
  // 1970, which makes the gateway withhold the credential from every sandbox.
  it('does not send an expiry that is not a time still to come', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_API_KEY'] }));
    const expiry = screen.getByLabelText('api_key expiry');
    const save = screen.getByTestId('edit-provider-submit');
    // Something to save, so that what disables the button below is the
    // expiry and nothing else.
    fireEvent.change(screen.getByTestId('edit-credential-api_key-input'), {
      target: { value: 'sk-rotated' },
    });

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

// What the Edit Provider form sends as configuration: the entries that were
// changed and removed in the form, and no others. The gateway merges an update
// into the provider it holds, so an entry that is sent is written, whether or
// not the person editing meant it. The TUI builds its update the same way.
describe('ProviderFormModal configuration edits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles = [openai];
    mockProviders = [];
  });

  const edit = (existing: Provider, isOpen = true) => (
    <ProviderFormModal
      mode="edit"
      provider={existing}
      workspace="team-a"
      isOpen={isOpen}
      onClose={jest.fn()}
    />
  );
  const save = () => screen.getByTestId('edit-provider-submit');
  const rotate = () =>
    fireEvent.change(screen.getByTestId('edit-credential-api_key-input'), {
      target: { value: 'sk-rotated' },
    });

  // The bug: the form held the configuration it was first given and sent all
  // of it with every save, so saving an unrelated field put back values that
  // had since been changed elsewhere, and removed entries added elsewhere.
  it('does not write back configuration that changed while the form was open', () => {
    const { rerender } = render(
      edit(
        provider({
          credentialNames: ['OPENAI_API_KEY'],
          config: { region: 'us' },
        }),
      ),
    );
    // Somebody else changes the configuration and the page reads it again.
    rerender(
      edit(
        provider({
          credentialNames: ['OPENAI_API_KEY'],
          config: { region: 'eu', extra: '1' },
        }),
      ),
    );
    rotate();
    fireEvent.click(save());

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: { OPENAI_API_KEY: 'sk-rotated' },
      credentialExpiresAtMs: undefined,
      config: undefined,
    });
  });

  it('starts from the provider as it is each time the form opens', () => {
    const { rerender } = render(
      edit(provider({ config: { region: 'us' } }), false),
    );
    expect(screen.queryByTestId('edit-provider-submit')).toBeNull();
    // Changed elsewhere while the form was closed.
    rerender(edit(provider({ config: { region: 'eu' } }), true));
    expect(screen.getByTestId('edit-provider-config-value-0')).toHaveValue(
      'eu',
    );
  });

  it('sends a changed entry, an added one and a removed one, and leaves the rest', () => {
    render(
      edit(provider({ config: { region: 'us', tier: 'free', zone: 'a' } })),
    );
    // region changed, tier removed, zone untouched, team added.
    fireEvent.change(screen.getByTestId('edit-provider-config-value-0'), {
      target: { value: 'eu' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-config-remove-1'));
    fireEvent.click(screen.getByTestId('edit-provider-config-add'));
    fireEvent.change(screen.getByTestId('edit-provider-config-key-2'), {
      target: { value: 'team' },
    });
    fireEvent.change(screen.getByTestId('edit-provider-config-value-2'), {
      target: { value: 'ml' },
    });
    fireEvent.click(save());

    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: undefined,
      credentialExpiresAtMs: undefined,
      // An empty value is how the gateway is told to remove an entry.
      config: { region: 'eu', tier: '', team: 'ml' },
    });
  });

  // The gateway would take an update that names nothing, and write the
  // provider again as it is. The TUI refuses to send one.
  it('has nothing to save until something is changed', () => {
    render(edit(provider({ config: { region: 'us' } })));
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(mockUpdate).not.toHaveBeenCalled();

    // Changed and changed back is still nothing.
    const region = screen.getByTestId('edit-provider-config-value-0');
    fireEvent.change(region, { target: { value: 'eu' } });
    expect(save()).toBeEnabled();
    fireEvent.change(region, { target: { value: 'us' } });
    expect(save()).toBeDisabled();

    // An entry added and left without a key is nothing either.
    fireEvent.click(screen.getByTestId('edit-provider-config-add'));
    expect(save()).toBeDisabled();

    rotate();
    expect(save()).toBeEnabled();
  });
});

// The TUI fills in a name no provider has when a type is chosen: the type,
// then the type with -1, -2 and so on.
describe('ProviderFormModal default name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles = [openai, tokenExchange];
    mockProviders = [];
  });

  const nameInput = () => screen.getByTestId('provider-name-input');
  const chooseType = (chosen: ProviderProfile) =>
    fireEvent.change(screen.getByTestId('provider-type-select'), {
      target: { value: profileKey(chosen) },
    });

  it('fills in the type as the name when no provider has it', () => {
    renderCreate();
    expect(nameInput()).toHaveValue('');
    chooseType(openai);
    expect(nameInput()).toHaveValue('openai');
  });

  it('fills in the first name that is free in the workspace', () => {
    mockProviders = [
      provider(),
      { ...provider(), metadata: { ...provider().metadata, name: 'openai' } },
      { ...provider(), metadata: { ...provider().metadata, name: 'openai-1' } },
    ];
    renderCreate();
    chooseType(openai);
    expect(nameInput()).toHaveValue('openai-2');

    fireEvent.change(screen.getByTestId('create-credential-api_key-input'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByTestId('create-provider-submit'));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      name: 'openai-2',
      type: 'openai',
    });
  });

  it('follows the type while the name is still the one it filled in', () => {
    renderCreate();
    chooseType(openai);
    chooseType(tokenExchange);
    expect(nameInput()).toHaveValue('token-exchange');
  });

  it('keeps a name that was typed', () => {
    renderCreate();
    fireEvent.change(nameInput(), { target: { value: 'my-provider' } });
    chooseType(openai);
    expect(nameInput()).toHaveValue('my-provider');

    // Emptied, the field takes the default again.
    fireEvent.change(nameInput(), { target: { value: '' } });
    chooseType(tokenExchange);
    expect(nameInput()).toHaveValue('token-exchange');
  });
});

// A credential the profile accepts under several keys. The TUI has one input
// per key; here the value has one input and the key is chosen.
describe('ProviderFormModal credential keys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles = [openai, tokenExchange];
    mockProviders = [];
  });

  const keySelect = (credential: string, mode = 'create') =>
    screen.queryByTestId(`${mode}-credential-${credential}-key`);

  it('offers the choice only for a credential with more than one key', () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('provider-type-select'), {
      target: { value: profileKey(tokenExchange) },
    });
    expect(keySelect('subject_token')).not.toBeInTheDocument();
    const select = keySelect('access_token') as HTMLSelectElement;
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.value),
    ).toEqual(['ACCESS_TOKEN', 'ACCESS_TOKEN_FALLBACK']);
    // The first is the default, as before.
    expect(select).toHaveValue('ACCESS_TOKEN');
  });

  it('stores the value under the key that was chosen', () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('provider-name-input'), {
      target: { value: 'my-provider' },
    });
    fireEvent.change(screen.getByTestId('provider-type-select'), {
      target: { value: profileKey(tokenExchange) },
    });
    fireEvent.change(keySelect('access_token') as HTMLElement, {
      target: { value: 'ACCESS_TOKEN_FALLBACK' },
    });
    fireEvent.change(
      screen.getByTestId('create-credential-subject_token-input'),
      { target: { value: 'subject' } },
    );
    fireEvent.change(
      screen.getByTestId('create-credential-access_token-input'),
      { target: { value: 'access' } },
    );
    fireEvent.click(screen.getByTestId('create-provider-submit'));

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      credentials: {
        subject_token: 'subject',
        ACCESS_TOKEN_FALLBACK: 'access',
      },
    });
  });

  it('forgets the choice when another type is chosen', () => {
    renderCreate();
    const type = screen.getByTestId('provider-type-select');
    fireEvent.change(type, { target: { value: profileKey(tokenExchange) } });
    fireEvent.change(keySelect('access_token') as HTMLElement, {
      target: { value: 'ACCESS_TOKEN_FALLBACK' },
    });
    fireEvent.change(type, { target: { value: profileKey(openai) } });
    fireEvent.change(type, { target: { value: profileKey(tokenExchange) } });
    expect(keySelect('access_token')).toHaveValue('ACCESS_TOKEN');
  });

  // Editing, the default is the key the provider holds, so that a new value
  // replaces it. Another key can still be chosen, and the expiry goes with it.
  it('defaults to the held key when editing and marks it', () => {
    renderEdit(
      provider({
        type: 'token-exchange',
        profileWorkspace: 'team-a',
        credentialNames: ['subject_token', 'ACCESS_TOKEN_FALLBACK'],
      }),
    );
    const select = keySelect('access_token', 'edit') as HTMLSelectElement;
    expect(select).toHaveValue('ACCESS_TOKEN_FALLBACK');
    expect(
      Array.from(select.querySelectorAll('option')).map((o) => o.textContent),
    ).toEqual(['ACCESS_TOKEN', 'ACCESS_TOKEN_FALLBACK (held)']);

    fireEvent.change(select, { target: { value: 'ACCESS_TOKEN' } });
    fireEvent.change(screen.getByTestId('edit-credential-access_token-input'), {
      target: { value: 'second' },
    });
    fireEvent.change(screen.getByLabelText('access_token expiry'), {
      target: { value: '2099-01-01T00:00:00Z' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      credentials: { ACCESS_TOKEN: 'second' },
      credentialExpiresAtMs: { ACCESS_TOKEN: 4070908800000 },
    });
  });
});

// A provider whose type matches no profile: one created before profiles, or
// one whose profile was deleted since. The gateway still takes a new value for
// a credential it holds, and checks nothing else, because there is no profile
// to check it against.
describe('ProviderFormModal unprofiled provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles = [openai];
    mockProviders = [];
  });

  const legacy = (overrides: Partial<Provider> = {}) =>
    provider({
      type: 'gone',
      credentialNames: ['LEGACY_TOKEN', 'LEGACY_SECRET'],
      ...overrides,
    });

  it('offers a write-only input for each credential the provider holds', () => {
    renderEdit(legacy());
    expect(screen.getByTestId('edit-provider-unprofiled')).toHaveTextContent(
      'No provider profile matches the type "gone"',
    );
    for (const key of ['LEGACY_TOKEN', 'LEGACY_SECRET']) {
      const input = screen.getByTestId(`edit-credential-${key}-input`);
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveValue('');
    }
  });

  it('rotates a held credential and sets its expiry under its own key', () => {
    renderEdit(legacy());
    fireEvent.change(screen.getByTestId('edit-credential-LEGACY_TOKEN-input'), {
      target: { value: 'rotated' },
    });
    fireEvent.change(screen.getByLabelText('LEGACY_SECRET expiry'), {
      target: { value: '2099-01-01T00:00:00Z' },
    });
    fireEvent.click(screen.getByTestId('edit-provider-submit'));

    expect(mockUpdate.mock.calls[0][0]).toEqual({
      name: 'my-openai',
      credentials: { LEGACY_TOKEN: 'rotated' },
      credentialExpiresAtMs: { LEGACY_SECRET: 4070908800000 },
      config: undefined,
    });
  });

  it('says so when the provider holds no credential to rotate', () => {
    renderEdit(legacy({ credentialNames: [] }));
    expect(screen.getByTestId('edit-provider-unprofiled')).toHaveTextContent(
      'and it holds none',
    );
    expect(screen.queryByTestId(/^edit-credential-/)).not.toBeInTheDocument();
  });

  it('does not say so for a provider that has a profile', () => {
    renderEdit(provider({ credentialNames: ['OPENAI_API_KEY'] }));
    expect(
      screen.queryByTestId('edit-provider-unprofiled'),
    ).not.toBeInTheDocument();
  });
});

// A credential the gateway mints, as upstream's google-cloud profile declares
// one, here required.
const minted = profile({
  id: 'minted',
  scope: 'workspace',
  credentials: [
    {
      name: 'adc_token',
      envVars: ['GCP_ADC_ACCESS_TOKEN'],
      required: true,
      refresh: { strategy: 'OAUTH2_REFRESH_TOKEN' },
    },
  ],
});

// A required credential obtained through a token grant, beside a required one
// that has to be given.
const grantedAndTyped = profile({
  id: 'granted-and-typed',
  scope: 'workspace',
  credentials: [
    {
      name: 'access_token',
      envVars: ['ACCESS_TOKEN'],
      required: true,
      tokenGrant: {
        grantType: 'CLIENT_CREDENTIALS',
        tokenEndpoint: 'https://x',
      },
    },
    { name: 'api_key', envVars: ['API_KEY'], required: true },
  ],
});

// The CLI's `provider create --runtime-credentials`: a provider with no stored
// credentials, for a profile whose required credentials are all resolved at
// runtime, and for no other.
describe('ProviderFormModal runtime credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles = [openai, tokenExchange, minted, grantedAndTyped];
    mockProviders = [];
  });

  const choose = (chosen: ProviderProfile) => {
    fireEvent.change(screen.getByTestId('provider-name-input'), {
      target: { value: 'my-provider' },
    });
    fireEvent.change(screen.getByTestId('provider-type-select'), {
      target: { value: profileKey(chosen) },
    });
  };
  const submit = () => screen.getByTestId('create-provider-submit');
  const runtime = () => screen.queryByTestId('provider-runtime-credentials');

  it('does not offer them for a profile that needs a credential typed in', () => {
    renderCreate();
    for (const chosen of [openai, tokenExchange, grantedAndTyped]) {
      choose(chosen);
      expect(runtime()).not.toBeInTheDocument();
      // And the provider cannot be created empty.
      expect(submit()).toBeDisabled();
    }
  });

  it('creates a provider with no credentials when they are chosen', () => {
    renderCreate();
    choose(minted);
    // Typed before the choice was made: not sent once it is.
    fireEvent.change(screen.getByTestId('create-credential-adc_token-input'), {
      target: { value: 'left-over' },
    });
    fireEvent.click(runtime() as HTMLElement);

    // With nothing to store there is nothing to type.
    expect(
      screen.queryByTestId('create-credential-adc_token-input'),
    ).not.toBeInTheDocument();
    fireEvent.click(submit());

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toEqual({
      name: 'my-provider',
      type: 'minted',
      profileWorkspace: 'team-a',
      credentials: undefined,
      config: undefined,
    });
  });

  // The gateway takes the provider either way: a credential it mints needs no
  // value, whether or not the box is ticked, and may be given one.
  it('does not require a value for a credential that is minted', () => {
    renderCreate();
    choose(minted);
    expect(runtime()).not.toBeChecked();
    expect(
      screen.getByTestId('create-credential-adc_token-input'),
    ).not.toBeRequired();
    expect(submit()).toBeEnabled();

    fireEvent.change(screen.getByTestId('create-credential-adc_token-input'), {
      target: { value: 'ya29.initial' },
    });
    fireEvent.click(submit());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      credentials: { GCP_ADC_ACCESS_TOKEN: 'ya29.initial' },
    });
  });

  it('requires only the credential nothing resolves at runtime', () => {
    renderCreate();
    choose(grantedAndTyped);
    expect(
      screen.getByTestId('create-credential-access_token-input'),
    ).not.toBeRequired();
    expect(
      screen.getByTestId('create-credential-api_key-input'),
    ).toBeRequired();
    expect(submit()).toBeDisabled();

    fireEvent.change(screen.getByTestId('create-credential-api_key-input'), {
      target: { value: 'typed' },
    });
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      credentials: { API_KEY: 'typed' },
    });
  });

  it('forgets the choice when another profile is chosen', () => {
    renderCreate();
    choose(minted);
    fireEvent.click(runtime() as HTMLElement);
    expect(runtime()).toBeChecked();

    choose(openai);
    expect(runtime()).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();

    choose(minted);
    expect(runtime()).not.toBeChecked();
    expect(
      screen.getByTestId('create-credential-adc_token-input'),
    ).toBeInTheDocument();
  });

  it('does not offer them when editing a provider', () => {
    renderEdit(provider({ type: 'minted', profileWorkspace: 'team-a' }));
    expect(runtime()).not.toBeInTheDocument();
  });
});
