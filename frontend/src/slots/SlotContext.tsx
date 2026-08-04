import { createContext, useContext } from 'react';
import type { CredentialInputSlot, ModelPickerSlot } from './types';

export type SlotDefinitions = {
  credentialInput?: CredentialInputSlot;
  modelPicker?: ModelPickerSlot;
  workspaceBinding?: (workspace: string) => React.ReactNode;
  sandboxMetadata?: (workspace: string, sandbox: string) => React.ReactNode;
  sandboxActions?: (workspace: string, sandbox: string) => React.ReactNode;
};

const SlotContext = createContext<SlotDefinitions>({});

export const SlotProvider: React.FC<{
  slots: SlotDefinitions;
  children: React.ReactNode;
}> = ({ slots, children }) => (
  <SlotContext.Provider value={slots}>{children}</SlotContext.Provider>
);

export const useSlots = (): SlotDefinitions => useContext(SlotContext);
