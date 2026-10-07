import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import PolicyRuleEditor from '../index';
import type {
  PolicyRevision,
  PolicySource,
  SandboxPolicy,
} from '../../../types';

// A policy document that is being edited, and what goes on around it while
// it is: the sandbox and its policy are read again every few seconds, each at
// its own pace, other people change them, a gateway-global policy can come
// into force, and the person editing can look at the rules and come back.
// These drive the Policy tab through its real state; only the hooks under it
// are stubbed.

// A sandbox as far as these tests go. Revision 0 stands for a sandbox that
// has no revision yet: its policy is the one it was created with, and there
// is no policy view to read (404).
type MockSandbox = {
  resourceVersion: number;
  revision: number;
  policy: SandboxPolicy;
};

// What the gateway holds, which is what reading the sandbox again answers,
// and what the page last read of it, which is what it shows until then.
let mockGateway: MockSandbox;
let mockPage: MockSandbox;
let mockSource: PolicySource = 'SANDBOX';
let mockReplaceError: Error | null = null;
// Why a read fails, when it is to fail.
let mockSandboxReadError: Error | null = null;
let mockPolicyReadError: Error | null = null;
// The reads made on top of the page's own, in the order they were made.
let mockReads: string[] = [];
// Held back until a test lets the read of the sandbox go on, when set.
let mockSandboxReadGate: Promise<void> | null = null;

const mockReplace = jest.fn();

const mockSandboxData = (state: MockSandbox) => ({
  metadata: { resourceVersion: state.resourceVersion },
  spec: { policy: state.policy },
});

const mockPolicyResult = (state: MockSandbox) => {
  if (state.revision === 0) {
    return {
      data: undefined,
      isError: true,
      error: Object.assign(new Error('policy not found'), { status: 404 }),
    };
  }
  const latest: PolicyRevision = {
    version: state.revision,
    status: 'LOADED',
    policyHash: 'abcdef0123456789',
    createdAtMs: 1_700_000_000_000,
    policy: state.policy,
  };
  return {
    data: { activeVersion: state.revision, latest, revisions: [latest] },
    isError: false,
    error: null,
  };
};

// Reading again answers what the gateway holds, and the page holds that from
// then on, as it does when a query is refetched.
const mockReadSandbox = jest.fn(async () => {
  mockReads.push('sandbox');
  if (mockSandboxReadGate) await mockSandboxReadGate;
  if (mockSandboxReadError) {
    return {
      data: mockSandboxData(mockPage),
      isError: true,
      error: mockSandboxReadError,
    };
  }
  mockPage = { ...mockPage, resourceVersion: mockGateway.resourceVersion };
  return { data: mockSandboxData(mockGateway), isError: false, error: null };
});

const mockReadPolicy = jest.fn(async () => {
  mockReads.push('policy');
  if (mockPolicyReadError) {
    return {
      ...mockPolicyResult(mockPage),
      isError: true,
      error: mockPolicyReadError,
    };
  }
  mockPage = {
    ...mockPage,
    revision: mockGateway.revision,
    policy: mockGateway.policy,
  };
  return mockPolicyResult(mockGateway);
});

jest.mock('../../../api/policy', () => ({
  useSandboxPolicy: jest.fn(() => ({
    ...mockPolicyResult(mockPage),
    refetch: mockReadPolicy,
  })),
  useEffectiveSandboxPolicy: jest.fn(() => ({
    data: {
      policy: mockPage.policy,
      version: mockPage.revision,
      policySource: mockSource,
    },
  })),
  useMergeSandboxPolicy: jest.fn(() => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })),
  useUpdateSandboxPolicy: jest.fn(() => ({
    mutate: mockReplace,
    reset: jest.fn(),
    isPending: false,
    isError: mockReplaceError !== null,
    error: mockReplaceError,
  })),
}));

jest.mock('../../../api/sandboxes', () => ({
  useSandbox: jest.fn(() => ({
    data: mockSandboxData(mockPage),
    refetch: mockReadSandbox,
  })),
}));

jest.mock('../../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: true })),
}));

jest.mock('../../../app/AlertContext', () => ({
  useAlerts: jest.fn(() => ({ addSuccess: jest.fn() })),
}));

// Monaco does not run under jsdom. A textarea stands in for the editor and
// reports what is typed the way the editor does.
jest.mock('@patternfly/react-code-editor', () => ({
  Language: { json: 'json', yaml: 'yaml' },
  CodeEditor: ({
    code,
    isReadOnly,
    onChange,
    onCodeChange,
    'data-testid': testId,
  }: {
    code: string;
    isReadOnly?: boolean;
    onChange?: (value: string) => void;
    onCodeChange?: (value: string) => void;
    'data-testid'?: string;
  }) => (
    <textarea
      data-testid={testId}
      value={code}
      readOnly={isReadOnly}
      onChange={(event) => {
        onChange?.(event.target.value);
        onCodeChange?.(event.target.value);
      }}
    />
  ),
}));

