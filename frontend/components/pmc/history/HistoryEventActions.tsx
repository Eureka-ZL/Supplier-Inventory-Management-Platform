import React from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';

interface HistoryEventActionsProps {
  archived: boolean;
  deleting: boolean;
  restoring: boolean;
  permanentDeleting: boolean;
  onArchive?: () => void;
  onRestore?: () => void;
  onPermanentDelete?: () => void;
}

export const HistoryEventActions: React.FC<HistoryEventActionsProps> = ({
  archived,
  deleting,
  restoring,
  permanentDeleting,
  onArchive,
  onRestore,
  onPermanentDelete,
}) => {
  const handleClick =
    (action?: () => void) =>
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      action?.();
    };

  return (
    <div className="pmc-history-actions" onClick={(event) => event.stopPropagation()}>
      {archived ? (
        <>
          <button
            type="button"
            onClick={handleClick(onRestore)}
            disabled={restoring}
            className="pmc-history-action pmc-history-action-restore"
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
            {restoring ? '恢复中...' : '恢复'}
          </button>
          <button
            type="button"
            onClick={handleClick(onPermanentDelete)}
            disabled={permanentDeleting}
            className="pmc-history-action pmc-history-action-danger"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {permanentDeleting ? '删除中...' : '彻底删除'}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleClick(onArchive)}
          disabled={deleting}
          className="pmc-history-action pmc-history-action-neutral"
        >
          <Archive className="w-3.5 h-3.5" />
          {deleting ? '归档中...' : '归档'}
        </button>
      )}
    </div>
  );
};

export default HistoryEventActions;
