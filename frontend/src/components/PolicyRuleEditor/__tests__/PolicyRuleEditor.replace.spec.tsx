import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PolicyRuleEditor from '../index';
import type { SandboxPolicy } from '../../../types';

// Replacing a sandbox's policy with a document, end to end on this side of
// the network: the real hooks and the real query cache, over a stand-in for
// the BFF that keeps a sandbox the way the gateway does. It refuses a write
// whose resource version is not the sandbox's, and every write moves that
// version on. What these tests assert is what reaches it, and in what order.

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

const SANDBOX = '/api/v1/workspaces/team-a/sandboxes/sb1';

// The sandbox as the gateway holds it.
let gateway: {
  resourceVersion: number;
  revision: number;
  policy: SandboxPolicy;
};
// Every request that reached the BFF, in order.
let requests: { call: string; body?: unknown }[];
// Whether reads of the sandbox fail.
let sandboxUnavailable: boolean;
// Run once, after the next read of the policy has been answered.
let afterPolicyRead: (() => void) | null;

const answer = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const bff = async (url: string, init?: RequestInit): Promise<Response> => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ call: `${method} ${url}`, body });

  if (method === 'GET' && url === SANDBOX) {
    return sandboxUnavailable
      ? answer(503, { code: 'unavailable', message: 'gateway unavailable' })
      : answer(200, {
          metadata: { name: 'sb1', resourceVersion: gateway.resourceVersion },
          spec: { policy: OWN },
          status: { phase: 'READY', currentPolicyVersion: gateway.revision },
        });
  }
  if (method === 'GET' && url === `${SANDBOX}/policy`) {
    const latest = {
      version: gateway.revision,
      status: 'LOADED',
      policyHash: `hash-${gateway.revision}`,
      createdAtMs: 1_700_000_000_000,
      policy: gateway.policy,
    };
    const response = answer(200, {
      activeVersion: gateway.revision,
      latest,
      revisions: [latest],
    });
    afterPolicyRead?.();
    afterPolicyRead = null;
    return response;
  }
  if (method === 'GET' && url === `${SANDBOX}/policy/effective`) {
    return answer(200, {
      policy: gateway.policy,
      version: gateway.revision,
      policySource: 'SANDBOX',
    });
  }
  if (method === 'PUT' && url === `${SANDBOX}/policy`) {
    const { policy, expectedResourceVersion } = body as {
      policy: SandboxPolicy;
      expectedResourceVersion?: number;
    };
    // Zero, or none, is no check at all: the gateway takes the write.
    if (
      expectedResourceVersion &&
      expectedResourceVersion !== gateway.resourceVersion
    ) {
      return answer(409, {
        code: 'conflict',
        message: `persist policy revision failed due to concurrent modification (current resource_version: ${gateway.resourceVersion})`,
      });
    }
    gateway = {
      resourceVersion: gateway.resourceVersion + 1,
      revision: gateway.revision + 1,
      policy,
    };
    return answer(200, {
      version: gateway.revision,
      policyHash: `hash-${gateway.revision}`,
    });
  }
  return answer(404, { code: 'not_found', message: `no route for ${url}` });
};

const writes = () =>
  requests.filter((request) => request.call.startsWith('PUT '));

const clickToggle = (testId: string) =>
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));

const draft = () =>
  screen.getByTestId('policy-document-input') as HTMLTextAreaElement;

const replace = () => screen.getByTestId('replace-policy');

// Opens the Policy tab, waits for the sandbox's policy to be read, and
// starts a draft of MINE from it.
const startDraft = async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PolicyRuleEditor workspace="team-a" sandboxName="sb1" />
    </QueryClientProvider>,
  );
  clickToggle('view-document');
  await waitFor(() =>
    expect(screen.getByTestId('edit-policy-document')).toBeEnabled(),
  );
  fireEvent.click(screen.getByTestId('edit-policy-document'));
  expect(JSON.parse(draft().value)).toEqual(OWN);
  fireEvent.change(draft(), { target: { value: JSON.stringify(MINE) } });
  // Only what follows is of interest.
  requests = [];
};

describe('PolicyRuleEditor: replacing the policy, against a sandbox that moves', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    gateway = { resourceVersion: 7, revision: 3, policy: OWN };
    requests = [];
    sandboxUnavailable = false;
    afterPolicyRead = null;
    global.fetch = jest.fn(bff) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reads the sandbox, then its policy, and writes with the resource version it read', async () => {
    await startDraft();
    // A running sandbox's record moves on by itself. The page read version
    // 7 and has not read it since.
    gateway.resourceVersion = 9;

    fireEvent.click(replace());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(requests.slice(0, 3)).toEqual([
      { call: `GET ${SANDBOX}`, body: undefined },
      { call: `GET ${SANDBOX}/policy`, body: undefined },
      {
        call: `PUT ${SANDBOX}/policy`,
        body: { policy: MINE, expectedResourceVersion: 9 },
      },
    ]);

    // The gateway took it, and the page shows the policy that is now there.
    expect(gateway).toEqual({ resourceVersion: 10, revision: 4, policy: MINE });
    await waitFor(() =>
      expect(
        screen.queryByTestId('policy-document-input'),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        JSON.parse(
          (screen.getByTestId('policy-document') as HTMLTextAreaElement).value,
        ),
      ).toEqual(MINE),
    );
  });

  it('writes nothing over a policy somebody else changed, and shows the change', async () => {
    await startDraft();
    gateway = { resourceVersion: 9, revision: 4, policy: THEIRS };

    fireEvent.click(replace());
    expect(
      await screen.findByTestId('policy-document-stale'),
    ).toHaveTextContent(
      'The document was started from revision 3, and the policy is now revision 4.',
    );
    expect(writes()).toEqual([]);
    expect(gateway.policy).toEqual(THEIRS);
    expect(JSON.parse(draft().value)).toEqual(MINE);
    expect(replace()).toBeDisabled();

    // Giving the draft up starts again from what was just read.
    fireEvent.click(screen.getByTestId('policy-document-stale-discard'));
    expect(JSON.parse(draft().value)).toEqual(THEIRS);
  });

  it('writes nothing when the sandbox cannot be read, and says why', async () => {
    await startDraft();
    sandboxUnavailable = true;

    fireEvent.click(replace());
    expect(
      await screen.findByTestId('policy-document-not-sent'),
    ).toHaveTextContent('(gateway unavailable)');
    expect(writes()).toEqual([]);
    expect(JSON.parse(draft().value)).toEqual(MINE);
  });

  // The gateway is the last word: a change that lands between the reads and
  // the write is refused there, and asking again starts from new reads.
  it('is refused by the gateway for a change made after the reads, and can be asked again', async () => {
    await startDraft();
    afterPolicyRead = () => {
      gateway.resourceVersion += 1;
    };

    fireEvent.click(replace());
    expect(
      await screen.findByTestId('policy-document-refused'),
    ).toHaveTextContent(
      'concurrent modification (current resource_version: 8)',
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toEqual({
      policy: MINE,
      expectedResourceVersion: 7,
    });
    expect(gateway.policy).toEqual(OWN);
    expect(JSON.parse(draft().value)).toEqual(MINE);

    fireEvent.click(replace());
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({
      policy: MINE,
      expectedResourceVersion: 8,
    });
    expect(gateway.policy).toEqual(MINE);
  });
});