const OWN: SandboxPolicy = {
  version: 1,
  networkPolicies: {
    web: { name: 'web', endpoints: [{ host: 'a.example', port: 443 }] },
  },
};

// What someone else made of the policy in the meantime.
const THEIRS: SandboxPolicy = {
  version: 1,
  networkPolicies: {
    web: { name: 'web', endpoints: [{ host: 'a.example', port: 443 }] },
    theirs: { name: 'theirs', endpoints: [{ host: 'b.example', port: 443 }] },
  },
};

// What the person editing wants it to be.
const MINE: SandboxPolicy = {
  version: 1,
  networkPolicies: {
    mine: { name: 'mine', endpoints: [{ host: 'c.example', port: 443 }] },
  },
};

const element = () => <PolicyRuleEditor workspace="team-a" sandboxName="sb1" />;

const clickToggle = (testId: string) =>
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));

const draft = () =>
  screen.getByTestId('policy-document-input') as HTMLTextAreaElement;

const type = (policy: SandboxPolicy) =>
  fireEvent.change(draft(), { target: { value: JSON.stringify(policy) } });

const replace = () => screen.getByTestId('replace-policy');

// Presses Replace and waits for what it sets off to finish: the reads, and
// the request if one follows.
const pressReplace = () => act(async () => void fireEvent.click(replace()));

// Opens the document view and starts an edit of the policy.
const startEditing = () => {
  const view = render(element());
  clickToggle('view-document');
  fireEvent.click(screen.getByTestId('edit-policy-document'));
  return view;
};

// Somebody else changes the policy on the gateway. The page has not read it.
const othersChangeThePolicy = (policy: SandboxPolicy = THEIRS) => {
  mockGateway = {
    resourceVersion: mockGateway.resourceVersion + 2,
    revision: mockGateway.revision + 1,
    policy,
  };
};

// The page's own reads catch up with the gateway, at their two paces.
const pageReadsTheSandbox = () => {
  mockPage = { ...mockPage, resourceVersion: mockGateway.resourceVersion };
};
const pageReadsThePolicy = () => {
  mockPage = {
    ...mockPage,
    revision: mockGateway.revision,
    policy: mockGateway.policy,
  };
};

// What the one and only Replace sent.
const sent = (): {
  policy: SandboxPolicy;
  expectedResourceVersion?: number;
} => {
  expect(mockReplace).toHaveBeenCalledTimes(1);
  return mockReplace.mock.calls[0][0];
};

