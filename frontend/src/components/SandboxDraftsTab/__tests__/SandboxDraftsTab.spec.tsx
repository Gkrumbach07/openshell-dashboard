import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SandboxDraftsTab from '../index';
import {
  approvalAnnotation,
  pendingApprovals,
  validationIssueSummary,
} from '../utils';
import type { DraftPolicy, EffectivePolicy, PolicyChunk } from '../../../types';

const mockApproveAll = jest.fn();
const mockApprove = jest.fn();
const mockReject = jest.fn();
const mockEdit = jest.fn();
let mockIsAdmin = true;
let mockEditError: Error | null = null;
// What the sandbox is given to enforce: its own policy unless a test says a
// gateway-global one is in force.
let mockEffective: Partial<EffectivePolicy> | undefined;
// Whether a rejection is on its way.
let mockRejectPending = false;

const mutation = (mutate: jest.Mock, error: Error | null = null) => ({
  mutate,
  reset: jest.fn(),
  isPending: false,
  isError: Boolean(error),
  error,
});

jest.mock('../../../api/policy', () => ({
  useDraftPolicy: jest.fn(),
  useEffectiveSandboxPolicy: jest.fn(() => ({ data: mockEffective })),
  useDraftHistory: jest.fn(() => ({ data: [], isLoading: false })),
  useApproveDraftChunk: jest.fn(() => mutation(mockApprove)),
  useRejectDraftChunk: jest.fn(() => ({
    ...mutation(mockReject),
    isPending: mockRejectPending,
  })),
  useApproveAllDraftChunks: jest.fn(() => mutation(mockApproveAll)),
  useEditDraftChunk: jest.fn(() => mutation(mockEdit, mockEditError)),
  useUndoDraftChunk: jest.fn(() => mutation(jest.fn())),
  useClearDraftChunks: jest.fn(() => mutation(jest.fn())),
}));

jest.mock('../../../api/rbac', () => ({
  useWorkspaceRole: jest.fn(() => ({ isWorkspaceAdmin: mockIsAdmin })),
}));

import { useDraftPolicy } from '../../../api/policy';
const mockUseDraftPolicy = useDraftPolicy as jest.Mock;

const chunk = (overrides: Partial<PolicyChunk>): PolicyChunk => ({
  id: 'c1',
  status: 'pending',
  ruleName: 'allow_api_github_com_443',
  confidence: 0.9,
  createdAtMs: 1_700_000_000_000,
  hitCount: 3,
  ...overrides,
});

// A proposed rule with fields no form knows about. Editing a chunk replaces
// its rule whole, so what the modal shows and sends has to be all of it.
const richRule = {
  name: 'mcp-tools',
  endpoints: [
    {
      host: 'mcp.example.com',
      port: 443,
      protocol: 'mcp',
      advisorProposed: true,
      jsonRpcMaxBodyBytes: 131072,
      mcp: { strictToolNames: false, versions: ['2025-03-26', '2025-06-18'] },
      rules: [
        {
          allow: {
            method: 'tools/call',
            params: { name: { any: ['search'] } },
          },
        },
      ],
    },
  ],
  binaries: [{ path: '/usr/bin/mcp-client' }],
};

const inbox: DraftPolicy = {
  draftVersion: 12,
  lastAnalyzedAtMs: 1_700_000_500_000,
  chunks: [
    chunk({ id: 'c1', reviewToken: 'tok-1', proposedRule: richRule }),
    chunk({
      id: 'c2',
      reviewToken: 'tok-2',
      ruleName: 'allow_all',
      securityNotes: 'wildcard host',
      stage: 'refined',
      supersedesChunkId: 'c0',
      firstSeenMs: 1_700_000_100_000,
      lastSeenMs: 1_700_000_200_000,
      validationResult: 'prover: 1 finding\nprivate_ip_reach: 10.0.0.0/8',
      denialSummaryIds: ['d1', 'd2'],
    }),
    chunk({ id: 'c3', status: 'approved', ruleName: 'allow_docs' }),
    chunk({
      id: 'c4',
      status: 'rejected',
      ruleName: 'allow_pypi',
      rejectionReason: 'scope it to /simple/**',
      reviewToken: 'tok-4',
    }),
  ],
};

