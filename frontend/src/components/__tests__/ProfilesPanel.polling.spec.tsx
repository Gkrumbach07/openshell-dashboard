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

import ProfilesPanel from '../provider/ProfilesPanel';
import type { ProviderProfile } from '../../types';

// The panel, its dialogs and the hooks under them are the real ones, on a
// real query client. Only the HTTP calls are stubbed, so that a poll can be
// made to fail, or to bring in a profile somebody else imported, while a
// dialog is open.

const acme: ProviderProfile = {
  id: 'acme',
  displayName: 'Acme',
  category: 'OTHER',
  credentials: [],
  inferenceCapable: false,
  resourceVersion: 1,
  scope: 'workspace',
  source: 'user',
};

let listed: ProviderProfile[] = [];
let listRefused = false;

const answer = (status: number, body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);

const serve = (path: string, init?: RequestInit): Promise<Response> => {
  const method = init?.method ?? 'GET';
  if (path.endsWith('/provider-profiles/lint')) {
    return answer(200, { valid: true, diagnostics: [] });
  }
  if (path.endsWith('/provider-profiles') && method === 'GET') {
    return listRefused
      ? answer(502, { code: 'gateway_unavailable', message: 'gateway away' })
      : answer(200, listed);
  }
  return answer(404, { code: 'not_found', message: 'not found' });
};

let client: QueryClient;

const renderPanel = () => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProfilesPanel scope="team-a" canManage />
    </QueryClientProvider>,
  );
};

// One poll of the profile list, as its interval would run it.
const poll = async () => {
  await act(async () => {
    await client.refetchQueries({
      queryKey: ['provider-profiles', 'team-a'],
      exact: true,
    });
  });
  // React hears of the answer on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const chooseFile = async (name: string, text: string) => {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File([text], name, { type: 'application/yaml' })] },
    });
  });
  await screen.findByTestId('profile-files');
};

beforeEach(() => {
  listed = [acme];
  listRefused = false;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
    serve(String(input), init),
  ) as jest.Mock;
});

afterEach(() => {
  client.clear();
});

describe('ProfilesPanel while it is polled', () => {
  it('keeps an open import dialog, and the files chosen in it, when a poll fails', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('import-profiles'));
    await chooseFile('other.yaml', 'id: other\ndisplay_name: Other\n');

    listRefused = true;
    await poll();

    // The profiles that loaded are still listed, with a note that they are
    // stale.
    const notice = await screen.findByTestId('profiles-refresh-error');
    expect(notice).toHaveTextContent('gateway away');
    expect(screen.getByTestId('profiles-table')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load provider profiles')).toBeNull();
    // And so is the dialog, with its file.
    expect(
      within(screen.getByTestId('profile-files')).getByText('other.yaml'),
    ).toBeInTheDocument();

    // The next poll gets through, and the note goes.
    listRefused = false;
    await poll();
    await waitFor(() =>
      expect(screen.queryByTestId('profiles-refresh-error')).toBeNull(),
    );
    expect(
      within(screen.getByTestId('profile-files')).getByText('other.yaml'),
    ).toBeInTheDocument();
  });

  it('retries from the note about a failed poll', async () => {
    renderPanel();
    await screen.findByTestId('profiles-table');
    listRefused = true;
    await poll();
    const notice = await screen.findByTestId('profiles-refresh-error');

    listRefused = false;
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.queryByTestId('profiles-refresh-error')).toBeNull(),
    );
    expect(screen.getByTestId('profiles-table')).toBeInTheDocument();
  });

  it('still replaces the list with the error when it never loaded', async () => {
    listRefused = true;
    renderPanel();

    expect(
      await screen.findByText('Failed to load provider profiles'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('profiles-table')).toBeNull();
    expect(screen.queryByTestId('profiles-refresh-error')).toBeNull();
  });

  // The dialogs are the same ones whether the list behind them is empty or
  // not: a profile somebody else imports must not empty a form that is being
  // filled in.
  it('keeps a Create profile dialog opened over an empty list when a profile appears', async () => {
    listed = [];
    renderPanel();
    fireEvent.click(await screen.findByTestId('create-profile-empty'));
    fireEvent.change(await screen.findByTestId('profile-id-input'), {
      target: { value: 'my-profile' },
    });

    listed = [acme];
    await poll();

    await screen.findByTestId('profiles-table');
    expect(screen.getByTestId('profile-id-input')).toHaveValue('my-profile');
  });

  it('keeps the files chosen for an import when the last profile is deleted elsewhere', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('import-profiles'));
    await chooseFile('other.yaml', 'id: other\ndisplay_name: Other\n');

    listed = [];
    await poll();

    await screen.findByText('No provider profiles');
    expect(
      within(screen.getByTestId('profile-files')).getByText('other.yaml'),
    ).toBeInTheDocument();
  });
});
