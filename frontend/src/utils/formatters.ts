export const formatAge = (
  createdAtMs: number,
  nowMs: number = Date.now(),
): string => {
  if (!createdAtMs || createdAtMs > nowMs) {
    return '-';
  }
  const seconds = Math.floor((nowMs - createdAtMs) / 1000);
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