// Every call of the hook is answered from the status it was given, the way
// the gateway filters.
const renderTab = (data: DraftPolicy = inbox) => {
  mockUseDraftPolicy.mockImplementation(
    (_workspace: string, _name: string, status?: string) => ({
      isLoading: false,
      isError: false,
      data: status
        ? { ...data, chunks: data.chunks.filter((c) => c.status === status) }
        : data,
    }),
  );
  return render(<SandboxDraftsTab workspace="team-a" sandboxName="sb1" />);
};

const clickToggle = (testId: string) =>
  fireEvent.click(within(screen.getByTestId(testId)).getByRole('button'));

describe('draft helpers', () => {
  it('builds a bulk approval from the pending chunks and their review tokens', () => {
    expect(pendingApprovals(inbox.chunks)).toEqual([
      { chunkId: 'c1', reviewToken: 'tok-1' },
      { chunkId: 'c2', reviewToken: 'tok-2' },
    ]);
    // A chunk from before review tokens existed is still approvable.
    expect(pendingApprovals([chunk({ id: 'old' })])).toEqual([
      { chunkId: 'old' },
    ]);
  });

  it("annotates a proposal with the gateway's own verdict, as the TUI does", () => {
    expect(approvalAnnotation(chunk({}))).toBeUndefined();
    expect(
      approvalAnnotation(
        chunk({ validationResult: 'prover: no new findings' }),
      ),
    ).toMatchObject({ label: 'review required' });
    expect(
      approvalAnnotation(
        chunk({
          status: 'approved',
          validationResult: 'prover: no new findings',
        }),
      ),
    ).toMatchObject({ label: 'auto-approved' });
    expect(
      approvalAnnotation(
        chunk({
          validationResult:
            'prover: 2 findings\nprivate_ip_reach: x\nbroad_host: y',
        }),
      ),
    ).toMatchObject({
      label: 'review required',
      detail:
        'rule was not auto-approved and requires review; possible issues: private ip reach, broad host',
    });
    // An application error outranks a clean prover result.
    expect(
      approvalAnnotation(
        chunk({
          applicationError: 'conflicts with rule gh',
          validationResult: 'prover: no new findings',
        }),
      ),
    ).toMatchObject({
      label: 'application blocked',
      detail: 'candidate cannot be applied: conflicts with rule gh',
    });
    expect(validationIssueSummary('prover: timed out')).toBe(
      'prover: timed out',
    );
  });
});

