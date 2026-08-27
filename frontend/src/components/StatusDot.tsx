import type { SandboxPhase } from '../types';

const STATUS_DOT_COLORS: Partial<Record<SandboxPhase, string>> = {
  READY: 'var(--pf-t--global--color--status--success--default)',
  ERROR: 'var(--pf-t--global--color--status--danger--default)',
  PROVISIONING: 'var(--pf-t--global--color--status--info--default)',
  STARTING: 'var(--pf-t--global--color--status--info--default)',
  STOPPING: 'var(--pf-t--global--color--status--info--default)',
  DELETING: 'var(--pf-t--global--color--status--warning--default)',
  STOPPED: 'var(--pf-t--global--icon--color--disabled)',
};

export const getStatusDotColor = (phase: SandboxPhase): string =>
  STATUS_DOT_COLORS[phase] ??
  'var(--pf-t--global--color--status--custom--default)';

type StatusDotProps = {
  phase: SandboxPhase;
  size?: number;
};

const StatusDot: React.FC<StatusDotProps> = ({ phase, size = 8 }) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: getStatusDotColor(phase),
      display: 'inline-block',
      flexShrink: 0,
    }}
  />
);

export default StatusDot;
