import { useCallback, useMemo, useState } from 'react';

import type { ApprovalMode } from '../api/sandboxSettings';
import {
  parseCommand,
  parseServiceExposures,
  type ServiceExposureRow,
} from '../utils/sandboxOptions';
import type { ServiceExposure } from '../types';

// The part of a create-sandbox request that is the same whether the workload
// is given inline or comes from a template, because a template holds none of
// it: the main command and its terminal, and the services to expose.
export type SandboxLaunchPayload = {
  command?: string[];
  tty?: boolean;
  serviceExposures?: ServiceExposure[];
};

// State of the fields SandboxLaunchFields renders, shared by the two create
// forms. The approval mode lives here too although it is no part of the create
// request: it is written as a sandbox setting once the sandbox exists.
export const useSandboxLaunchOptions = () => {
  const [commandText, setCommandText] = useState('');
  const [tty, setTty] = useState(false);
  const [exposureRows, setExposureRows] = useState<ServiceExposureRow[]>([]);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('manual');

  const command = useMemo(() => parseCommand(commandText), [commandText]);
  const { exposures, error: exposureError } = useMemo(
    () => parseServiceExposures(exposureRows),
    [exposureRows],
  );

  const reset = useCallback(() => {
    setCommandText('');
    setTty(false);
    setExposureRows([]);
    setApprovalMode('manual');
  }, []);

  // A sandbox without a command runs a login shell, and the gateway gives
  // that shell a terminal whatever the request says. So tty is only sent
  // beside a command, where it decides something.
  const payload = useMemo((): SandboxLaunchPayload => {
    const out: SandboxLaunchPayload = {};
    if (command.length > 0) {
      out.command = command;
      if (tty) {
        out.tty = true;
      }
    }
    if (exposures.length > 0) {
      out.serviceExposures = exposures;
    }
    return out;
  }, [command, tty, exposures]);

  return {
    commandText,
    setCommandText,
    command,
    tty,
    setTty,
    exposureRows,
    setExposureRows,
    exposureError,
    approvalMode,
    setApprovalMode,
    isValid: !exposureError,
    payload,
    reset,
  };
};

export type SandboxLaunchOptions = ReturnType<typeof useSandboxLaunchOptions>;
