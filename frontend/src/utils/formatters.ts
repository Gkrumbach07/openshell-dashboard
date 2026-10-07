// How long ago something was created, by the browser's clock. The creation
// time is the gateway's, and the two clocks need not agree: a time the browser
// has not reached yet is one whose clock is behind, not something created in
// the future, so it reads as created just now ("0s") and not as unknown.
export const formatAge = (
  createdAtMs: number,
  nowMs: number = Date.now(),
): string => {
  if (!createdAtMs) {
    return '-';
  }
  const seconds = Math.max(0, Math.floor((nowMs - createdAtMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

export const formatTimestamp = (ms?: number): string =>
  ms ? new Date(ms).toLocaleString() : '-';

export const formatUptime = (
  createdAtMs: number,
  nowMs: number = Date.now(),
): string => {
  if (!createdAtMs || createdAtMs > nowMs) {
    return '';
  }
  const seconds = Math.floor((nowMs - createdAtMs) / 1000);
  if (seconds < 60) {
    return `up ${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `up ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `up ${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `up ${days}d ${hours % 24}h`;
};
