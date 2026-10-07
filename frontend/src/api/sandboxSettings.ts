import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CONFIG_POLL_MS } from '../constants';
import { del, get, put } from './client';
import { sandboxKeys } from './queryKeys';
import type {
  Sandbox,
  SandboxSettings,
  SettingDeleteResult,
  SettingSetResult,
  SettingValue,
} from '../types';

// The setting `openshell sandbox create --approval-mode` writes, and the two
// values the gateway takes for it. "manual" is also what applies while the
// setting is unset.
export const PROPOSAL_APPROVAL_MODE_KEY = 'proposal_approval_mode';
export type ApprovalMode = 'manual' | 'auto';

const settingsPath = (workspace: string, name: string): string =>
  `/api/v1/workspaces/${encodeURIComponent(workspace)}/sandboxes/${encodeURIComponent(name)}/settings`;

// The settings in effect for one sandbox, each with the scope its value comes
// from (`openshell settings get <sandbox>`).
export const getSandboxSettings = (
  workspace: string,
  name: string,
): Promise<SandboxSettings> =>
  get<SandboxSettings>(settingsPath(workspace, name));

// The JSON type of `value` is the type the gateway is sent, exactly as for a
// global setting. The gateway refuses the write while the key is set globally.
export const setSandboxSetting = (
  workspace: string,
  name: string,
  key: string,
  value: SettingValue,
): Promise<SettingSetResult> =>
  put<SettingSetResult>(settingsPath(workspace, name), { key, value });

export const deleteSandboxSetting = (
  workspace: string,
  name: string,
  key: string,
): Promise<SettingDeleteResult> =>
  del<SettingDeleteResult>(
    `${settingsPath(workspace, name)}?key=${encodeURIComponent(key)}`,
  );

// Polled: a key that is set or unset on the gateway changes what a sandbox
// reports for it, and whether the sandbox may set it itself.
export const useSandboxSettings = (workspace: string, name: string) =>
  useQuery({
    queryKey: sandboxKeys.settings(workspace, name),
    queryFn: () => getSandboxSettings(workspace, name),
    refetchInterval: CONFIG_POLL_MS,
  });

// Both writes read the settings again whether they succeeded or not. A refusal
// usually means the scope changed under the page (the key was set globally in
// the meantime), and the list is what says so.
export const useSetSandboxSetting = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: SettingValue }) =>
      setSandboxSetting(workspace, name, key, value),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.settings(workspace, name),
      }),
  });
};

export const useDeleteSandboxSetting = (workspace: string, name: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => deleteSandboxSetting(workspace, name, key),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: sandboxKeys.settings(workspace, name),
      }),
  });
};

// What is left to tell the user when a sandbox was created and its approval
// mode could not be set: which sandbox, and the gateway's reason.
export type ApprovalModeFailure = {
  sandboxName: string;
  mode: ApprovalMode;
  message: string;
};

// The second half of creating a sandbox with an approval mode. The mode is not
// a field of the create request: like `openshell sandbox create
// --approval-mode`, the sandbox is created first and the mode is then written
// as a sandbox-scoped setting. "manual" is the default and writes nothing.
//
// apply takes the sandbox the create answered with, whose name the gateway
// may have generated, and resolves to true when there is nothing more to say.
// When the write fails the sandbox stays, without a mode of its own, and
// `failure` holds what to show; the Settings tab of the sandbox is where to
// try again.
export const useApplyApprovalMode = (workspace: string) => {
  const [failure, setFailure] = useState<ApprovalModeFailure | null>(null);
  const [isApplying, setApplying] = useState(false);

  const apply = useCallback(
    async (created: Sandbox, mode: ApprovalMode): Promise<boolean> => {
      // Nothing of the answer is read for the default, so a create succeeds
      // exactly as it did before there was a mode to set.
      if (mode === 'manual') {
        return true;
      }
      const sandboxName = created.metadata.name;
      setApplying(true);
      try {
        await setSandboxSetting(
          workspace,
          sandboxName,
          PROPOSAL_APPROVAL_MODE_KEY,
          mode,
        );
        return true;
      } catch (err) {
        setFailure({ sandboxName, mode, message: (err as Error).message });
        return false;
      } finally {
        setApplying(false);
      }
    },
    [workspace],
  );

  const reset = useCallback(() => setFailure(null), []);

  return { apply, failure, isApplying, reset };
};
