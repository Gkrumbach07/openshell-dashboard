import React from 'react';
import { render, screen } from '@testing-library/react';

import ProviderProfilesPage from '../ProviderProfilesPage';

let mockIsPlatformAdmin = true;

jest.mock('../../api/rbac', () => ({
  useUserRole: () => ({ isPlatformAdmin: mockIsPlatformAdmin }),
}));

jest.mock('../../api/providers', () => ({
  PLATFORM_PROFILE_SCOPE: '@platform',
}));

// The panel has its own spec. Here it says which scope it was given and
// whether its viewer may manage it.
jest.mock('../../components/provider/ProfilesPanel', () => ({
  __esModule: true,
  default: ({ scope, canManage }: { scope: string; canManage: boolean }) => (
    <div data-testid="profiles-panel">
      {scope} {canManage ? 'manage' : 'read'}
    </div>
  ),
}));

describe('ProviderProfilesPage', () => {
  it('shows the platform scope, managed by a platform admin', () => {
    mockIsPlatformAdmin = true;
    render(<ProviderProfilesPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Provider profiles' }),
    ).toBeVisible();
    expect(screen.getByTestId('profiles-panel')).toHaveTextContent(
      '@platform manage',
    );
  });

  // The route is for platform admins and the gateway refuses anyone else; a
  // consumer that renders the page for another user gets no write actions.
  it('offers no management to a user who is not a platform admin', () => {
    mockIsPlatformAdmin = false;
    render(<ProviderProfilesPage />);
    expect(screen.getByTestId('profiles-panel')).toHaveTextContent(
      '@platform read',
    );
  });
});
