import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { BomHistoryImpactPaths } from './BomHistoryDetails';
import { HistoryEventActions } from './HistoryEventActions';
import { parseUTCEventTime } from './utils';
import type { PmcHistoryEvent } from '../historyTypes';

interface BomHistorySectionProps {
  events: PmcHistoryEvent[];
  expanded: boolean;
  setExpanded: React.Dispatch<React.SetStateAction<{ bom: boolean; inventory: boolean }>>;
  expandedHistoryEvents: Record<string, boolean>;
  setExpandedHistoryEvents: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  expandedHistoryPathNodes: Record<string, boolean>;
  setExpandedHistoryPathNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  historyManageMode: boolean;
  selectedHistoryEventIds: Set<string>;
  onToggleHistoryEventSelected: (eventId: string) => void;
  historyShowDeleted: boolean;
  deletingHistoryEventId: string | null;
  permanentlyDeletingHistoryEventId: string | null;
  restoringHistoryEventId: string | null;
  onDeleteHistoryEvent: (event: PmcHistoryEvent) => Promise<void>;
  onRequestPermanentDeleteHistoryEvent: (event: PmcHistoryEvent) => void;
  onRestoreHistoryEvent: (event: PmcHistoryEvent) => Promise<void>;
}

export const BomHistorySection: React.FC<BomHistorySectionProps> = ({
  events,
  expanded,
  setExpanded,
  expandedHistoryEvents,
  setExpandedHistoryEvents,
  expandedHistoryPathNodes,
  setExpandedHistoryPathNodes,
  historyManageMode,
  selectedHistoryEventIds,
  onToggleHistoryEventSelected,
  historyShowDeleted,
  deletingHistoryEventId,
  permanentlyDeletingHistoryEventId,
  restoringHistoryEventId,
  onDeleteHistoryEvent,
  onRequestPermanentDeleteHistoryEvent,
  onRestoreHistoryEvent,
}) => {
  if (events.length === 0) return null;

  return (
    <div className="border border-slate-200 bg-white rounded-xl shadow-sm overflow-hidden animate-fade-in-up">
      <button onClick={() => setExpanded((prev) => ({ ...prev, bom: !prev.bom }))} className="w-full flex items-center justify-between px-6 py-5 bg-slate-50/50 hover:bg-slate-50 transition-colors border-b border-slate-100 group">
        <div className="flex items-center gap-4">
          <div className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${expanded ? 'bg-slate-900 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-400 group-hover:border-slate-300'}`}>
            {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </div>
          <span className="font-bold text-slate-800 text-[17px] tracking-tight">物料清单变更历史</span>
          <span className="px-3 py-1 rounded-full bg-slate-200/50 text-slate-500 text-[12px] font-bold tabular-nums">{events.length} 条</span>
        </div>
      </button>
      {expanded && (
        <div className="p-4 bg-slate-50/40 border-t border-slate-100 flex flex-col gap-3">
          {events.map((event) => {
            const cardExpanded = !!expandedHistoryEvents[event.event_id];
            const rootCode = event.root_product_code || event.product_code || '-';
            const rootName = event.root_product_name || event.product_name || event.title.replace(/^(BOM变更|物料清单变更|库存更新)\s*[·\-]\s*/, '');
            const dateStr = parseUTCEventTime(event.event_time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

            return (
              <div key={event.event_id} className="relative">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedHistoryEvents((prev) => ({ ...prev, [event.event_id]: !prev[event.event_id] }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedHistoryEvents((prev) => ({ ...prev, [event.event_id]: !prev[event.event_id] }));
                    }
                  }}
                  className={`relative w-full text-left rounded-xl transition-all select-none py-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border overflow-hidden shadow-sm cursor-pointer ${cardExpanded ? 'bg-white border-slate-300 shadow-md' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md'}`}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {historyManageMode && (
                      <input
                        type="checkbox"
                        checked={selectedHistoryEventIds.has(event.event_id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleHistoryEventSelected(event.event_id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 shrink-0"
                      />
                    )}
                    <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-md transition-colors ${cardExpanded ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                      {cardExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold text-slate-400 shrink-0">清单变更</span>
                          <div className="text-[14px] font-semibold text-slate-900 truncate tracking-tight">{rootName}</div>
                        </div>
                        <div className="pmc-history-card-rail">
                          <div className="pmc-history-card-meta">
                            {historyShowDeleted && <span className="pmc-history-status-badge">已归档</span>}
                            <div className="pmc-history-time">{dateStr}</div>
                          </div>
                          {!historyManageMode && (
                            <HistoryEventActions
                              archived={historyShowDeleted}
                              deleting={deletingHistoryEventId === event.event_id}
                              restoring={restoringHistoryEventId === event.event_id}
                              permanentDeleting={permanentlyDeletingHistoryEventId === event.event_id}
                              onArchive={() => { void onDeleteHistoryEvent(event); }}
                              onRestore={() => { void onRestoreHistoryEvent(event); }}
                              onPermanentDelete={() => { onRequestPermanentDeleteHistoryEvent(event); }}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-4 mt-1.5 min-w-0">
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium truncate">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500">成品机清单</span>
                          <span className="opacity-80 font-mono text-[10px]">{rootCode}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 pr-1">
                          {Number(event.summary?.added_count || 0) > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">+{event.summary?.added_count} 新增</span>}
                          {Number(event.summary?.removed_count || 0) > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600">-{event.summary?.removed_count} 删除</span>}
                          {Number(event.summary?.updated_count || 0) > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">~{event.summary?.updated_count} 修改</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {cardExpanded && (
                  <div className="ml-6 pl-4 border-l-2 border-slate-100 mt-2.5 pb-2">
                    <BomHistoryImpactPaths
                      event={event}
                      expandedHistoryPathNodes={expandedHistoryPathNodes}
                      setExpandedHistoryPathNodes={setExpandedHistoryPathNodes}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