describe('SandboxDraftsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin = true;
    mockEditError = null;
    mockEffective = { policySource: 'SANDBOX' };
    mockRejectPending = false;
  });

  // The gateway skips a chunk approved without the review token it carries,
  // so a bulk approval that names none approves nothing.
  it('approves all pending chunks by naming each with its review token', () => {
    renderTab();
    expect(screen.getByTestId('approve-all-chunks')).toHaveTextContent(
      'Approve all pending (2)',
    );
    fireEvent.click(screen.getByTestId('include-security-flagged'));
    fireEvent.click(screen.getByTestId('approve-all-chunks'));

    expect(mockApproveAll).toHaveBeenCalledTimes(1);
    expect(mockApproveAll.mock.calls[0][0]).toEqual({
      includeSecurityFlagged: true,
      approvals: [
        { chunkId: 'c1', reviewToken: 'tok-1' },
        { chunkId: 'c2', reviewToken: 'tok-2' },
      ],
    });
  });

  it('says how many were approved and how many skipped, and why', () => {
    mockApproveAll.mockImplementation((_args, options) =>
      options.onSuccess({
        chunksApproved: 1,
        chunksSkipped: 1,
        policyVersion: 9,
      }),
    );
    renderTab();
    fireEvent.click(screen.getByTestId('approve-all-chunks'));
    const result = screen.getByTestId('approve-all-result');
    expect(result).toHaveTextContent('1 approved, 1 skipped');
    expect(result).toHaveTextContent('revision 9');
    expect(result).toHaveTextContent('security-flagged');
  });

  it('filters by status through the gateway, and keeps the bulk approval on the whole inbox', () => {
    renderTab();
    expect(screen.getByTestId('draft-chunk-c1')).toBeInTheDocument();
    expect(screen.getByTestId('draft-chunk-c3')).toBeInTheDocument();

    clickToggle('draft-status-rejected');
    expect(mockUseDraftPolicy).toHaveBeenCalledWith(
      'team-a',
      'sb1',
      'rejected',
    );
    expect(screen.getByTestId('draft-chunk-c4')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-chunk-c1')).not.toBeInTheDocument();
    // Still two pending, though none of them is in the table now.
    expect(screen.getByTestId('approve-all-chunks')).toHaveTextContent(
      'Approve all pending (2)',
    );

    clickToggle('draft-status-approved');
    expect(screen.getByTestId('draft-chunk-c3')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-chunk-c4')).not.toBeInTheDocument();
  });

  it('says which filter came back empty', () => {
    renderTab({ ...inbox, chunks: [chunk({ id: 'c1' })] });
    clickToggle('draft-status-rejected');
    expect(screen.getByTestId('draft-empty')).toHaveTextContent(
      'No rejected proposals.',
    );
  });

  it('shows the draft version and when the sandbox was last analyzed', () => {
    renderTab();
    expect(screen.getByTestId('draft-version')).toHaveTextContent(
      'Draft version 12',
    );
    expect(screen.getByTestId('draft-version')).toHaveTextContent(
      'last analyzed',
    );
  });

  it('shows what the CLI and TUI show about a chunk', () => {
    renderTab();
    const row = screen.getByTestId('draft-chunk-c2');
    expect(row).toHaveTextContent('flagged');
    expect(row).toHaveTextContent('refined');
    expect(row).toHaveTextContent('3 times');
    expect(screen.getByTestId('chunk-annotation-c2')).toHaveTextContent(
      'review required',
    );

    fireEvent.click(within(row).getByRole('button', { name: 'Details' }));
    const details = screen.getByTestId('chunk-details-c2');
    expect(details).toHaveTextContent('possible issues: private ip reach');
    expect(details).toHaveTextContent('3 connections (first');
    expect(details).toHaveTextContent('/ last');
    expect(details).toHaveTextContent('Replacesc0');
    expect(details).toHaveTextContent('d1, d2');
    expect(details).toHaveTextContent('prover: 1 finding');
  });

  it('offers the decisions the gateway takes for each status', () => {
    renderTab();
    // Pending: approve, edit, reject.
    expect(screen.getByTestId('approve-chunk-c1')).toBeInTheDocument();
    expect(screen.getByTestId('edit-chunk-c1')).toBeInTheDocument();
    expect(screen.getByTestId('reject-chunk-c1')).toBeInTheDocument();
    // Approved: undo, or reject with a reason.
    expect(screen.getByTestId('undo-chunk-c3')).toBeInTheDocument();
    expect(screen.getByTestId('reject-chunk-c3')).toBeInTheDocument();
    expect(screen.queryByTestId('approve-chunk-c3')).not.toBeInTheDocument();
    // Rejected: it can still be approved, with the token it carries.
    expect(screen.queryByTestId('reject-chunk-c4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('approve-chunk-c4'));
    expect(mockApprove.mock.calls[0][0]).toEqual({
      chunkId: 'c4',
      reviewToken: 'tok-4',
    });
  });

  it('rejects an approved chunk with the reason typed', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('reject-chunk-c3'));
    fireEvent.change(screen.getByTestId('reject-reason-input'), {
      target: { value: 'no longer needed' },
    });
    fireEvent.click(screen.getByTestId('confirm-reject-chunk'));
    expect(mockReject.mock.calls[0][0]).toEqual({
      chunkId: 'c3',
      reason: 'no longer needed',
    });
  });

  // The round trip of the draft edit: the modal shows the whole proposed rule
  // and sends back the document as edited, so a field nobody changed is in
  // the request exactly as it was read.
  it('edits a proposed rule without losing the fields that were not changed', () => {
    renderTab();
    fireEvent.click(screen.getByTestId('edit-chunk-c1'));
    const editor = screen.getByTestId('edit-chunk-json') as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual(richRule);

    const edited = JSON.parse(JSON.stringify(richRule));
    edited.binaries.push({ path: '/usr/bin/node' });
    fireEvent.change(editor, {
      target: { value: JSON.stringify(edited, null, 2) },
    });
    fireEvent.click(screen.getByTestId('save-edit-chunk'));

    expect(mockEdit).toHaveBeenCalledTimes(1);
    const sent = mockEdit.mock.calls[0][0];
    expect(sent.chunkId).toBe('c1');
    expect(sent.proposedRule).toEqual(edited);
    expect(sent.proposedRule.endpoints).toEqual(richRule.endpoints);
  });

  it('does not send a proposed rule that is not a JSON object, and shows a refusal', () => {
    mockEditError = new Error(
      'proposedRule does not match NetworkPolicyRule schema: unknown field "hosts"',
    );
    renderTab();
    fireEvent.click(screen.getByTestId('edit-chunk-c1'));
    expect(screen.getByTestId('edit-chunk-error')).toHaveTextContent(
      'unknown field "hosts"',
    );

    const editor = screen.getByTestId('edit-chunk-json');
    fireEvent.change(editor, { target: { value: '{"name": ' } });
    fireEvent.click(screen.getByTestId('save-edit-chunk'));
    fireEvent.change(editor, { target: { value: '["not", "a", "rule"]' } });
    fireEvent.click(screen.getByTestId('save-edit-chunk'));
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('shows a reader the proposals without the decisions', () => {
    mockIsAdmin = false;
    renderTab();
    expect(screen.getByTestId('draft-chunk-c1')).toBeInTheDocument();
    expect(screen.queryByTestId('approve-all-chunks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approve-chunk-c1')).not.toBeInTheDocument();
    // The filter is a read, so it stays.
    expect(screen.getByTestId('draft-status-pending')).toBeInTheDocument();
  });
  // A second click while the first rejection is on its way would be a second
  // rejection, which the gateway answers with an error for a chunk that is
  // rejected by then.
  it('does not take a second rejection while one is on its way', () => {
    mockRejectPending = true;
    renderTab();
    fireEvent.click(screen.getByTestId('reject-chunk-c1'));
    expect(screen.getByTestId('confirm-reject-chunk')).toBeDisabled();
  });

  // Gateway v0.1.2 refuses, while a gateway-global policy is in force, to
  // approve a chunk ("cannot approve rules while a global policy is active")
  // and to reject an approved one, which would take its rule out again.
  describe('while a gateway-global policy is in force', () => {
    beforeEach(() => {
      mockEffective = { policySource: 'GLOBAL', globalPolicyVersion: 4 };
    });

    it('offers no approval, of one proposal or of all', () => {
      renderTab();
      expect(
        screen.queryByTestId('approve-all-chunks'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('include-security-flagged'),
      ).not.toBeInTheDocument();
      // Pending and rejected chunks are the ones an approval is taken for.
      expect(screen.queryByTestId('approve-chunk-c1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('approve-chunk-c2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('approve-chunk-c4')).not.toBeInTheDocument();
    });

    it('offers no rejection of a proposal that was approved', () => {
      renderTab();
      expect(screen.queryByTestId('reject-chunk-c3')).not.toBeInTheDocument();
    });

    it('says why, and which global policy it is', () => {
      renderTab();
      const note = screen.getByTestId('drafts-global-policy');
      expect(note).toHaveTextContent(
        'Proposals cannot be approved while a gateway-global policy is in force',
      );
      expect(note).toHaveTextContent('(revision 4)');
      expect(note).toHaveTextContent('until the global policy is deleted');
    });

    it('still offers what the gateway takes: rejecting, editing and clearing what is pending', () => {
      renderTab();
      expect(screen.getByTestId('reject-chunk-c1')).toBeInTheDocument();
      expect(screen.getByTestId('edit-chunk-c1')).toBeInTheDocument();
      expect(screen.getByTestId('clear-all-chunks')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('reject-chunk-c1'));
      fireEvent.click(screen.getByTestId('confirm-reject-chunk'));
      expect(mockReject.mock.calls[0][0]).toEqual({
        chunkId: 'c1',
        reason: undefined,
      });
    });

    it('has nothing to explain to a reader, who is offered no decision anyway', () => {
      mockIsAdmin = false;
      renderTab();
      expect(
        screen.queryByTestId('drafts-global-policy'),
      ).not.toBeInTheDocument();
    });
  });

  it('says nothing about a global policy while the sandbox enforces its own', () => {
    renderTab();
    expect(
      screen.queryByTestId('drafts-global-policy'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('approve-all-chunks')).toBeInTheDocument();
  });

  // The inbox is polled. React Query reports a refetch that failed as an
  // error beside the data of the last fetch that worked.
  describe('a refresh of the inbox that fails', () => {
    const answerWith = (answer: Record<string, unknown>) =>
      mockUseDraftPolicy.mockImplementation(() => ({
        isLoading: false,
        data: inbox,
        refetch: jest.fn(),
        ...answer,
      }));
    const failing = {
      isError: true,
      error: new Error('bad gateway'),
    };
    const page = () => (
      <SandboxDraftsTab workspace="team-a" sandboxName="sb1" />
    );

    it('leaves the proposals on screen, with a note that they may be out of date', () => {
      answerWith(failing);
      render(page());
      expect(screen.getByTestId('drafts-refresh-error')).toHaveTextContent(
        'bad gateway',
      );
      expect(screen.getByTestId('draft-chunk-c1')).toBeInTheDocument();
      expect(
        screen.queryByText('Failed to load draft policy'),
      ).not.toBeInTheDocument();
    });

    it('keeps the rule being edited as it was typed', () => {
      answerWith({ isError: false });
      const view = render(page());
      fireEvent.click(screen.getByTestId('edit-chunk-c1'));
      const editor = () =>
        screen.getByTestId('edit-chunk-json') as HTMLTextAreaElement;
      fireEvent.change(editor(), {
        target: { value: '{"name":"edited-by-hand"}' },
      });

      answerWith(failing);
      view.rerender(page());
      expect(editor()).toHaveValue('{"name":"edited-by-hand"}');

      // And through the refresh that works again.
      answerWith({ isError: false });
      view.rerender(page());
      expect(editor()).toHaveValue('{"name":"edited-by-hand"}');
      expect(
        screen.queryByTestId('drafts-refresh-error'),
      ).not.toBeInTheDocument();
    });

    it('keeps the reason being typed for a rejection', () => {
      answerWith({ isError: false });
      const view = render(page());
      fireEvent.click(screen.getByTestId('reject-chunk-c1'));
      fireEvent.change(screen.getByTestId('reject-reason-input'), {
        target: { value: 'too broad' },
      });

      answerWith(failing);
      view.rerender(page());

      expect(screen.getByTestId('reject-reason-input')).toHaveValue(
        'too broad',
      );
    });

    it('still shows the error in place of the tab when the inbox never loaded', () => {
      answerWith({ ...failing, data: undefined });
      render(page());
      expect(
        screen.getByText('Failed to load draft policy'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('drafts-refresh-error'),
      ).not.toBeInTheDocument();
    });
  });
});
