import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import CurrentUserModal from '../CurrentUserModal';
import type { CurrentUser } from '../../types';

const user: CurrentUser = {
  subject: 'f3b1c2d4-0000-4000-8000-000000000001',
  displayName: 'Ada Lovelace',
  identityProvider: 'oidc',
  roles: ['openshell-admin', 'openshell-user'],
  scopes: ['openid', 'sandbox:read', 'sandbox:write'],
};

const labelsIn = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByText(/.+/, { selector: '.pf-v6-c-label__text' })
    .map((label) => label.textContent);

// What `openshell whoami` prints: Subject, Name, Provider, Roles, Scopes.
describe('CurrentUserModal', () => {
  it('shows the identity the gateway validated', () => {
    render(<CurrentUserModal user={user} isOpen onClose={jest.fn()} />);

    expect(
      screen.getByRole('dialog', { name: 'Signed-in identity' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('identity-subject')).toHaveTextContent(
      'f3b1c2d4-0000-4000-8000-000000000001',
    );
    expect(screen.getByTestId('identity-name')).toHaveTextContent(
      'Ada Lovelace',
    );
    expect(screen.getByTestId('identity-provider')).toHaveTextContent('oidc');
    expect(labelsIn('identity-roles')).toEqual([
      'openshell-admin',
      'openshell-user',
    ]);
    expect(labelsIn('identity-scopes')).toEqual([
      'openid',
      'sandbox:read',
      'sandbox:write',
    ]);
  });

  // The CLI leaves the name out when the gateway has none, and prints the
  // other lines empty.
  it('leaves the name out and says None for what the gateway did not report', () => {
    render(
      <CurrentUserModal
        user={{ subject: 'dev-user', roles: [] }}
        isOpen
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('identity-subject')).toHaveTextContent(
      'dev-user',
    );
    expect(screen.queryByTestId('identity-name')).not.toBeInTheDocument();
    expect(screen.getByTestId('identity-provider')).toHaveTextContent('None');
    expect(screen.getByTestId('identity-roles')).toHaveTextContent('None');
    expect(screen.getByTestId('identity-scopes')).toHaveTextContent('None');
  });

  it('renders nothing while it is closed', () => {
    render(<CurrentUserModal user={user} isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes from its button', () => {
    const onClose = jest.fn();
    render(<CurrentUserModal user={user} isOpen onClose={onClose} />);

    // The footer button, not the header's close icon of the same name.
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
