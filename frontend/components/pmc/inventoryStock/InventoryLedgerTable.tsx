import React from 'react';

import type { InventoryAdjustmentEvent } from '../../../services/api';
import type { InventoryItem } from './types';
import { isProductOrSemifinished, normalizePartNo, resolveItemType } from './utils';

interface InventoryLedgerTableProps {
  items: InventoryItem[];
  appliedEventsByPart: Map<string, InventoryAdjustmentEvent[]>;
  onSelectPart: (partNo: string) => void;
}

export const InventoryLedgerTable: React.FC<InventoryLedgerTableProps> = ({
  items,
  appliedEventsByPart,
  onSelectPart,
}) => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <table className="m-table min-w-[800px]">
      <colgroup>
        <col style={{ width: '60px' }} />
        <col style={{ width: '220px' }} />
        <col />
        <col style={{ width: '120px' }} />
        <col style={{ width: '120px' }} />
        <col style={{ width: '140px' }} />
      </colgroup>
      <thead>
        <tr>
          <th className="font-semibold text-slate-400 text-center">#</th>
          <th className="font-semibold text-slate-500">货号</th>
          <th className="font-semibold text-slate-500">描述</th>
          <th className="!text-right font-semibold text-slate-500">良品</th>
          <th className="!text-right font-semibold text-slate-500">不良</th>
          <th className="!text-right font-semibold text-slate-500">合计</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, idx) => {
          const goodQty = item.good_qty ?? item.quantity ?? 0;
          const badQty = item.bad_qty ?? 0;
          const normalizedPartNo = normalizePartNo(item.part_no);
          const appliedEvents = appliedEventsByPart.get(normalizedPartNo) || [];
          const hasAdjustment = appliedEvents.length > 0;
          const itemType = resolveItemType(item);
          const isFinished = itemType === 'finished_goods';
          const isSemifinished = itemType === 'semifinished';

          return (
            <tr
              key={`${item.part_no}-${idx}`}
              className={hasAdjustment ? 'cursor-pointer transition-colors hover:bg-slate-50/80' : ''}
              onClick={() => {
                if (!hasAdjustment) return;
                onSelectPart(normalizedPartNo);
              }}
            >
              <td className="text-center">
                <span className="text-[11px] font-mono text-slate-400 font-medium">{idx + 1}</span>
              </td>
              <td className="font-medium text-slate-900 font-mono tracking-tight">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{item.part_no}</span>
                  {isFinished && (
                    <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 whitespace-nowrap leading-none h-[18px]">
                      成品机
                    </span>
                  )}
                  {isSemifinished && (
                    <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 whitespace-nowrap leading-none h-[18px]">
                      半成品
                    </span>
                  )}
                  {hasAdjustment && (
                    <span
                      className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 whitespace-nowrap leading-none h-[18px]"
                      title={`包含 ${appliedEvents.length} 条已确认的邮件变动`}
                    >
                      异动 {appliedEvents.length}
                    </span>
                  )}
                </div>
              </td>
              <td>
                <div className="text-slate-700 text-[13px] line-clamp-2 pr-4 leading-relaxed" title={item.description || '-'}>
                  {item.description || '-'}
                </div>
              </td>
              <td className="text-right">
                <span className={`font-semibold tabular-nums ${goodQty > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                  {goodQty.toLocaleString()}
                </span>
              </td>
              <td className="text-right">
                <span className={`font-semibold tabular-nums ${badQty > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {badQty.toLocaleString()}
                </span>
              </td>
              <td className="text-right">
                <span className="font-bold tabular-nums text-slate-900 underline-offset-4 group-hover:underline">
                  {(goodQty + badQty).toLocaleString()}
                </span>
              </td>
            </tr>
          );
        })}
        {items.length === 0 && (
          <tr>
            <td colSpan={6} className="py-24 text-center">
              <div className="text-[13px] font-medium text-slate-400">未找到匹配的物料数据</div>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
