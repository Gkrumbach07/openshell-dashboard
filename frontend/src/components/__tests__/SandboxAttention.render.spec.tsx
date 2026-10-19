import React from 'react';
import { render, screen, within } from '@testing-library/react';

import SandboxAttention from '../sandbox/SandboxAttention';
import type { DraftSandboxSummary, Sandbox } from '../../types';

const sandbox = (phase: Sandbox['status']['phase'] = 'READY'): Sandbox => ({
  metadata: {
    id: 'uuid-1',
    name: 'test-sandbox',
    workspace: 'default',
    createdAtMs: Date.now() - 60_000,
    resourceVersion: 1,
  },
  spec: { image: 'python' },
  status: { phase, currentPolicyVersion: 1 },
});

const draft: DraftSandboxSummary = {
  workspace: 'default',
  sandboxName: 'test-sandbox',
  pendingCount: 3,
  hasSecurityFlags: false,
  latestDraftMs: Date.now(),
};

const closeButton = (testId: string) =>
  within(screen.getByTestId(testId)).queryByRole('button', { name: /close/i });

describe('SandboxAttention, stacked under the sandbox header', () => {
  // Every other item is a state of the sandbox that the reader can only be
  // told about, so closing it is the one thing to do with it.
  it('lets the reader close what it can only tell them', () => {
    render(<SandboxAttention sandbox={sandbox('ERROR')} mode="detail" />);
    expect(closeButton('attention-error')).toBeInTheDocument();
  });

  // The proposals are the count's own undoing: it is gone from the next read
  // once they have been approved or rejected. A close button would take the
  // count off the page while the proposals were still waiting.
  it('does not let them close the count of proposals waiting', () => {
    render(
      <SandboxAttention
        sandbox={sandbox()}
        draftSummary={draft}
        mode="detail"
      />,
    );
    expect(screen.getByTestId('attention-drafts')).toHaveTextContent(
      '3 rules proposed',
    );
    expect(closeButton('attention-drafts')).toBeNull();
  });

  // The review link is the alert's action link, in PatternFly's action
  // group under the message, and not crammed into the close slot.
  it('puts the review link in the action group, not the close slot', () => {
    render(
      <SandboxAttention
        sandbox={sandbox()}
        draftSummary={draft}
        onReviewDrafts={() => {}}
        mode="detail"
      />,
    );
    const alert = screen.getByTestId('attention-drafts');
    const review = screen.getByRole('button', { name: 'Review' });
    expect(
      alert.querySelector('.pf-v6-c-alert__action-group'),
    ).toContainElement(review);
    expect(alert.querySelector('.pf-v6-c-alert__action')).toBeNull();
  });

  it('keeps the close button in the close slot beside an action link', () => {
    render(
      <SandboxAttention
        sandbox={sandbox('ERROR')}
        draftSummary={draft}
        onReviewDrafts={() => {}}
        mode="detail"
      />,
    );
    const alert = screen.getByTestId('attention-error');
    expect(alert.querySelector('.pf-v6-c-alert__action')).toContainElement(
      closeButton('attention-error'),
    );
  });

  it('shows the flagged proposals as a warning, the others as info', () => {
    const { rerender } = render(
      <SandboxAttention
        sandbox={sandbox()}
        draftSummary={{ ...draft, hasSecurityFlags: true }}
        mode="detail"
      />,
    );
    expect(screen.getByTestId('attention-drafts')).toHaveClass('pf-m-warning');
    rerender(
      <SandboxAttention
        sandbox={sandbox()}
        draftSummary={draft}
        mode="detail"
      />,
    );
    expect(screen.getByTestId('attention-drafts')).toHaveClass('pf-m-info');
  });

  it('shows nothing once they have been decided', () => {
    const { container } = render(
      <SandboxAttention
        sandbox={sandbox()}
        draftSummary={{ ...draft, pendingCount: 0 }}
        mode="detail"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
