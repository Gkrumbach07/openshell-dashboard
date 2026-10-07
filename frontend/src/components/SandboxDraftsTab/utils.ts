import React from 'react';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InProgressIcon,
} from '@patternfly/react-icons';

import type { DraftChunkApproval, PolicyChunk } from '../../types';

export const eventColor = (
  eventType: string,
): 'green' | 'red' | 'blue' | 'orange' | 'grey' => {
  const lower = eventType.toLowerCase();
  if (lower.includes('approved') || lower.includes('approve')) return 'green';
  if (
    lower.includes('rejected') ||
    lower.includes('reject') ||
    lower.includes('cleared')
  )
    return 'red';
  if (lower.includes('proposed') || lower.includes('submit')) return 'blue';
  if (lower.includes('undo')) return 'orange';
  return 'grey';
};

export const chunkStatusColor = (
  status: string,
): 'green' | 'red' | 'blue' | 'grey' => {
  switch (status) {
    case 'approved':
      return 'green';
    case 'rejected':
      return 'red';
    case 'pending':
      return 'blue';
    default:
      return 'grey';
  }
};

export const chunkStatusIcon = (
  status: string,
): React.ReactElement | undefined => {
  switch (status) {
    case 'approved':
      return React.createElement(CheckCircleIcon);
    case 'rejected':
      return React.createElement(ExclamationCircleIcon);
    case 'pending':
      return React.createElement(InProgressIcon);
    default:
      return undefined;
  }
};

// The statuses `openshell draft get --status` filters by. The empty one is no
// filter at all.
export const CHUNK_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
] as const;

// The approvals a bulk approval sends: every pending chunk on screen, each
// with the review token it was fetched with. The gateway approves a chunk
// only when the token still matches, so what gets approved is what was shown.
export const pendingApprovals = (chunks: PolicyChunk[]): DraftChunkApproval[] =>
  chunks
    .filter((chunk) => chunk.status === 'pending')
    .map((chunk) =>
      chunk.reviewToken
        ? { chunkId: chunk.id, reviewToken: chunk.reviewToken }
        : { chunkId: chunk.id },
    );

// The categories a prover verdict names, one per line after the first, as the
// TUI summarizes them.
export const validationIssueSummary = (validation: string): string => {
  const issues: string[] = [];
  validation
    .split('\n')
    .slice(1)
    .forEach((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) return;
      const label = line.slice(0, separator).trim().replace(/_/g, ' ');
      if (label && !issues.includes(label)) issues.push(label);
    });
  return issues.length > 0
    ? issues.join(', ')
    : (validation.split('\n')[0] ?? validation);
};

export type ApprovalAnnotation = {
  label: string;
  detail: string;
  color: 'green' | 'orange' | 'grey';
};

// What the gateway's own checks say about a proposal, in the words the TUI
// uses (openshell-tui sandbox_draft.rs approval_annotation): whether it was
// approved without a reviewer, needs one, or cannot be applied at all.
export const approvalAnnotation = (
  chunk: PolicyChunk,
): ApprovalAnnotation | undefined => {
  const applicationError = (chunk.applicationError ?? '').trim();
  if (applicationError) {
    return {
      label: 'application blocked',
      detail: `candidate cannot be applied: ${applicationError}`,
      color: 'orange',
    };
  }
  const validation = (chunk.validationResult ?? '').trim();
  if (!validation) return undefined;

  if (validation === 'prover: no new findings') {
    return chunk.status === 'approved'
      ? {
          label: 'auto-approved',
          detail: 'proposal was auto-approved; no additional risk detected',
          color: 'green',
        }
      : {
          label: 'review required',
          detail: 'rule requires review; no additional risk detected',
          color: 'orange',
        };
  }

  const issues = validationIssueSummary(validation);
  return chunk.status === 'approved'
    ? {
        label: 'reviewed',
        detail: `rule was approved after review; possible issues: ${issues}`,
        color: 'grey',
      }
    : {
        label: 'review required',
        detail: `rule was not auto-approved and requires review; possible issues: ${issues}`,
        color: 'orange',
      };
};
