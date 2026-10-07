import type { Sandbox, SandboxPhase } from '../types';

// A sandbox can only be stopped from READY. It can be started from STOPPED
// and from COMPLETED, where its main command has exited with status 0 and a
// start runs it again. The gateway answers a stop of a completed sandbox
// without doing anything, so that is not offered. Shared by the list row
// actions and the detail page header so the two surfaces never disagree on
// which action is available.
export const canStopSandbox = (phase: SandboxPhase): boolean =>
  phase === 'READY';

export const canStartSandbox = (phase: SandboxPhase): boolean =>
  phase === 'STOPPED' || phase === 'COMPLETED';

// How a sandbox's phase reads at a glance, following `openshell sandbox list`:
// READY and COMPLETED are both good news, ERROR is not, and neither is a
// STOPPED sandbox that reports an exit code. A sandbox somebody stopped
// reports none.
export type SandboxPhaseTone =
  'success' | 'danger' | 'progress' | 'deleting' | 'stopped' | 'unknown';

export const sandboxPhaseTone = (
  phase: SandboxPhase,
  exitCode?: number,
): SandboxPhaseTone => {
  switch (phase) {
    case 'READY':
    case 'COMPLETED':
      return 'success';
    case 'ERROR':
      return 'danger';
    case 'STOPPED':
      return exitCode === undefined ? 'stopped' : 'danger';
    case 'PROVISIONING':
    case 'STOPPING':
    case 'STARTING':
      return 'progress';
    case 'DELETING':
      return 'deleting';
    default:
      return 'unknown';
  }
};

// A sandbox whose supervisor refused the configuration it was given.
export type ConfigurationRejection = {
  // Why, in the gateway's words, when it gave any.
  message?: string;
};

const collapseWhitespace = (text?: string): string | undefined =>
  text?.split(/\s+/).filter(Boolean).join(' ') || undefined;

// Whether the sandbox rejected its configuration, which the TUI notes as
// "Invalid config": the condition ConfigurationReady, or Ready, is False with
// the reason ConfigurationInvalid. The gateway derives both from the
// configuration admission the sandbox reported, so a REJECTED admission says
// the same and is read too.
//
// The phase does not say it: the gateway keeps a sandbox whose configuration
// is not accepted in PROVISIONING, not ERROR. The admission's error is the
// reason, and the conditions repeat it.
export const getConfigurationRejection = (
  sandbox: Sandbox,
): ConfigurationRejection | undefined => {
  const { conditions, configurationAdmission } = sandbox.status;
  const condition = conditions?.find(
    (candidate) =>
      (candidate.type === 'ConfigurationReady' || candidate.type === 'Ready') &&
      candidate.status === 'False' &&
      candidate.reason === 'ConfigurationInvalid',
  );
  const rejected = configurationAdmission?.state === 'REJECTED';
  if (!condition && !rejected) {
    return undefined;
  }
  return {
    message:
      (rejected
        ? collapseWhitespace(configurationAdmission?.error)
        : undefined) ?? collapseWhitespace(condition?.message),
  };
};

// Whether the gateway has a policy revision to show for the sandbox. It
// writes the first one when the sandbox's supervisor first asks for its
// configuration, and until then answers a request for the sandbox's policy
// with "no policy revision found" (a 404). A sandbox that reports a policy
// version has one. The list asks only for those, so that a sandbox that was
// just created is not asked for a policy it does not have yet; the sandbox
// list is polled, and the policy is read once the version is there.
export const hasPolicyRevision = (sandbox: Sandbox): boolean =>
  sandbox.status.currentPolicyVersion > 0;
