import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TemplatesTab, { startupSummary } from '../TemplatesTab';
import type { SandboxTemplate } from '../../types';

jest.mock('../../api/templates', () => ({
  useTemplates: jest.fn(),
  useDeleteTemplate: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
}));

jest.mock('../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: true })),
}));

jest.mock('../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn() })),
}));

// The two create modals have specs of their own.
jest.mock('../CreateTemplateModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../CreateSandboxFromTemplateModal', () => ({
  __esModule: true,
  default: () => null,
}));

import { useTemplates } from '../../api/templates';
const mockUseTemplates = useTemplates as jest.Mock;

const template = (
  name: string,
  overrides: Partial<SandboxTemplate['spec']> = {},
  annotations?: Record<string, string>,
): SandboxTemplate => ({
  metadata: {
    id: `id-${name}`,
    name,
    createdAtMs: Date.now() - 60_000,
    resourceVersion: 1,
    annotations,
  },
  spec: { workload: { image: 'base' }, ...overrides },
});

const full = template(
  'claude-harness',
  {
    workload: {
      image: 'base',
      environment: { HARNESS: 'claude' },
      resources: { cpu: '500m', memory: '512Mi' },
    },
    driverConfig: { kubernetes: { pod: { priority: 'high' } } },
    desiredServiceLevel: { startup: { readyWithinMs: 300_000, maxBurst: 4 } },
  },
  { owner: 'ml-team' },
);
const plain = template('plain');

const renderTab = (templates: SandboxTemplate[]) => {
  mockUseTemplates.mockReturnValue({
    isLoading: false,
    isError: false,
    data: templates,
  });
  return render(<TemplatesTab workspace="team-a" />);
};

describe('startupSummary', () => {
  it('shows the deadline and the burst, as far as either is set', () => {
    expect(startupSummary(full)).toBe('ready within 5m · burst 4');
    expect(
      startupSummary(
        template('t', {
          desiredServiceLevel: { startup: { readyWithinMs: 30_000 } },
        }),
      ),
    ).toBe('ready within 30s');
    expect(
      startupSummary(
        template('t', { desiredServiceLevel: { startup: { maxBurst: 2 } } }),
      ),
    ).toBe('burst 2');
  });

  it('shows a template without a startup service level as having none', () => {
    expect(startupSummary(plain)).toBe('-');
    expect(startupSummary(template('t', { desiredServiceLevel: {} }))).toBe(
      '-',
    );
  });
});

describe('TemplatesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the startup service level of each template', () => {
    renderTab([full, plain]);
    expect(
      screen.getByTestId('template-startup-claude-harness'),
    ).toHaveTextContent('ready within 5m · burst 4');
    expect(screen.getByTestId('template-startup-plain')).toHaveTextContent('-');
  });

  it('shows the environment, annotations and driver config of a template', () => {
    renderTab([full]);
    const details = within(
      screen.getByTestId('template-details-claude-harness'),
    );
    expect(details.getByText('HARNESS=claude')).toBeInTheDocument();
    expect(details.getByText('owner=ml-team')).toBeInTheDocument();
    expect(details.getByText(/"priority": "high"/)).toBeInTheDocument();
  });

  it('keeps the details folded until the row is expanded', () => {
    renderTab([full]);
    const toggle = within(
      screen.getByTestId('template-expand-claude-harness'),
    ).getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(
      within(screen.getByTestId('template-expand-claude-harness')).getByRole(
        'button',
      ),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows a template that has none of them as having none', () => {
    renderTab([plain]);
    const details = screen.getByTestId('template-details-plain');
    // Environment, annotations and driver config: three dashes, no JSON.
    expect(within(details).getAllByText('-')).toHaveLength(3);
  });
});
