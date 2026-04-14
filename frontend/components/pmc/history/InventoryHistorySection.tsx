import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { HistoryEventActions } from './HistoryEventActions';
import { parseUTCEventTime } from './utils';
import type { PmcHistoryEvent } from '../historyTypes';

interface InventoryHistorySectionProps {
  events: PmcHistoryEvent[];
  expanded: boolean;
  setExpanded: React.Dispatch<React.SetStateAction<{ bom: boolean; inventory: boolean }>>;
  expandedHistoryEvents: Record<string, boolean>;
  setExpandedHistoryEvents: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
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

export const InventoryHistorySection: React.FC<InventoryHistorySectionProps> = ({
  events,
  expanded,
  setExpanded,
  expandedHistoryEvents,
  setExpandedHistoryEvents,
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
    <div className="border border-slate-200 bg-white rounded-xl shadow-sm overflow-hidden animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
      <button onClick={() => setExpanded((prev) => ({ ...prev, inventory: !prev.inventory }))} className="w-full flex items-center justify-between px-6 py-5 bg-slate-50/50 hover:bg-slate-50 transition-colors border-b border-slate-100 group">
        <div className="flex items-center gap-4">
          <div className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${expanded ? 'bg-slate-900 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-400 group-hover:border-slate-300'}`}>
            {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </div>
          <span className="font-bold text-slate-800 text-[17px] tracking-tight">库存与操作历史</span>
          <span className="px-3 py-1 rounded-full bg-slate-200/50 text-slate-500 text-[12px] font-bold tabular-nums">{events.length} 条</span>
        </div>
      </button>
      {expanded && (
        <div className="p-4 bg-slate-50/40 border-t border-slate-100 flex flex-col gap-3">
          {events.map((event) => {
            const isAuditEvent = event.event_type === 'audit_log';
            const cardExpanded = !!expandedHistoryEvents[event.event_id];
            const summary = event.summary || {};
            const detail = event.detail || {};
            const addedRows = (detail.added || [])
              .map((row: any) => ({
                ...row,
                rowType: 'added' as const,
                oldDisplay: '-',
                newDisplay: row.new_qty,
                deltaDisplay: row.new_qty,
                sortDelta: Number(row.new_qty || 0),
              }))
              .sort((a: any, b: any) => Math.abs(Number(b.sortDelta || 0)) - Math.abs(Number(a.sortDelta || 0)));
            const removedRows = (detail.removed || [])
              .map((row: any) => ({
                ...row,
                rowType: 'removed' as const,
                oldDisplay: row.old_qty,
                newDisplay: '-',
                deltaDisplay: -(Number(row.old_qty || 0)),
                sortDelta: -(Number(row.old_qty || 0)),
              }))
              .sort((a: any, b: any) => Math.abs(Number(b.sortDelta || 0)) - Math.abs(Number(a.sortDelta || 0)));
            const changedRows = (detail.changed || [])
              .map((row: any) => ({
                ...row,
                rowType: 'changed' as const,
                oldDisplay: row.old_qty,
                newDisplay: row.new_qty,
                deltaDisplay: row.delta,
                sortDelta: Number(row.delta || 0),
              }))
              .sort((a: any, b: any) => Math.abs(Number(b.sortDelta || 0)) - Math.abs(Number(a.sortDelta || 0)));
            const changeRows = [...addedRows, ...changedRows, ...removedRows];

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
                          <span className="text-[11px] font-bold text-slate-400 shrink-0">{isAuditEvent ? '操作记录' : '库存更新'}</span>
                          <div className="text-[14px] font-semibold text-slate-900 truncate tracking-tight">
                            {isAuditEvent ? event.title : event.title.replace(/^(BOM变更|物料清单变更|库存更新)\s*[·\-]\s*/, '')}
                          </div>
                        </div>
                        <div className="pmc-history-card-rail">
                          <div className="pmc-history-card-meta">
                            {historyShowDeleted && <span className="pmc-history-status-badge">已归档</span>}
                            <div className="pmc-history-time">{parseUTCEventTime(event.event_time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
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
                          <span className="opacity-80 text-[10px] truncate max-w-[250px]">{event.subtitle || (isAuditEvent ? '关键操作审计记录' : '数据账目更新')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 pr-1">
                          {isAuditEvent ? (() => {
                            const badgeLabels: Record<string, string> = {
                              'reconciliation_cycle_opened': '周期开启',
                              'reconciliation_cycle_closing_set': '设置期末',
                              'reconciliation_cycle_closing_updated': '更新期末',
                              'reconciliation_cycle_locked': '周期锁定',
                              'reconciliation_cycle_base_updated': '更新期初',
                              'inventory_sheet_uploaded': '上传库存',
                              'inventory_adjustment_confirmed': '确认变动',
                              'inventory_adjustment_rejected': '忽略变动',
                              'database_initialized': '初始化',
                              'database_cleared': '清空数据',
                            };
                            const label = badgeLabels[String(summary.audit_action || '')] || String(summary.audit_action || '');
                            return (
                              <>
                                {summary.audit_scope && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{summary.audit_scope}</span>}
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{label}</span>
                              </>
                            );
                          })() : (
                            <>
                              {(summary.part_added_count || 0) > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">+{summary.part_added_count} 新增料</span>}
                              {(summary.part_removed_count || 0) > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600">-{summary.part_removed_count} 删除料</span>}
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 tabular-nums">总量变动 {(summary.total_qty_delta || 0) > 0 ? '+' : ''}{summary.total_qty_delta || 0}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {cardExpanded && (
                  <div className="border-t border-slate-100 p-6 bg-slate-50/30">
                    {isAuditEvent ? (() => {
                      // ── 审计日志操作类型中文映射 ──
                      const auditActionLabels: Record<string, string> = {
                        'reconciliation_cycle_opened': '对账周期已开启',
                        'reconciliation_cycle_closing_set': '期末库存表已设置',
                        'reconciliation_cycle_closing_updated': '期末库存表已更新',
                        'reconciliation_cycle_locked': '对账周期已锁定',
                        'reconciliation_cycle_base_updated': '期初库存表已更新',
                        'inventory_sheet_uploaded': '库存表已上传',
                        'inventory_adjustment_confirmed': '邮件库存变动已确认',
                        'inventory_adjustment_rejected': '邮件库存变动已忽略',
                        'database_initialized': '数据库初始化',
                        'database_cleared': '数据库已清空',
                      };
                      const actionLabel = auditActionLabels[String(summary.audit_action || '')] || String(summary.audit_action || '-');

                      // ── detail 字段中文映射 ──
                      const detailFieldLabels: Record<string, string> = {
                        'cycle_id': '对账周期',
                        'base_record_id': '期初表 ID',
                        'base_record_name': '期初表',
                        'closing_record_id': '期末表 ID',
                        'closing_record_name': '期末表',
                        'old_closing_record_id': '旧期末表 ID',
                        'new_closing_record_id': '新期末表 ID',
                        'new_closing_record_name': '新期末表',
                        'new_base_record_id': '新期初表 ID',
                        'new_base_record_name': '新期初表',
                        'old_base_record_id': '旧期初表 ID',
                        'record_id': '库存表 ID',
                        'file_name': '文件名',
                        'previous_record_id': '上一份库存表',
                        'previous_cycle_id': '上一个对账周期',
                        'capacity': '产能',
                        'bottleneck': '瓶颈物料',
                        'part_no': '物料编码',
                        'quantity': '数量',
                        'event_id': '异动事件',
                      };

                      const detailEntries = Object.entries(detail || {}).filter(
                        ([, v]) => v !== null && v !== undefined && v !== ''
                      );

                      return (
                        <div className="space-y-4 text-[12px]">
                          {/* ── Summary row ── */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <div className="text-label mb-2">操作类型</div>
                              <div className="text-sm font-bold text-slate-800 leading-snug">{actionLabel}</div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <div className="text-label mb-2">操作人</div>
                              <div className="text-sm font-bold text-slate-800 leading-none">{event.operator || '-'}</div>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <div className="text-label mb-2">时间</div>
                              <div className="text-sm font-bold text-slate-800 leading-none">{parseUTCEventTime(event.event_time).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                            </div>
                          </div>

                          {/* ── Subtitle ── */}
                          {event.subtitle && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] font-medium text-slate-700">
                              {event.subtitle}
                            </div>
                          )}

                          {/* ── Structured detail fields ── */}
                          {detailEntries.length > 0 && (
                            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                                <span className="font-bold text-slate-800 text-[13px]">操作详情</span>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {detailEntries.map(([key, value]) => (
                                  <div key={key} className="px-4 py-2.5 flex items-center gap-4">
                                    <span className="text-[11px] font-bold text-slate-400 w-28 shrink-0">{detailFieldLabels[key] || key}</span>
                                    <span className="text-[13px] font-semibold text-slate-700 truncate">{String(value)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })() : (
                      <div className="space-y-4 text-[12px]">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="rounded-xl border border-emerald-100 bg-white p-4">
                            <div className="text-label mb-2">新增物料</div>
                            <div className="text-2xl font-bold text-emerald-600 leading-none">{summary.part_added_count || 0}</div>
                          </div>
                          <div className="rounded-xl border border-rose-100 bg-white p-4">
                            <div className="text-label mb-2">减少物料</div>
                            <div className="text-2xl font-bold text-rose-600 leading-none">{summary.part_removed_count || 0}</div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="text-label mb-2">数量上升</div>
                            <div className="text-2xl font-bold text-slate-900 leading-none">{summary.qty_increased_count || 0}</div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="text-label mb-2">数量下降</div>
                            <div className="text-2xl font-bold text-slate-600 leading-none">{summary.qty_decreased_count || 0}</div>
                          </div>
                        </div>
                        {changeRows.length > 0 && (
                          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                              <span className="font-bold text-slate-800 text-[13px]">变化明细</span>
                              <span className="text-[11px] font-bold text-slate-400">显示所有有变化的物料，数量变化按绝对变化排序</span>
                            </div>
                            <table className="w-full pmc-table">
                              <colgroup>
                                <col style={{ width: '8%' }} />
                                <col style={{ width: '14%' }} />
                                <col style={{ width: '26%' }} />
                                <col style={{ width: '11%' }} />
                                <col style={{ width: '4%' }} />
                                <col style={{ width: '11%' }} />
                                <col style={{ width: '26%' }} />
                              </colgroup>
                              <thead className="bg-slate-50/50 border-b border-slate-100">
                                <tr>
                                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">标记</th>
                                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">物料编码</th>
                                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-400 tracking-[0.08em]">规格描述</th>
                                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-400 tracking-[0.08em]">变动前</th>
                                  <th className="px-4 py-2.5 text-center text-[11px] font-bold text-slate-400 tracking-[0.08em]"></th>
                                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-400 tracking-[0.08em]">变动后</th>
                                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-400 tracking-[0.08em]">变动量</th>
                                </tr>
                              </thead>
                              <tbody>
                                {changeRows.map((row: any, idx: number) => (
                                  <tr
                                    key={`${row.rowType}-${row.part_no}-${idx}`}
                                    className={`border-b border-slate-100 last:border-b-0 ${
                                      row.rowType === 'added'
                                        ? 'bg-emerald-50/35 hover:bg-emerald-50/50'
                                        : row.rowType === 'removed'
                                          ? 'bg-rose-50/35 hover:bg-rose-50/50'
                                          : 'hover:bg-slate-50/40'
                                    }`}
                                  >
                                    <td className="px-4 py-2.5">
                                      {row.rowType === 'added' ? (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                          新增
                                        </span>
                                      ) : row.rowType === 'removed' ? (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                                          删除
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-slate-800 font-bold text-[12px]">{row.part_no}</td>
                                    <td className="px-4 py-2.5 text-slate-500 text-[11px] truncate max-w-[240px]" title={row.description}>{row.description || '-'}</td>
                                    <td className="px-4 py-2.5 text-right text-slate-500 font-bold text-[12px]">{row.oldDisplay}</td>
                                    <td className="px-4 py-2.5 text-center text-slate-300 text-[11px] font-bold">→</td>
                                    <td className="px-4 py-2.5 text-right font-bold text-slate-800 text-[12px]">{row.newDisplay}</td>
                                    <td className="px-4 py-2.5 text-right">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold ${
                                        Number(row.deltaDisplay || 0) > 0
                                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                          : Number(row.deltaDisplay || 0) < 0
                                            ? 'bg-rose-50 text-rose-600 border border-rose-100'
                                            : 'bg-slate-50 text-slate-400 border border-slate-100'
                                      }`}>
                                        {Number(row.deltaDisplay || 0) > 0 ? '+' : ''}{row.deltaDisplay}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
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
