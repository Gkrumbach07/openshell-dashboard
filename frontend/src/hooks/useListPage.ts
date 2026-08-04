import { useState } from 'react';
import { useTableSelection } from './useTableSelection';

export const useListPage = () => {
  const selection = useTableSelection();
  const [isActionsOpen, setActionsOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null);

  const closeDeleteModal = () => {
    setDeleteTargets(null);
  };

  const deleteSelectedLabel =
    selection.numSelected > 0
      ? `Delete selected (${selection.numSelected})`
      : 'Delete selected';

  return {
    ...selection,
    isActionsOpen,
    setActionsOpen,
    deleteTargets,
    setDeleteTargets,
    closeDeleteModal,
    deleteSelectedLabel,
  };
};
