import React from 'react';
import { render } from '@testing-library/react';
import StatusDot from '../StatusDot';

describe('StatusDot', () => {
  it('renders a span element', () => {
    const { container } = render(<StatusDot phase="READY" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.tagName).toBe('SPAN');
  });

  it('applies default size of 8px', () => {
    const { container } = render(<StatusDot phase="READY" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.width).toBe('8px');
    expect(dot.style.height).toBe('8px');
  });

  it('applies custom size', () => {
    const { container } = render(<StatusDot phase="ERROR" size={12} />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.width).toBe('12px');
    expect(dot.style.height).toBe('12px');
  });

  it('renders round shape', () => {
    const { container } = render(<StatusDot phase="PROVISIONING" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.borderRadius).toBe('50%');
  });

  it('sets background color based on phase', () => {
    const { container } = render(<StatusDot phase="READY" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.background).toContain('success');
  });
});
