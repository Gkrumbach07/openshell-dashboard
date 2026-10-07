const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

// A duration the way `openshell logs --since` takes it: a whole number and
// one unit, s, m or h ("30s", "5m", "1h"). Returns it in milliseconds, or
// undefined for anything else, including zero, which would select nothing.
export const parseSinceDuration = (input: string): number | undefined => {
  const match = /^(\d+)([smh])$/.exec(input.trim());
  if (!match) {
    return undefined;
  }
  const milliseconds = Number(match[1]) * UNIT_MS[match[2]];
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds
    : undefined;
};
