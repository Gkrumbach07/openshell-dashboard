import React from 'react';
import { render } from '@testing-library/react';
import StatusDot from '../StatusDot';
import type { SandboxPhase } from '../../types';

describe('StatusDot', () => {
  it('renders a span element', () => {
    const { container } = render(<StatusDot phase="READY" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.tagName).toBe('SPAN');
  });

  it('renders as inline-block', () => {
    const { container } = render(<StatusDot phase="READY" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.display).toBe('inline-block');
  });

  it.each<[SandboxPhase, string]>([
    ['READY', 'success'],
    ['ERROR', 'danger'],
    ['PROVISIONING', 'info'],
    ['STARTING', 'info'],
    ['STOPPING', 'info'],
    ['DELETING', 'warning'],
    ['STOPPED', 'disabled'],
    // A main command that exited with status 0: a success, like READY.
    ['COMPLETED', 'success'],
  ])('uses a distinct color for %s phase', (phase, expectedToken) => {
    const { container } = render(<StatusDot phase={phase} />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toContain(expectedToken);
  });

  it('shows a STOPPED sandbox with an exit code as a failure', () => {
    const { container } = render(<StatusDot phase="STOPPED" exitCode={137} />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toContain('danger');
  });

  it('keeps COMPLETED a success with its exit code of 0', () => {
    const { container } = render(<StatusDot phase="COMPLETED" exitCode={0} />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toContain('success');
  });

  it('uses a fallback color for UNKNOWN phase', () => {
    const { container } = render(<StatusDot phase="UNKNOWN" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toContain('custom');
  });

  it('renders different colors for different phases', () => {
    const { container: c1 } = render(<StatusDot phase="READY" />);
    const { container: c2 } = render(<StatusDot phase="ERROR" />);
    const bg1 = (c1.firstChild as HTMLElement).style.background;
    const bg2 = (c2.firstChild as HTMLElement).style.background;
    expect(bg1).not.toBe(bg2);
  });
});
