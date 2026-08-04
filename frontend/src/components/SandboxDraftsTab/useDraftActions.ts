import {
  useApproveAllDraftChunks,
  useApproveDraftChunk,
  useClearDraftChunks,
  useEditDraftChunk,
  useRejectDraftChunk,
  useUndoDraftChunk,
} from '../../api/policy';

export const useDraftActions = (workspace: string, sandboxName: string) => {
  const approve = useApproveDraftChunk(workspace, sandboxName);
  const reject = useRejectDraftChunk(workspace, sandboxName);
  const approveAll = useApproveAllDraftChunks(workspace, sandboxName);
  const edit = useEditDraftChunk(workspace, sandboxName);
  const undo = useUndoDraftChunk(workspace, sandboxName);
  const clear = useClearDraftChunks(workspace, sandboxName);

  const mutationError =
    approve.error ||
    reject.error ||
    approveAll.error ||
    edit.error ||
    undo.error ||
    clear.error;

  return { approve, reject, approveAll, edit, undo, clear, mutationError };
};
