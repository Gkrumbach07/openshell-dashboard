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

  it('renders a PF Label with color prop for READY', () => {
    const { container } = render(<PhaseLabel phase="READY" />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders a PF Label with color prop for ERROR', () => {
    const { container } = render(<PhaseLabel phase="ERROR" />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('renders distinct markup for READY vs ERROR', () => {
    const { container: c1 } = render(<PhaseLabel phase="READY" />);
    const { container: c2 } = render(<PhaseLabel phase="ERROR" />);
    expect(c1.innerHTML).not.toBe(c2.innerHTML);
  });

  it('renders distinct markup for PROVISIONING vs DELETING', () => {
    const { container: c1 } = render(<PhaseLabel phase="PROVISIONING" />);
    const { container: c2 } = render(<PhaseLabel phase="DELETING" />);
    expect(c1.innerHTML).not.toBe(c2.innerHTML);
  });

  it('renders UNKNOWN with default/grey styling', () => {
    const { container: cReady } = render(<PhaseLabel phase="READY" />);
    const { container: cUnknown } = render(<PhaseLabel phase="UNKNOWN" />);
    expect(cReady.innerHTML).not.toBe(cUnknown.innerHTML);
  });
});
