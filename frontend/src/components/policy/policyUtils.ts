import React from 'react';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  HistoryIcon,
  InProgressIcon,
} from '@patternfly/react-icons';

import type { PolicyStatus } from '../../types';

export const policyStatusColor = (
  status: PolicyStatus,
): 'green' | 'red' | 'blue' | 'grey' => {
  switch (status) {
    case 'LOADED':
      return 'green';
    case 'FAILED':
      return 'red';
    case 'PENDING':
      return 'blue';
    default:
      return 'grey';
  }
};

export const policyStatusIcon = (
  status: PolicyStatus,
): React.ReactElement | undefined => {
  switch (status) {
    case 'LOADED':
      return React.createElement(CheckCircleIcon);
    case 'FAILED':
      return React.createElement(ExclamationCircleIcon);
    case 'PENDING':
      return React.createElement(InProgressIcon);
    case 'SUPERSEDED':
      return React.createElement(HistoryIcon);
    default:
      return undefined;
  }
};
