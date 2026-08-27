import type { SandboxPhase } from '../types';

// A sandbox can only be stopped from READY, and only started from STOPPED —
// shared by the list row actions and the detail page header so the two
// surfaces never disagree on which action is available.
export const canStopSandbox = (phase: SandboxPhase): boolean =>
  phase === 'READY';

export const canStartSandbox = (phase: SandboxPhase): boolean =>
  phase === 'STOPPED';