describe('PolicyRuleEditor: a document being edited', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGateway = { resourceVersion: 7, revision: 3, policy: OWN };
    mockPage = { ...mockGateway };
    mockSource = 'SANDBOX';
    mockReplaceError = null;
    mockSandboxReadError = null;
    mockPolicyReadError = null;
    mockReads = [];
    mockSandboxReadGate = null;
  });

  describe('when it is sent', () => {
    // The order is what makes the version safe to send: a resource version
    // read before the revision cannot be newer than a change to the policy
    // that the revision does not show.
    it('reads the sandbox again, then its policy, and sends the resource version just read', async () => {
      startEditing();
      type(MINE);
      // The sandbox moved on in a way that is nothing to do with its policy,
      // as a running sandbox does, and the page has not read that either.
      mockGateway = { ...mockGateway, resourceVersion: 9 };

      await pressReplace();
      expect(mockReads).toEqual(['sandbox', 'policy']);
      expect(sent()).toEqual({ policy: MINE, expectedResourceVersion: 9 });
      expect(
        screen.queryByTestId('policy-document-stale'),
      ).not.toBeInTheDocument();
    });

    // The page reads the sandbox every few seconds and its policy far less
    // often. It used to send the newest resource version it held with a
    // document started from a policy that was no longer the sandbox's, and
    // the gateway, given a version that was current, took it.
    it('does not send a draft over a change to the policy that the page had not read yet', async () => {
      render(element());
      othersChangeThePolicy();
      pageReadsTheSandbox();
      // The page now holds the new resource version and the old policy.
      clickToggle('view-document');
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      expect(JSON.parse(draft().value)).toEqual(OWN);
      type(MINE);
      expect(replace()).toBeEnabled();

      await pressReplace();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.getByTestId('policy-document-stale')).toHaveTextContent(
        'The document was started from revision 3, and the policy is now revision 4.',
      );
      expect(JSON.parse(draft().value)).toEqual(MINE);
      expect(replace()).toBeDisabled();
    });

    it('does not send a draft when the sandbox cannot be read again, and says why', async () => {
      startEditing();
      type(MINE);
      mockSandboxReadError = new Error('gateway unavailable');

      await pressReplace();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.getByTestId('policy-document-not-sent')).toHaveTextContent(
        'The sandbox could not be read again to confirm that its policy is still the one this document was started from (gateway unavailable). The document is kept as it is.',
      );
      expect(JSON.parse(draft().value)).toEqual(MINE);

      // And sends it once the sandbox can be read.
      mockSandboxReadError = null;
      await pressReplace();
      expect(sent()).toEqual({ policy: MINE, expectedResourceVersion: 7 });
      expect(
        screen.queryByTestId('policy-document-not-sent'),
      ).not.toBeInTheDocument();
    });

    it('does not send a draft when its policy cannot be read again', async () => {
      startEditing();
      type(MINE);
      mockPolicyReadError = new Error('deadline exceeded');

      await pressReplace();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.getByTestId('policy-document-not-sent')).toHaveTextContent(
        '(deadline exceeded)',
      );

      // What was said goes with a draft that is given up.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByTestId('edit-policy-document'));
      expect(
        screen.queryByTestId('policy-document-not-sent'),
      ).not.toBeInTheDocument();
    });

    it('is not sent twice while the sandbox is being read again', async () => {
      startEditing();
      type(MINE);
      let release: () => void = () => undefined;
      mockSandboxReadGate = new Promise((resolve) => {
        release = resolve;
      });

      fireEvent.click(replace());
      expect(replace()).toBeDisabled();
      fireEvent.click(replace());
      expect(mockReadSandbox).toHaveBeenCalledTimes(1);

      await act(async () => release());
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(replace()).toBeEnabled();
    });

    it('is read again, and sent again, after the gateway refuses it', async () => {
      const { rerender } = startEditing();
      type(MINE);
      await pressReplace();
      expect(mockReplace).toHaveBeenCalledTimes(1);

      // The sandbox changed between the read and the write, and the gateway
      // said no. Nothing is lost by asking again: the reads are made again.
      mockReplaceError = new Error(
        'persist policy revision failed due to concurrent modification (current resource_version: 8)',
      );
      mockGateway = { ...mockGateway, resourceVersion: 8 };
      rerender(element());
      expect(screen.getByTestId('policy-document-refused')).toHaveTextContent(
        'concurrent modification',
      );
      expect(JSON.parse(draft().value)).toEqual(MINE);

      await pressReplace();
      expect(mockReplace).toHaveBeenCalledTimes(2);
      expect(mockReplace.mock.calls[1][0]).toEqual({
        policy: MINE,
        expectedResourceVersion: 8,
      });
    });
  });

  describe('when the policy changes under it', () => {
    it('is not sent, and the page says so, once the page has read the change', () => {
      const { rerender } = startEditing();
      type(MINE);
      expect(
        screen.queryByTestId('policy-document-stale'),
      ).not.toBeInTheDocument();

      othersChangeThePolicy();
      pageReadsTheSandbox();
      pageReadsThePolicy();
      rerender(element());

      expect(screen.getByTestId('policy-document-stale')).toHaveTextContent(
        "The sandbox's policy changed while this document was being edited",
      );
      expect(screen.getByTestId('policy-document-stale')).toHaveTextContent(
        'The document was started from revision 3, and the policy is now revision 4.',
      );
      // The draft is still what was typed.
      expect(JSON.parse(draft().value)).toEqual(MINE);
      expect(replace()).toBeDisabled();
      fireEvent.click(replace());
      expect(mockReads).toEqual([]);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('replaces the changed policy once that is what was asked for', async () => {
      const { rerender } = startEditing();
      type(MINE);
      othersChangeThePolicy();
      pageReadsThePolicy();
      rerender(element());

      fireEvent.click(screen.getByTestId('policy-document-stale-keep'));
      expect(
        screen.queryByTestId('policy-document-stale'),
      ).not.toBeInTheDocument();
      expect(JSON.parse(draft().value)).toEqual(MINE);

      await pressReplace();
      expect(sent()).toEqual({ policy: MINE, expectedResourceVersion: 9 });
    });

    // Keeping the document is consent to replace the policy that was shown,
    // not whatever the policy becomes after that.
    it('asks again when the policy changes once more after the document was kept', async () => {
      const { rerender } = startEditing();
      type(MINE);
      othersChangeThePolicy();
      pageReadsThePolicy();
      rerender(element());
      fireEvent.click(screen.getByTestId('policy-document-stale-keep'));

      othersChangeThePolicy(OWN);
      await pressReplace();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.getByTestId('policy-document-stale')).toHaveTextContent(
        'The document was started from revision 4, and the policy is now revision 5.',
      );
    });

    it('starts again from the changed policy when the draft is given up', async () => {
      const { rerender } = startEditing();
      type(MINE);
      othersChangeThePolicy();
      pageReadsThePolicy();
      rerender(element());

      fireEvent.click(screen.getByTestId('policy-document-stale-discard'));
      expect(
        screen.queryByTestId('policy-document-stale'),
      ).not.toBeInTheDocument();
      expect(JSON.parse(draft().value)).toEqual(THEIRS);

      await pressReplace();
      expect(sent()).toEqual({ policy: THEIRS, expectedResourceVersion: 9 });
    });
  });

  describe('of a sandbox with no revision yet', () => {
    beforeEach(() => {
      mockGateway = { resourceVersion: 2, revision: 0, policy: OWN };
      mockPage = { ...mockGateway };
    });

    it('is sent while there is still none', async () => {
      startEditing();
      expect(JSON.parse(draft().value)).toEqual(OWN);
      type(MINE);

      await pressReplace();
      expect(mockReads).toEqual(['sandbox', 'policy']);
      expect(sent()).toEqual({ policy: MINE, expectedResourceVersion: 2 });
    });

    it('is not sent once somebody has made the first', async () => {
      startEditing();
      type(MINE);
      othersChangeThePolicy();

      await pressReplace();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(screen.getByTestId('policy-document-stale')).toHaveTextContent(
        'The document was started from the policy the sandbox was created with, and the policy is now revision 1.',
      );
    });
  });

  // A policy view that is gone is not a policy that is unchanged, for a
  // draft that was started from a revision.
  it('is not sent when its revision can no longer be read at all', async () => {
    startEditing();
    type(MINE);
    mockPolicyReadError = Object.assign(new Error('policy not found'), {
      status: 404,
    });

    await pressReplace();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('policy-document-not-sent')).toHaveTextContent(
      '(policy not found)',
    );
  });

  // The document view is taken down when the rules are shown, and the draft
  // used to go with it.
  it('is kept through a look at the rules and back', async () => {
    startEditing();
    type(MINE);
    expect(screen.getByTestId('view-document')).toHaveTextContent(
      'Document (unsaved draft)',
    );

    clickToggle('view-rules');
    expect(
      screen.queryByTestId('policy-document-input'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('view-document')).toHaveTextContent(
      'Document (unsaved draft)',
    );

    clickToggle('view-document');
    expect(JSON.parse(draft().value)).toEqual(MINE);
    await pressReplace();
    expect(sent()).toEqual({ policy: MINE, expectedResourceVersion: 7 });
  });

  // The draft that was kept is still a draft of the policy it was started
  // from, and is not sent over a change made while the rules were on screen.
  it('is not sent over a change to the policy made while it was out of sight', async () => {
    startEditing();
    type(MINE);
    clickToggle('view-rules');
    othersChangeThePolicy();
    clickToggle('view-document');

    await pressReplace();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('policy-document-stale')).toBeInTheDocument();
    expect(JSON.parse(draft().value)).toEqual(MINE);
  });

  it('is gone, and nothing says otherwise, once it is cancelled', () => {
    startEditing();
    type(MINE);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('view-document')).toHaveTextContent(/^Document$/);
    expect(
      JSON.parse(
        (screen.getByTestId('policy-document') as HTMLTextAreaElement).value,
      ),
    ).toEqual(OWN);
  });

  // The gateway refuses a sandbox policy update while a global policy is in
  // force ("policy is managed globally").
  it('cannot be sent once a global policy is in force, and is kept', () => {
    const { rerender } = startEditing();
    type(MINE);
    expect(replace()).toBeEnabled();

    mockSource = 'GLOBAL';
    rerender(element());

    expect(screen.getByTestId('policy-document-blocked')).toHaveTextContent(
      'A gateway-global policy is in force, and the gateway refuses changes to a sandbox policy until it is deleted.',
    );
    expect(JSON.parse(draft().value)).toEqual(MINE);
    expect(replace()).toBeDisabled();
    fireEvent.click(replace());
    expect(mockReads).toEqual([]);
    expect(mockReplace).not.toHaveBeenCalled();

    // And can be again when the global policy is gone.
    mockSource = 'SANDBOX';
    rerender(element());
    expect(
      screen.queryByTestId('policy-document-blocked'),
    ).not.toBeInTheDocument();
    expect(replace()).toBeEnabled();
  });

  it('cannot be started at all while a global policy is in force', () => {
    mockSource = 'GLOBAL';
    render(element());
    clickToggle('view-document');
    expect(screen.getByTestId('edit-policy-document')).toBeDisabled();
    expect(
      screen.getByText(
        'A gateway-global policy is in force, and the gateway refuses changes to a sandbox policy until it is deleted.',
      ),
    ).toBeInTheDocument();
  });
});
