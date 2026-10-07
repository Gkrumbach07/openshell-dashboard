import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import ConfigureRefreshModal from '../provider/ConfigureRefreshModal';
import CredentialRefreshCard from '../provider/CredentialRefreshCard';
import type { CredentialRefreshStatus, ProviderProfile } from '../../types';

describe('CredentialRefreshCard', () => {
  const renderCard = (statuses: CredentialRefreshStatus[], isAdmin = true) =>
    render(
      <CredentialRefreshCard
        refreshStatuses={statuses}
        isAdmin={isAdmin}
        onConfigure={jest.fn()}
        hasCredentials
        onRotate={jest.fn()}
        isRotating={false}
        onDelete={jest.fn()}
      />,
    );

  const healthy: CredentialRefreshStatus = {
    credentialKey: 'GCP_SA_ACCESS_TOKEN',
    strategy: 'GOOGLE_SERVICE_ACCOUNT_JWT',
    status: 'active',
    nextRefreshAtMs: Date.UTC(2030, 0, 1),
    lastRefreshAtMs: Date.UTC(2029, 11, 31),
  };

  const failed = (
    recoveryAction: string,
    overrides: Partial<CredentialRefreshStatus> = {},
  ): CredentialRefreshStatus => ({
    credentialKey: 'GCP_ADC_ACCESS_TOKEN',
    strategy: 'OAUTH2_REFRESH_TOKEN',
    status: 'failed',
    lastError: 'the refresh token was revoked',
    recoveryAction,
    failureCode: 'oauth_invalid_grant',
    providerErrorSubtype: 'token_revoked',
    lastErrorAtMs: Date.UTC(2029, 11, 31),
    ...overrides,
  });

  // What the gateway says a failed refresh needs is the point of the status:
  // each action is shown with what it asks of whoever is reading.
  it.each([
    ['RETRY', 'retrying', 'The gateway will try again by itself.'],
    [
      'REAUTHORIZE',
      'reauthorize',
      'Configure refresh again with new material to replace it.',
    ],
    [
      'FIX_CONFIGURATION',
      'fix configuration',
      'The refresh is configured wrongly.',
    ],
    [
      'INVESTIGATE',
      'investigate',
      'The gateway does not recognize this failure.',
    ],
  ])('says what a failed refresh needs: %s', (action, label, advice) => {
    renderCard([healthy, failed(action)]);

    const notice = screen.getByTestId('refresh-recovery-GCP_ADC_ACCESS_TOKEN');
    expect(notice).toHaveTextContent(
      `Refresh of GCP_ADC_ACCESS_TOKEN failed: ${label}`,
    );
    expect(notice).toHaveTextContent(advice);
    // The gateway's own code for the failure, and its refinement.
    expect(notice).toHaveTextContent(
      'Failure code: oauth_invalid_grant / token_revoked.',
    );
    // Nothing is said about the credential that is working.
    expect(
      screen.queryByTestId('refresh-recovery-GCP_SA_ACCESS_TOKEN'),
    ).not.toBeInTheDocument();
  });

  it('shows the recovery action and failure code in the table', () => {
    renderCard([healthy, failed('REAUTHORIZE')]);
    const [header, working, broken] = screen.getAllByRole('row');
    const column = (name: string) =>
      within(header)
        .getAllByRole('columnheader')
        .findIndex((cell) => cell.textContent === name);
    const cell = (row: HTMLElement, name: string) =>
      within(row).getAllByRole('cell')[column(name)];

    expect(cell(working, 'Recovery')).toHaveTextContent('-');
    expect(cell(working, 'Failure code')).toHaveTextContent('-');
    expect(cell(broken, 'Recovery')).toHaveTextContent('Reauthorize');
    expect(cell(broken, 'Failure code')).toHaveTextContent(
      'oauth_invalid_grant / token_revoked',
    );
    expect(cell(broken, 'Last error')).toHaveTextContent(
      'the refresh token was revoked',
    );
  });

  // A refresh with no next time is not scheduled. That is not a dash: with a
  // recovery action beside it, it is a refresh waiting on someone.
  it('says a refresh is not scheduled when it has no next time', () => {
    renderCard([failed('REAUTHORIZE')]);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Not scheduled');
  });

  it('shows an action it has no words for by its name', () => {
    renderCard([
      failed('ESCALATE', {
        failureCode: undefined,
        providerErrorSubtype: undefined,
      }),
    ]);
    const notice = screen.getByTestId('refresh-recovery-GCP_ADC_ACCESS_TOKEN');
    expect(notice).toHaveTextContent(
      'The gateway reports the recovery action ESCALATE.',
    );
    expect(notice).not.toHaveTextContent('Failure code');
  });

  it('shows no notice when every refresh is working', () => {
    renderCard([healthy]);
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('active');
  });

  // The status is polled. A poll that fails says nothing about the refreshes:
  // the ones that were read before are still configured, and still have to be
  // rotated and deleted from here.
  it('keeps the statuses it has, and their actions, when reading them again failed', () => {
    const retry = jest.fn();
    render(
      <CredentialRefreshCard
        refreshStatuses={[healthy]}
        statusError={new Error('OpenShell gateway is unreachable')}
        onRetryStatus={retry}
        isAdmin
        onConfigure={jest.fn()}
        hasCredentials
        onRotate={jest.fn()}
        isRotating={false}
        onDelete={jest.fn()}
      />,
    );

    const notice = screen.getByTestId('refresh-status-stale');
    expect(notice).toHaveTextContent(
      'The credential refresh status could not be refreshed',
    );
    expect(notice).toHaveTextContent('OpenShell gateway is unreachable');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(
      'GCP_SA_ACCESS_TOKEN',
    );
    expect(screen.getByTestId('rotate-GCP_SA_ACCESS_TOKEN')).toBeEnabled();
    expect(
      screen.getByTestId('delete-refresh-GCP_SA_ACCESS_TOKEN'),
    ).toBeEnabled();
    expect(
      screen.queryByText('No credential refresh configured'),
    ).not.toBeInTheDocument();

    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  // A status that was never read is not a provider without refresh.
  it('says the status could not be loaded when there is none to show', () => {
    const retry = jest.fn();
    render(
      <CredentialRefreshCard
        refreshStatuses={[]}
        statusError={new Error('OpenShell gateway is unreachable')}
        isStatusKnown={false}
        onRetryStatus={retry}
        isAdmin
        onConfigure={jest.fn()}
        hasCredentials
        onRotate={jest.fn()}
        isRotating={false}
        onDelete={jest.fn()}
      />,
    );

    const notice = screen.getByTestId('refresh-status-error');
    expect(notice).toHaveTextContent(
      'The credential refresh status could not be loaded',
    );
    expect(notice).toHaveTextContent('OpenShell gateway is unreachable');
    expect(
      screen.queryByText('No credential refresh configured'),
    ).not.toBeInTheDocument();

    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  // Nor is one that is still being read for the first time.
  it('says nothing either way while the status is first being read', () => {
    render(
      <CredentialRefreshCard
        refreshStatuses={[]}
        isStatusKnown={false}
        isAdmin
        onConfigure={jest.fn()}
        hasCredentials
        onRotate={jest.fn()}
        isRotating={false}
        onDelete={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText('Loading credential refresh status'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No credential refresh configured'),
    ).not.toBeInTheDocument();
  });

  it('says no refresh is configured when the gateway says there is none', () => {
    renderCard([]);
    expect(screen.getByText('No credential refresh configured')).toBeVisible();
    expect(screen.queryByTestId('refresh-status-error')).toBeNull();
    expect(screen.queryByTestId('refresh-status-stale')).toBeNull();
  });
});

describe('ConfigureRefreshModal', () => {
  // upstream's google-cloud profile: two credentials, each with a refresh the
  // gateway performs.
  const google: ProviderProfile = {
    id: 'google-cloud',
    displayName: 'Google Cloud',
    category: 'OTHER',
    inferenceCapable: false,
    resourceVersion: 1,
    credentials: [
      {
        name: 'service_account_token',
        envVars: ['GCP_SA_ACCESS_TOKEN'],
        required: false,
        refresh: {
          strategy: 'GOOGLE_SERVICE_ACCOUNT_JWT',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          material: [
            { name: 'client_email', required: true, secret: false },
            {
              name: 'private_key',
              description: 'Service account RSA private key (PEM)',
              required: true,
              secret: true,
            },
          ],
        },
      },
      { name: 'plain', envVars: ['PLAIN_KEY'], required: false },
    ],
  };

  const onSubmit = jest.fn();
  const renderModal = (profile?: ProviderProfile) =>
    render(
      <ConfigureRefreshModal
        isOpen
        credentialNames={['GCP_SA_ACCESS_TOKEN', 'PLAIN_KEY']}
        profile={profile}
        isSubmitting={false}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

  beforeEach(() => jest.clearAllMocks());

  // `provider refresh configure --strategy` takes these four. The gateway
  // refuses static and external here as not gateway-mintable, so they are not
  // offered.
  it('offers the strategies the gateway performs', () => {
    renderModal();
    const options = Array.from(
      screen.getByTestId('refresh-strategy').querySelectorAll('option'),
    ).map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual([
      'oauth2-refresh-token',
      'oauth2-client-credentials',
      'google-service-account-jwt',
      'aws-sts-assume-role',
    ]);
  });

  it('starts from the refresh the profile declares for the credential', () => {
    renderModal(google);
    fireEvent.change(screen.getByTestId('refresh-credential-key'), {
      target: { value: 'GCP_SA_ACCESS_TOKEN' },
    });

    expect(screen.getByTestId('refresh-strategy')).toHaveValue(
      'google-service-account-jwt',
    );
    expect(screen.getByText(/The provider profile declares/)).toHaveTextContent(
      'google_service_account_jwt for this credential, at https://oauth2.googleapis.com/token',
    );
    // A row for each input the refresh needs, secret where the profile says.
    expect(screen.getByLabelText('Material key 0')).toHaveValue('client_email');
    expect(screen.getByLabelText('Material key 1')).toHaveValue('private_key');
    expect(screen.getByLabelText('Material value 0')).toHaveAttribute(
      'type',
      'text',
    );
    expect(screen.getByLabelText('Material value 1')).toHaveAttribute(
      'type',
      'password',
    );

    fireEvent.change(screen.getByLabelText('Material value 0'), {
      target: { value: 'sa@example.iam.gserviceaccount.com' },
    });
    fireEvent.change(screen.getByLabelText('Material value 1'), {
      target: { value: '-----BEGIN PRIVATE KEY-----' },
    });
    fireEvent.click(screen.getByTestId('configure-refresh-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      credentialKey: 'GCP_SA_ACCESS_TOKEN',
      strategy: 'google-service-account-jwt',
      material: {
        client_email: 'sa@example.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----',
      },
      secretMaterialKeys: ['private_key'],
    });
  });

  it('leaves the form as it is for a credential the profile declares no refresh for', () => {
    renderModal(google);
    fireEvent.change(screen.getByTestId('refresh-strategy'), {
      target: { value: 'oauth2-client-credentials' },
    });
    fireEvent.change(screen.getByTestId('refresh-credential-key'), {
      target: { value: 'PLAIN_KEY' },
    });

    expect(screen.getByTestId('refresh-strategy')).toHaveValue(
      'oauth2-client-credentials',
    );
    expect(screen.queryByLabelText('Material key 0')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/The provider profile declares/),
    ).not.toBeInTheDocument();
  });

  it('works without a profile', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('refresh-credential-key'), {
      target: { value: 'PLAIN_KEY' },
    });
    fireEvent.click(screen.getByTestId('configure-refresh-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      credentialKey: 'PLAIN_KEY',
      strategy: 'oauth2-refresh-token',
    });
  });

  const addEntry = (index: number, key: string, value: string) => {
    fireEvent.click(screen.getByTestId('add-material-entry'));
    fireEvent.change(screen.getByLabelText(`Material key ${index}`), {
      target: { value: key },
    });
    fireEvent.change(screen.getByLabelText(`Material value ${index}`), {
      target: { value },
    });
  };

  // Whether a value is secret belongs to its row, not to the text of its key:
  // correcting the key must neither show the value nor send it as plain
  // material.
  it('keeps an entry secret when its key is renamed', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('refresh-credential-key'), {
      target: { value: 'PLAIN_KEY' },
    });
    addEntry(0, 'client_secre', 's3cr3t-value');
    fireEvent.click(screen.getByLabelText('Secret'));
    expect(screen.getByLabelText('Material value 0')).toHaveAttribute(
      'type',
      'password',
    );

    fireEvent.change(screen.getByLabelText('Material key 0'), {
      target: { value: 'client_secret' },
    });

    expect(screen.getByLabelText('Secret')).toBeChecked();
    expect(screen.getByLabelText('Material value 0')).toHaveAttribute(
      'type',
      'password',
    );
    fireEvent.click(screen.getByTestId('configure-refresh-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      credentialKey: 'PLAIN_KEY',
      strategy: 'oauth2-refresh-token',
      material: { client_secret: 's3cr3t-value' },
      secretMaterialKeys: ['client_secret'],
    });
  });

  // So the value can be hidden before any of it is typed.
  it('lets an entry be marked secret before it has a key', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('add-material-entry'));

    fireEvent.click(screen.getByLabelText('Secret'));

    expect(screen.getByLabelText('Secret')).toBeChecked();
    expect(screen.getByLabelText('Material value 0')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('keeps the secrecy of the entries that are left when one is removed', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('refresh-credential-key'), {
      target: { value: 'PLAIN_KEY' },
    });
    addEntry(0, 'client_id', 'an-id');
    addEntry(1, 'client_secret', 's3cr3t-value');
    fireEvent.click(screen.getAllByLabelText('Secret')[1]);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove material entry' })[0],
    );

    expect(screen.getByLabelText('Material key 0')).toHaveValue(
      'client_secret',
    );
    expect(screen.getByLabelText('Secret')).toBeChecked();
    expect(screen.getByLabelText('Material value 0')).toHaveAttribute(
      'type',
      'password',
    );
    fireEvent.click(screen.getByTestId('configure-refresh-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      credentialKey: 'PLAIN_KEY',
      strategy: 'oauth2-refresh-token',
      material: { client_secret: 's3cr3t-value' },
      secretMaterialKeys: ['client_secret'],
    });
  });

  // Refresh material is secret, and the dialog is closed by its owner when a
  // submit succeeds as well as by Cancel. However it closes, nothing typed in
  // it may be there the next time it opens.
  it('holds nothing of what was typed once it has closed', () => {
    const modal = (isOpen: boolean) => (
      <ConfigureRefreshModal
        isOpen={isOpen}
        credentialNames={['GCP_SA_ACCESS_TOKEN', 'PLAIN_KEY']}
        isSubmitting={false}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    const { rerender } = render(modal(true));
    fireEvent.change(screen.getByTestId('refresh-credential-key'), {
      target: { value: 'PLAIN_KEY' },
    });
    fireEvent.change(screen.getByTestId('refresh-strategy'), {
      target: { value: 'oauth2-client-credentials' },
    });
    addEntry(0, 'client_secret', 's3cr3t-value');
    fireEvent.click(screen.getByLabelText('Secret'));

    // What the provider page does when the gateway has accepted the refresh.
    rerender(modal(false));
    rerender(modal(true));

    expect(screen.getByTestId('refresh-credential-key')).toHaveValue('');
    expect(screen.getByTestId('refresh-strategy')).toHaveValue(
      'oauth2-refresh-token',
    );
    expect(screen.queryByLabelText('Material key 0')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('s3cr3t-value')).not.toBeInTheDocument();
  });
});
