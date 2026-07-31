import type { SandboxPhase } from '../types';
import { getStatusDotColor } from './utils';

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
