import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Clock3, FileText, Package, UserRound, X } from 'lucide-react';

import type { InventoryItem, InventoryTraceData } from './types';

interface InventoryTraceModalProps {
  item: InventoryItem | null;
  trace: InventoryTraceData | null;
  onClose: () => void;
}

export const InventoryTraceModal: React.FC<InventoryTraceModalProps> = ({
  item,
  trace,
  onClose,
}) => {
  if (!item || !trace) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/15 backdrop-blur-sm p-4 sm:p-8 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-[24px] border border-black/5 bg-white shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-black/5 px-8 py-6">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-semibold text-slate-800 tracking-tight">{item.part_no}</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                邮件库存变动对账
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{item.description || '暂无物料描述'}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid shrink-0 gap-4 border-b border-black/5 bg-slate-50/50 px-8 py-6 md:grid-cols-3">
          <div className="rounded-xl border border-black/5 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">基准库存</div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-800">{trace.baseQuantity.toLocaleString()}</div>
            <div className="mt-1 text-xs text-slate-400">{trace.baseTimestamp}</div>
          </div>
          <div className="rounded-xl border border-black/5 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">期末库存</div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{trace.currentQuantity.toLocaleString()}</div>
            <div className="mt-1 text-xs text-slate-400">{trace.latestTimestamp}</div>
          </div>
          <div className="rounded-xl border border-black/5 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">邮件净变化</div>
            <div className={`mt-1.5 text-2xl font-semibold tracking-tight ${trace.emailNetChange <= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
              {trace.emailNetChange > 0 ? '+' : ''}{trace.emailNetChange.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              共 {trace.steps.length} 次已确认邮件变动
            </div>
          </div>
        </div>

        <div className="shrink-0 border-b border-black/5 bg-white px-8 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-slate-500">
            <span>邮件累计推算期末: <span className="font-semibold text-slate-900">{trace.projectedQuantity.toLocaleString()}</span></span>
            <span>与期末库存差异: <span className={`font-semibold ${trace.variance === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{trace.variance > 0 ? `+${trace.variance}` : trace.variance}</span></span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {trace.steps.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-12 text-center">
              <Package className="mx-auto mb-4 h-10 w-10 text-slate-200" />
              <div className="text-base font-semibold text-slate-700">这条物料在当前库存周期内还没有已确认邮件</div>
              <p className="mt-2 text-sm text-slate-500">当前看到的是两次库存表的官方库存，对账时还没有可参考的邮件确认流水。</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trace.steps.map((step) => (
                <div key={step.id} className="rounded-xl border border-black/5 bg-white p-5 shadow-sm transition hover:border-black/10">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide ${step.delta < 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                          {step.changeLabel}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                          <Clock3 className="h-3 w-3" />
                          {step.timestamp}
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                          <UserRound className="h-3.5 w-3.5 text-slate-400" />
                          {step.actor}
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-500 text-xs">{step.sender}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 rounded-xl border border-black/5 bg-slate-50/50 px-5 py-3">
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">变动前</div>
                        <div className="text-base font-semibold text-slate-700">{step.beforeQuantity.toLocaleString()}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-300" />
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">变动后</div>
                        <div className="text-base font-semibold text-slate-900">{step.afterQuantity.toLocaleString()}</div>
                      </div>
                    <div className={`ml-2 rounded-lg px-3 py-1.5 text-sm font-semibold ${step.delta < 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {step.delta > 0 ? '+' : ''}{step.delta.toLocaleString()}
                    </div>
                  </div>
                </div>

                  <div className="mt-4 rounded-xl border border-black/5 bg-slate-50/50 p-4">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      原邮件内容
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{step.originalEmailBody}</div>
                  </div>

                  {step.applyNote && (
                    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/70 p-4">
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                        确认备注
                      </div>
                      <p className="text-sm leading-relaxed text-amber-900/80">{step.applyNote}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
