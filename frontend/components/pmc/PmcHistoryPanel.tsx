import React from 'react';
import { Clock } from 'lucide-react';
import { BomHistorySection } from './history/BomHistorySection';
import { HistoryControls } from './history/HistoryControls';
import { InventoryHistorySection } from './history/InventoryHistorySection';
import { parseUTCEventTime } from './history/utils';
import type { PmcHistoryEvent } from './historyTypes';

interface PmcHistoryPanelProps {
  historyEvents: PmcHistoryEvent[];
  historyGroupExpanded: { bom: boolean; inventory: boolean };
  setHistoryGroupExpanded: React.Dispatch<React.SetStateAction<{ bom: boolean; inventory: boolean }>>;
  expandedHistoryEvents: Record<string, boolean>;
  setExpandedHistoryEvents: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  expandedHistoryPathNodes: Record<string, boolean>;
  setExpandedHistoryPathNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  deletingHistoryEventId: string | null;
  permanentlyDeletingHistoryEventId: string | null;
  restoringHistoryEventId: string | null;
  historyShowDeleted: boolean;
  setHistoryShowDeleted: React.Dispatch<React.SetStateAction<boolean>>;
  historyManageMode: boolean;
  setHistoryManageMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedHistoryEventIds: Set<string>;
  setSelectedHistoryEventIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  historyBatchDeleting: boolean;
  historyBatchPermanentDeleting: boolean;
  historyBatchRestoring: boolean;
  historyCleaning: boolean;
  historyKeyword: string;
  setHistoryKeyword: React.Dispatch<React.SetStateAction<string>>;
  historyDateFrom: string;
  setHistoryDateFrom: React.Dispatch<React.SetStateAction<string>>;
  historyDateTo: string;
  setHistoryDateTo: React.Dispatch<React.SetStateAction<string>>;
  onDeleteHistoryEvent: (event: PmcHistoryEvent) => Promise<void>;
  onToggleHistoryEventSelected: (eventId: string) => void;
  onDeleteSelectedHistoryEvents: () => Promise<void>;
  onRequestPermanentDeleteHistoryEvent: (event: PmcHistoryEvent) => void;
  onRequestPermanentDeleteSelectedHistoryEvents: () => void;
  onRestoreHistoryEvent: (event: PmcHistoryEvent) => Promise<void>;
  onRestoreSelectedHistoryEvents: () => Promise<void>;
  onCleanupHistoryEvents: (days: number) => void;
  activeCountOverride?: number;
  archivedCountOverride?: number;
}

