import React from 'react';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InProgressIcon,
} from '@patternfly/react-icons';

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
