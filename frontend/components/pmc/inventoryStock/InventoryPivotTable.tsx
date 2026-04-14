import React from 'react';
import { UserRound } from 'lucide-react';

import type { InventoryItem, InventoryPivotRow } from './types';
import { resolveItemType } from './utils';

interface InventoryPivotTableProps {
  rows: InventoryPivotRow[];
  itemMap: Map<string, InventoryItem>;
  onSelectPart: (partNo: string) => void;
}

export const InventoryPivotTable: React.FC<InventoryPivotTableProps> = ({
  rows,
  itemMap,
  onSelectPart,
}) => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
    <table className="m-table min-w-[1000px]">
      <colgroup>
        <col style={{ width: '60px' }} />
        <col style={{ width: '220px' }} />
        <col />
        <col style={{ width: '100px' }} />
        <col style={{ width: '100px' }} />
        <col style={{ width: '100px' }} />
        <col style={{ width: '120px' }} />
        <col style={{ width: '140px' }} />
        <col style={{ width: '120px' }} />
      </colgroup>
      <thead>
        <tr>
          <th className="font-semibold text-slate-400 text-center">#</th>
          <th className="font-semibold text-slate-500">货号</th>
          <th className="font-semibold text-slate-500">描述</th>
          <th className="!text-right font-semibold text-slate-500">期初</th>
          <th className="!text-right font-semibold text-slate-500">结存</th>
          <th className="!text-center font-semibold text-slate-500 whitespace-nowrap">异动频次</th>
          <th className="!text-right font-semibold text-slate-500">净变化</th>
          <th className="!text-left font-semibold text-slate-500 pl-4 whitespace-nowrap">去向拆解</th>
          <th className="!text-left font-semibold text-slate-500 whitespace-nowrap">高频申请人</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const itemInfo = itemMap.get(row.partNo);
          const itemType = itemInfo ? resolveItemType(itemInfo) : 'raw_material';
          const isFinished = itemType === 'finished_goods';
          const isSemifinished = itemType === 'semifinished';

          return (
            <tr
              key={`pivot-${row.partNo}`}
              className="cursor-pointer transition-colors hover:bg-slate-50/80 group"
              onClick={() => onSelectPart(row.partNo)}
            >
              <td className="text-center">
                <span className="text-[11px] font-mono text-slate-400 font-medium">{idx + 1}</span>
              </td>
              <td className="font-medium text-slate-900 font-mono tracking-tight">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{row.partNo}</span>
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
                </div>
              </td>
              <td>
                <div className="text-slate-700 text-[13px] line-clamp-2 pr-4 leading-relaxed" title={row.description}>
                  {row.description}
                </div>
              </td>
              <td className="text-right">
                <span className={`font-semibold tabular-nums ${row.originalTotal > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                  {row.originalTotal.toLocaleString()}
                </span>
              </td>
              <td className="text-right">
                <span className={`font-semibold tabular-nums ${row.currentTotal > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                  {row.currentTotal.toLocaleString()}
                </span>
              </td>
              <td className="text-center">
                <span className="font-semibold tabular-nums text-slate-900">
                  {row.frequency}
                </span>
              </td>
              <td className="text-right">
                <span className={`font-bold text-[14px] tabular-nums ${row.netChange < 0 ? 'text-rose-600' : row.netChange > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {row.netChange > 0 ? '+' : ''}{row.netChange.toLocaleString()}
                </span>
              </td>
              <td>
                <div className="flex flex-col gap-1 text-[11px] font-medium tabular-nums pl-4">
                  {row.outboundCount > 0 && <span className="text-rose-600">领用: {row.outboundCount}次</span>}
                  {row.scrapCount > 0 && <span className="text-amber-600">报废: {row.scrapCount}次</span>}
                  {row.inboundCount > 0 && <span className="text-slate-700">入库: {row.inboundCount}次</span>}
                </div>
              </td>
              <td>
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
                  <UserRound className="w-3.5 h-3.5 text-slate-300" />
                  <span className="truncate max-w-[120px]" title={row.topActor}>{row.topActor}</span>
                </div>
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={9} className="py-24 text-center">
              <div className="text-[13px] font-medium text-slate-400">当前视角下未找到带有已确认邮件变动的物料</div>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
