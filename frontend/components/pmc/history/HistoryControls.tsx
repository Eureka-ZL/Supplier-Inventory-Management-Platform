import React from 'react';
import { Archive, ArchiveRestore, Clock, SlidersHorizontal, Trash2 } from 'lucide-react';
import { HistoryDatePicker } from './HistoryDatePicker';

interface HistoryControlsProps {
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
  activeCount: number;
  archivedCount: number;
  onDeleteSelectedHistoryEvents: () => Promise<void>;
  onRequestPermanentDeleteSelectedHistoryEvents: () => void;
  onRestoreSelectedHistoryEvents: () => Promise<void>;
  onCleanupHistoryEvents: (days: number) => void;
}

export const HistoryControls: React.FC<HistoryControlsProps> = ({
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
  activeCount,
  archivedCount,
  onDeleteSelectedHistoryEvents,
  onRequestPermanentDeleteSelectedHistoryEvents,
  onRestoreSelectedHistoryEvents,
  onCleanupHistoryEvents,
}) => {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-visible">
      <div className="px-8 py-7 flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center p-1 bg-slate-100/80 rounded-xl">
            <button
              type="button"
              onClick={() => {
                if (historyShowDeleted) {
                  setHistoryShowDeleted(false);
                  setSelectedHistoryEventIds(new Set());
                }
              }}
                  className={`flex items-center gap-2 px-6 py-2 rounded-lg text-[13px] font-bold transition-all border ${!historyShowDeleted ? 'bg-white text-slate-900 shadow-sm border-slate-200/40' : 'bg-transparent text-slate-400 border-transparent hover:text-slate-600'}`}
                >
                  历史记录
                  <span className={`px-2.5 py-0.5 rounded-lg text-[10px] tabular-nums font-bold transition-all ${!historyShowDeleted ? 'bg-slate-100 text-slate-700 shadow-sm' : 'bg-slate-200 text-slate-500'}`}>{activeCount}</span>
                </button>
            <button
              type="button"
              onClick={() => {
                if (!historyShowDeleted) {
                  setHistoryShowDeleted(true);
                  setSelectedHistoryEventIds(new Set());
                }
              }}
              className={`flex items-center gap-2 px-6 py-2 rounded-lg text-[13px] font-bold transition-all border ${historyShowDeleted ? 'bg-white text-amber-700 shadow-sm border-amber-200/40' : 'bg-transparent text-slate-400 border-transparent hover:text-slate-600'}`}
            >
              归档记录
              <span className={`px-2.5 py-0.5 rounded-lg text-[10px] tabular-nums font-bold transition-all ${historyShowDeleted ? 'bg-amber-50 text-amber-600 shadow-sm' : 'bg-slate-200 text-slate-500'}`}>{archivedCount}</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {historyShowDeleted && (
                <button
                  type="button"
                  onClick={() => void onCleanupHistoryEvents(30)}
                  disabled={historyCleaning}
                  className="h-9 px-4 rounded-xl text-slate-400 text-[12px] font-bold hover:text-rose-500 hover:bg-rose-50 transition-all"
                >
                  {historyCleaning ? '清理中...' : '清理归档'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setHistoryManageMode((prev) => {
                  if (prev) setSelectedHistoryEventIds(new Set());
                  return !prev;
                })}
                  className={`h-9 px-4 rounded-xl text-[12px] font-bold transition-all border ${historyManageMode ? 'bg-slate-900 border-slate-900 text-white shadow-md' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 shadow-sm'}`}
                >
                  {historyManageMode ? '退出管理' : '批量管理'}
                </button>
            </div>

            <div className="w-px h-4 bg-slate-200" />

            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50/50 border border-slate-100">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[12px] font-bold text-slate-500 tabular-nums">
                {new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
              </span>
            </div>
          </div>
        </div>

        {historyManageMode && (
          <div className="flex items-center justify-between px-7 py-4 bg-slate-50/50 border border-slate-100 rounded-2xl animate-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-900" />
              <span className="text-[14px] font-bold text-slate-700">
                已选中 <span className="text-slate-900 tabular-nums">{selectedHistoryEventIds.size}</span> 项内容
              </span>
            </div>

            <div className="flex items-center gap-3">
              {!historyShowDeleted && (
                <button
                  type="button"
                  onClick={() => void onDeleteSelectedHistoryEvents()}
                  disabled={historyBatchDeleting || selectedHistoryEventIds.size === 0}
                  className="h-11 px-7 rounded-xl bg-slate-900 text-white text-[14px] font-bold shadow-sm hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all flex items-center gap-2.5"
                >
                  <Archive className="w-4 h-4" />
                  {historyBatchDeleting ? '处理中...' : '归档选中项'}
                </button>
              )}
              {historyShowDeleted && (
                <>
                  <button
                    type="button"
                    onClick={() => void onRestoreSelectedHistoryEvents()}
                    disabled={historyBatchRestoring || selectedHistoryEventIds.size === 0}
                    className="h-11 px-7 rounded-xl bg-slate-900 text-white text-[14px] font-bold shadow-sm hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all flex items-center gap-2.5"
                  >
                    <ArchiveRestore className="w-4 h-4" />
                    {historyBatchRestoring ? '处理中...' : '恢复选中'}
                  </button>
                  <button
                    type="button"
                    onClick={onRequestPermanentDeleteSelectedHistoryEvents}
                    disabled={historyBatchPermanentDeleting || selectedHistoryEventIds.size === 0}
                    className="h-11 px-7 rounded-xl bg-rose-600 text-white text-[14px] font-bold shadow-sm hover:bg-rose-700 disabled:opacity-30 transition-all flex items-center gap-2.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    {historyBatchPermanentDeleting ? '处理中...' : '彻底删除'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="pt-6 border-t border-slate-100 flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <input
                type="text"
                value={historyKeyword}
                onChange={(e) => setHistoryKeyword(e.target.value)}
                placeholder="搜索料号、节点或描述..."
                className="w-full h-10 rounded-xl border border-slate-100 bg-slate-50/40 px-3 pl-9 text-[13px] text-slate-900 focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100 outline-none transition-all placeholder:text-slate-400 font-bold"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-[1.2]">
              <HistoryDatePicker
                value={historyDateFrom}
                onChange={setHistoryDateFrom}
              />
              <span className="text-slate-300 px-1">/</span>
              <HistoryDatePicker
                value={historyDateTo}
                onChange={setHistoryDateTo}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setHistoryKeyword('');
                setHistoryDateFrom('');
                setHistoryDateTo('');
              }}
              className="h-10 px-4 rounded-xl text-slate-400 text-[12px] font-bold hover:text-slate-600 hover:bg-slate-100 transition-all border border-transparent"
            >
              重置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
