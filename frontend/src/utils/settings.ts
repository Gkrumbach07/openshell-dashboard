import type { SettingValue } from '../types';

// The types a gateway setting can take.
export type SettingType = 'string' | 'boolean' | 'integer';

export const SETTING_TYPES: { type: SettingType; label: string }[] = [
  { type: 'string', label: 'String' },
  { type: 'boolean', label: 'Boolean' },
  { type: 'integer', label: 'Integer' },
];

// The type of a setting's current value, or undefined for a setting that was
// never set: the gateway lists those without a value and without a type.
export const settingTypeOf = (
  value: SettingValue | undefined,
): SettingType | undefined => {
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'integer';
    default:
      return undefined;
  }
};

// How a value is shown. An empty string is a value the gateway holds, so it
// is shown as one rather than as nothing.
export const formatSettingValue = (value: SettingValue | undefined): string => {
  if (value === undefined) {
    return '—';
  }
  return value === '' ? '""' : String(value);
};

// What the value control holds for a type before anything is entered.
export const emptySettingText = (type: SettingType): string =>
  type === 'boolean' ? 'false' : '';

// Reads what a value control holds as a value of the given type, or undefined
// when it is not one: text that is not a whole number for an integer.
export const parseSettingValue = (
  type: SettingType,
  text: string,
): SettingValue | undefined => {
  switch (type) {
    case 'boolean':
      return text === 'true';
    case 'integer': {
      const trimmed = text.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        return undefined;
      }
      const parsed = Number(trimmed);
      return Number.isSafeInteger(parsed) ? parsed : undefined;
    }
    default:
      return text;
  }
};
