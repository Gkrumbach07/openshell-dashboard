import type { SandboxPhase } from '../types';
import {
  sandboxPhaseTone,
  type SandboxPhaseTone,
} from '../utils/sandboxLifecycle';

const STATUS_DOT_COLORS: Partial<Record<SandboxPhaseTone, string>> = {
  success: 'var(--pf-t--global--color--status--success--default)',
  danger: 'var(--pf-t--global--color--status--danger--default)',
  progress: 'var(--pf-t--global--color--status--info--default)',
  deleting: 'var(--pf-t--global--color--status--warning--default)',
  stopped: 'var(--pf-t--global--icon--color--disabled)',
};

// The color of a phase, by the tone it has in sandboxPhaseTone: COMPLETED is
// a success like READY, and a STOPPED sandbox with an exit code is a failure.
export const getStatusDotColor = (
  phase: SandboxPhase,
  exitCode?: number,
): string =>
  STATUS_DOT_COLORS[sandboxPhaseTone(phase, exitCode)] ??
  'var(--pf-t--global--color--status--custom--default)';

type StatusDotProps = {
  phase: SandboxPhase;
  // The main process exit code, when the sandbox reports one.
  exitCode?: number;
  size?: number;
};

const StatusDot: React.FC<StatusDotProps> = ({ phase, exitCode, size = 8 }) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: getStatusDotColor(phase, exitCode),
      display: 'inline-block',
      flexShrink: 0,
    }}
  />
);

export default StatusDot;
