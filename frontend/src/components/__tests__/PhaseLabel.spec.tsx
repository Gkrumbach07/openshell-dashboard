import React from 'react';
import { render, screen } from '@testing-library/react';
import PhaseLabel from '../PhaseLabel';
import type { SandboxPhase, WorkspacePhase } from '../../types';

describe('PhaseLabel', () => {
  it.each<[SandboxPhase | WorkspacePhase]>([
    ['READY'],
    ['ACTIVE'],
    ['ERROR'],
    ['PROVISIONING'],
    ['DELETING'],
    ['TERMINATING'],
    ['UNKNOWN'],
    ['UNSPECIFIED'],
  ])('renders %s phase with correct text', (phase) => {
    render(<PhaseLabel phase={phase} />);
    const label = screen.getByTestId('phase-label');
    expect(label).toHaveTextContent(phase);
  });

  it('renders READY with green color', () => {
    const { container } = render(<PhaseLabel phase="READY" />);
    const label = container.querySelector('[data-testid="phase-label"]');
    expect(label?.className).toContain('green');
  });

  it('renders ERROR with red color', () => {
    const { container } = render(<PhaseLabel phase="ERROR" />);
    const label = container.querySelector('[data-testid="phase-label"]');
    expect(label?.className).toContain('red');
  });

  it('renders PROVISIONING with blue color', () => {
    const { container } = render(<PhaseLabel phase="PROVISIONING" />);
    const label = container.querySelector('[data-testid="phase-label"]');
    expect(label?.className).toContain('blue');
  });

  it('renders DELETING with orange color', () => {
    const { container } = render(<PhaseLabel phase="DELETING" />);
    const label = container.querySelector('[data-testid="phase-label"]');
    expect(label?.className).toContain('orange');
  });

  it('renders UNKNOWN without a specific color class (default/grey)', () => {
    const { container } = render(<PhaseLabel phase="UNKNOWN" />);
    const label = container.querySelector('[data-testid="phase-label"]');
    expect(label?.className).not.toContain('green');
    expect(label?.className).not.toContain('red');
    expect(label?.className).not.toContain('blue');
    expect(label?.className).not.toContain('orange');
  });
});