export const PmcHistoryPanel: React.FC<PmcHistoryPanelProps> = ({
  historyEvents,
  historyGroupExpanded,
  setHistoryGroupExpanded,
  expandedHistoryEvents,
  setExpandedHistoryEvents,
  expandedHistoryPathNodes,
  setExpandedHistoryPathNodes,
  deletingHistoryEventId,
  permanentlyDeletingHistoryEventId,
  restoringHistoryEventId,
  historyShowDeleted,
  setHistoryShowDeleted,
  historyManageMode,
  setHistoryManageMode,
  selectedHistoryEventIds,
  setSelectedHistoryEventIds,
  historyBatchDeleting,
  historyBatchPermanentDeleting,
  historyBatchRestoring,
  historyCleaning,
  historyKeyword,
  setHistoryKeyword,
  historyDateFrom,
  setHistoryDateFrom,
  historyDateTo,
  setHistoryDateTo,
  onDeleteHistoryEvent,
  onToggleHistoryEventSelected,
  onDeleteSelectedHistoryEvents,
  onRequestPermanentDeleteHistoryEvent,
  onRequestPermanentDeleteSelectedHistoryEvents,
  onRestoreHistoryEvent,
  onRestoreSelectedHistoryEvents,
  onCleanupHistoryEvents,
  activeCountOverride,
  archivedCountOverride,
}) => {
  const filteredHistoryEventsAll = historyEvents.filter((event) => {
    const keyword = historyKeyword.trim().toLowerCase();
    if (keyword) {
      const haystack = [
        event.title,
        event.subtitle,
        event.operator,
        event.product_code,
        event.product_name,
        event.root_product_code,
        event.root_product_name,
        event.source_file,
        JSON.stringify(event.detail || {}),
        JSON.stringify(event.summary || {}),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    const eventTs = parseUTCEventTime(event.event_time).getTime();
    if (!Number.isNaN(eventTs)) {
      if (historyDateFrom) {
        const fromTs = new Date(`${historyDateFrom}T00:00:00`).getTime();
        if (!Number.isNaN(fromTs) && eventTs < fromTs) return false;
      }
      if (historyDateTo) {
        const toTs = new Date(`${historyDateTo}T23:59:59.999`).getTime();
        if (!Number.isNaN(toTs) && eventTs > toTs) return false;
      }
    }
    return true;
  });

  const bomHistoryEvents = filteredHistoryEventsAll.filter((event) => event.event_type === 'bom_change');
  const inventoryHistoryEvents = filteredHistoryEventsAll.filter((event) => event.event_type !== 'bom_change');
  const archivedCount = archivedCountOverride ?? historyEvents.filter((event) => event.is_deleted).length;
  const activeCount = activeCountOverride ?? (historyEvents.length - historyEvents.filter((event) => event.is_deleted).length);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <HistoryControls
        historyShowDeleted={historyShowDeleted}
        setHistoryShowDeleted={setHistoryShowDeleted}
        historyManageMode={historyManageMode}
        setHistoryManageMode={setHistoryManageMode}
        selectedHistoryEventIds={selectedHistoryEventIds}
        setSelectedHistoryEventIds={setSelectedHistoryEventIds}
        historyBatchDeleting={historyBatchDeleting}
        historyBatchPermanentDeleting={historyBatchPermanentDeleting}
        historyBatchRestoring={historyBatchRestoring}
        historyCleaning={historyCleaning}
        historyKeyword={historyKeyword}
        setHistoryKeyword={setHistoryKeyword}
        historyDateFrom={historyDateFrom}
        setHistoryDateFrom={setHistoryDateFrom}
        historyDateTo={historyDateTo}
        setHistoryDateTo={setHistoryDateTo}
        activeCount={activeCount}
        archivedCount={archivedCount}
        onDeleteSelectedHistoryEvents={onDeleteSelectedHistoryEvents}
        onRequestPermanentDeleteSelectedHistoryEvents={onRequestPermanentDeleteSelectedHistoryEvents}
        onRestoreSelectedHistoryEvents={onRestoreSelectedHistoryEvents}
        onCleanupHistoryEvents={onCleanupHistoryEvents}
      />

      <div className="space-y-6 pb-20">
        <BomHistorySection
          events={bomHistoryEvents}
          expanded={historyGroupExpanded.bom}
          setExpanded={setHistoryGroupExpanded}
          expandedHistoryEvents={expandedHistoryEvents}
          setExpandedHistoryEvents={setExpandedHistoryEvents}
          expandedHistoryPathNodes={expandedHistoryPathNodes}
          setExpandedHistoryPathNodes={setExpandedHistoryPathNodes}
          historyManageMode={historyManageMode}
          selectedHistoryEventIds={selectedHistoryEventIds}
          onToggleHistoryEventSelected={onToggleHistoryEventSelected}
          historyShowDeleted={historyShowDeleted}
          deletingHistoryEventId={deletingHistoryEventId}
          permanentlyDeletingHistoryEventId={permanentlyDeletingHistoryEventId}
          restoringHistoryEventId={restoringHistoryEventId}
          onDeleteHistoryEvent={onDeleteHistoryEvent}
          onRequestPermanentDeleteHistoryEvent={onRequestPermanentDeleteHistoryEvent}
          onRestoreHistoryEvent={onRestoreHistoryEvent}
        />

        <InventoryHistorySection
          events={inventoryHistoryEvents}
          expanded={historyGroupExpanded.inventory}
          setExpanded={setHistoryGroupExpanded}
          expandedHistoryEvents={expandedHistoryEvents}
          setExpandedHistoryEvents={setExpandedHistoryEvents}
          historyManageMode={historyManageMode}
          selectedHistoryEventIds={selectedHistoryEventIds}
          onToggleHistoryEventSelected={onToggleHistoryEventSelected}
          historyShowDeleted={historyShowDeleted}
          deletingHistoryEventId={deletingHistoryEventId}
          permanentlyDeletingHistoryEventId={permanentlyDeletingHistoryEventId}
          restoringHistoryEventId={restoringHistoryEventId}
          onDeleteHistoryEvent={onDeleteHistoryEvent}
          onRequestPermanentDeleteHistoryEvent={onRequestPermanentDeleteHistoryEvent}
          onRestoreHistoryEvent={onRestoreHistoryEvent}
        />

        {filteredHistoryEventsAll.length === 0 && (
          <div className="pmc-empty-state">
            <div className="w-20 h-20 bg-slate-50 rounded-[28px] flex items-center justify-center border border-slate-100">
              <Clock className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">{historyShowDeleted ? '暂无已归档记录' : '暂无历史记录'}</h3>
            <p className="text-slate-400 font-medium text-sm max-w-xs mx-auto leading-relaxed">
              {historyKeyword || historyDateFrom || historyDateTo
                ? '没有符合当前筛选条件的记录，请调整筛选条件后重试'
                : historyShowDeleted
                  ? '当前没有被移出历史的记录'
                  : '系统尚未检测到历史记录'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PmcHistoryPanel;
