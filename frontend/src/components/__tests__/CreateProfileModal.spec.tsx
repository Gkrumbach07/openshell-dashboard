import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import CreateProfileModal from '../CreateProfileModal';
import type { ImportProfileRequest } from '../../types';

const mockImport = jest.fn();

jest.mock('../../api/providers', () => ({
  useImportProviderProfiles: jest.fn(() => ({
    mutate: mockImport,
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
  })),
}));

const renderModal = () =>
  render(<CreateProfileModal workspace="team-a" isOpen onClose={jest.fn()} />);

const fillRequired = () => {
  fireEvent.change(screen.getByTestId('profile-id-input'), {
    target: { value: 'custom' },
  });
  fireEvent.change(screen.getByTestId('profile-display-name-input'), {
    target: { value: 'Custom' },
  });
};

// Types into a field one character at a time, each on top of what the field
// shows by then, which is how a person types and what a field that rewrites
// its own value gets wrong.
const type = (testId: string, text: string) => {
  for (const character of text) {
    const field = screen.getByTestId(testId) as HTMLInputElement;
    fireEvent.change(field, { target: { value: field.value + character } });
  }
};

const submitted = (): ImportProfileRequest =>
  (mockImport.mock.calls[0][0] as ImportProfileRequest[])[0];

beforeEach(() => jest.clearAllMocks());

// A credential may be injected under several environment variables, and the
// gateway takes its value under any of them. They are written in one field,
// separated by commas.
describe('CreateProfileModal environment variables', () => {
  it('takes a comma as it is typed', () => {
    renderModal();
    fireEvent.click(screen.getByTestId('cred-add'));

    type('cred-env-0', 'GITHUB_TOKEN,');
    expect(screen.getByTestId('cred-env-0')).toHaveValue('GITHUB_TOKEN,');

    type('cred-env-0', ' GH_TOKEN');
    expect(screen.getByTestId('cred-env-0')).toHaveValue(
      'GITHUB_TOKEN, GH_TOKEN',
    );
  });

  it('sends each variable that was typed, in order', () => {
    renderModal();
    fillRequired();
    fireEvent.click(screen.getByTestId('cred-add'));
    type('cred-name-0', 'api_token');
    type('cred-env-0', 'GITHUB_TOKEN, GH_TOKEN,GITHUB_PAT');
    fireEvent.click(screen.getByTestId('create-profile-submit'));

    expect(submitted().credentials).toEqual([
      {
        name: 'api_token',
        required: false,
        envVars: ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT'],
      },
    ]);
  });

  it('leaves out what is between two commas and nothing else', () => {
    renderModal();
    fillRequired();
    fireEvent.click(screen.getByTestId('cred-add'));
    type('cred-name-0', 'api_token');
    type('cred-env-0', ' , GITHUB_TOKEN ,, GH_TOKEN , ');
    fireEvent.click(screen.getByTestId('create-profile-submit'));

    expect(submitted().credentials?.[0].envVars).toEqual([
      'GITHUB_TOKEN',
      'GH_TOKEN',
    ]);
  });

  // A credential the gateway brokers without injecting it declares none, and
  // is stored under its name.
  it('sends none for a credential that names none', () => {
    renderModal();
    fillRequired();
    fireEvent.click(screen.getByTestId('cred-add'));
    type('cred-name-0', 'subject_token');
    fireEvent.click(screen.getByTestId('cred-required-0'));
    fireEvent.click(screen.getByTestId('create-profile-submit'));

    expect(submitted().credentials).toEqual([
      { name: 'subject_token', required: true },
    ]);
  });

  it('keeps each credential its own variables when one above it is removed', () => {
    renderModal();
    fillRequired();
    fireEvent.click(screen.getByTestId('cred-add'));
    fireEvent.click(screen.getByTestId('cred-add'));
    type('cred-name-0', 'first');
    type('cred-env-0', 'FIRST');
    type('cred-name-1', 'second');
    type('cred-env-1', 'SECOND, SECOND_ALT');

    fireEvent.click(screen.getByTestId('cred-remove-0'));

    expect(screen.getByTestId('cred-env-0')).toHaveValue('SECOND, SECOND_ALT');
    fireEvent.click(screen.getByTestId('create-profile-submit'));
    expect(submitted().credentials).toEqual([
      { name: 'second', required: false, envVars: ['SECOND', 'SECOND_ALT'] },
    ]);
  });

  it('sends the rest of the profile as before', () => {
    renderModal();
    fillRequired();
    fireEvent.click(screen.getByTestId('create-profile-submit'));

    expect(submitted()).toEqual({
      id: 'custom',
      displayName: 'Custom',
      description: undefined,
      category: 'OTHER',
      inferenceCapable: false,
      credentials: undefined,
      endpoints: undefined,
    });
  });
});
