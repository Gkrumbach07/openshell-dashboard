import type { ProfileCredential } from '../types';

export type CredentialInputSlot = (
  credential: ProfileCredential,
  value: string,
  onChange: (value: string) => void,
) => React.ReactNode;

export type ModelPickerSlot = (
  value: string,
  onChange: (value: string) => void,
) => React.ReactNode;
