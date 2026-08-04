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
    ['DELETING', 'warning'],
  ])('uses a distinct color for %s phase', (phase, expectedToken) => {
    const { container } = render(<StatusDot phase={phase} />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toContain(expectedToken);
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
