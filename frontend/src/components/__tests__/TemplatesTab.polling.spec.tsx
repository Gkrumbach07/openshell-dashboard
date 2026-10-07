import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import TemplatesTab from '../TemplatesTab';
import type { SandboxTemplate } from '../../types';

// The templates are polled. The empty state and the list are different
// trees, and a form that is open over either has to stay as it is when a
// poll takes the tab from one to the other.

const mutation = () => ({
  mutate: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  isError: false,
  error: null,
});

jest.mock('../../api/templates', () => ({
  useTemplates: jest.fn(),
  useDeleteTemplate: jest.fn(() => mutation()),
  useCreateTemplate: jest.fn(() => mutation()),
}));
jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: true })),
}));
jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn(), addAlert: jest.fn() })),
}));

// Stands in for the form a sandbox is created from a template with: a field
// that holds what was typed for as long as the form stays mounted.
jest.mock('../CreateSandboxFromTemplateModal', () => ({
  __esModule: true,
  default: ({ templateName }: { templateName: string }) => {
    const [name, setName] = jest
      .requireActual<typeof React>('react')
      .useState('');
    return (
      <input
        data-testid="from-template-name"
        aria-label={`Name of the sandbox from ${templateName}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    );
  },
}));

import { useTemplates } from '../../api/templates';
const mockUseTemplates = useTemplates as jest.Mock;

const template = (name: string): SandboxTemplate => ({
  metadata: {
    id: `id-${name}`,
    name,
    createdAtMs: Date.now() - 60_000,
    resourceVersion: 1,
  },
  spec: { workload: { image: 'base' } },
});

const serve = (templates: SandboxTemplate[]) =>
  mockUseTemplates.mockReturnValue({
    isLoading: false,
    isError: false,
    data: templates,
  });

const tab = () => <TemplatesTab workspace="team-a" />;

const templateName = () =>
  screen.getByTestId('template-name-input') as HTMLInputElement;

describe('TemplatesTab while the list changes under an open form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps what was typed into Create template when the first template appears', () => {
    serve([]);
    const view = render(tab());
    fireEvent.click(screen.getByTestId('create-template-empty'));
    fireEvent.change(templateName(), { target: { value: 'my-template' } });

    // Somebody else created one, and the poll lands.
    serve([template('other')]);
    view.rerender(tab());

    expect(screen.getByTestId('templates-table')).toBeInTheDocument();
    expect(templateName()).toHaveValue('my-template');
  });

  it('keeps what was typed into Create template when the last template goes', () => {
    serve([template('only')]);
    const view = render(tab());
    fireEvent.click(screen.getByTestId('create-template'));
    fireEvent.change(templateName(), { target: { value: 'my-template' } });

    serve([]);
    view.rerender(tab());

    expect(screen.getByTestId('create-template-empty')).toBeInTheDocument();
    expect(templateName()).toHaveValue('my-template');
  });

  it('keeps the form a sandbox is being created from a template with when the list empties', async () => {
    serve([template('only')]);
    const view = render(tab());
    fireEvent.click(screen.getByRole('button', { name: 'Kebab toggle' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Create sandbox' }),
    );
    fireEvent.change(screen.getByTestId('from-template-name'), {
      target: { value: 'my-sandbox' },
    });

    // The template is deleted elsewhere.
    serve([]);
    view.rerender(tab());

    expect(screen.getByTestId('from-template-name')).toHaveValue('my-sandbox');
  });

  it('keeps an open form through a refresh that fails', () => {
    serve([template('only')]);
    const view = render(tab());
    fireEvent.click(screen.getByTestId('create-template'));
    fireEvent.change(templateName(), { target: { value: 'my-template' } });

    mockUseTemplates.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('bad gateway'),
      data: [template('only')],
      refetch: jest.fn(),
    });
    view.rerender(tab());

    expect(screen.getByTestId('templates-refresh-error')).toBeInTheDocument();
    expect(templateName()).toHaveValue('my-template');
  });
});
