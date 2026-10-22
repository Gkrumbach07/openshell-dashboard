export const combineSandboxLabelSelector = (
  generic: string,
  typeLabel: string,
): { selector: string; error?: string } => {
  const selector = generic.trim();
  const type = typeLabel.trim();
  if (!type) return { selector };

  const parts = type.split('=');
  if (
    parts.length !== 2 ||
    !parts[0].trim() ||
    !parts[1].trim() ||
    type.includes(',') ||
    parts[0] !== parts[0].trim() ||
    parts[1] !== parts[1].trim()
  ) {
    return { selector, error: 'Type label must be one key=value pair.' };
  }
  const key = parts[0];
  if (selector.split(',').some((entry) => entry.split('=')[0].trim() === key)) {
    return { selector, error: `The label selector already uses ${key}.` };
  }
  return { selector: selector ? `${selector},${type}` : type };
};
