import { fireEvent, render, screen } from '@testing-library/react';

import EntitlementPage from '../EntitlementPage';

const mockLogout = jest.fn();

jest.mock('../../app/logout', () => ({
  logout: () => mockLogout(),
}));

describe('EntitlementPage', () => {
  beforeEach(() => {
    mockLogout.mockClear();
  });

  it('shows the entitlement empty state copy', () => {
    render(<EntitlementPage />);

    expect(screen.getByTestId('entitlement-screen')).toBeInTheDocument();
    expect(
      screen.getByText('Your account has no OpenShell role'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'You are signed in, but the gateway has not granted you an OpenShell role. Ask a platform admin to grant you access, then sign out and sign back in.',
      ),
    ).toBeInTheDocument();
  });

  it('offers sign-out as the action', () => {
    render(<EntitlementPage />);

    fireEvent.click(screen.getByTestId('entitlement-sign-out'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
