import React from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';

import type { GlobalShortageEntry } from './types';
import { exportMaterialShortagesToExcel, formatQty, formatReservedUsageText } from './utils';

interface GlobalShortageTableProps {
  rows: GlobalShortageEntry[];
  open: boolean;
  onToggle: () => void;
}

export const GlobalShortageTable: React.FC<GlobalShortageTableProps> = ({
  rows,
  open,
  onToggle,
}) => (
  <div className="border border-slate-200 bg-white rounded-xl overflow-hidden mt-8 shadow-sm">
    <div className="flex items-center gap-4 px-5 py-4 transition-all hover:bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
      >
        <div className={`pmc-row-toggle ${open ? 'is-open' : ''}`}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
        <div className="text-left flex-1 min-w-0">
          <div className="text-[15px] font-bold text-slate-900 tracking-tight">全局联合补料清单</div>
          <div className="text-[11px] text-slate-500 font-medium mt-1 leading-5">
            共计 {rows.length} 项关键缺料；互替料按物料清单结构连续展示，若显示“已使用”，表示这部分库存已被本次全局演算中的已可产数量先使用。
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => {
          exportMaterialShortagesToExcel(rows);
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Download className="w-3.5 h-3.5" />
        导出缺料清单
      </button>
    </div>

    {open && (
      <div className="border-t border-slate-100">
        <div className="overflow-x-auto">
          <table className="m-table min-w-[700px]">
            <thead>
              <tr>
                <th className="text-center w-12">#</th>
                <th>编码 / 组别</th>
                <th>名称</th>
                <th>规格描述 / 说明</th>
                <th className="!text-right whitespace-nowrap w-24">当前库存 / 候选</th>
                <th className="!text-right text-rose-600 whitespace-nowrap w-24">缺口</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.type === 'alternative_group') {
                  const candidates = row.candidates || [];
                  return (
                    <React.Fragment key={row.key}>
                      {candidates.map((candidate, candidateIndex) => (
                        <tr key={`${row.key}-${candidate.part_no}`} className="bg-white">
                          {candidateIndex === 0 ? (
                            <td rowSpan={Math.max(candidates.length, 1)} className="text-center text-slate-500 text-[12px] font-semibold align-middle">
                              <div>{idx + 1}</div>
                            </td>
                          ) : null}
                          <td className="font-mono text-[12px] font-medium text-slate-900">
                            <div className="flex items-center gap-2">
                              <span>{candidate.part_no}</span>
                              <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-slate-100 text-slate-700 text-[8px] font-bold tracking-widest whitespace-nowrap shrink-0 leading-none">
                                互替
                              </span>
                            </div>
                          </td>
                          <td className="text-[13px] text-slate-800 font-medium">{candidate.name || candidate.part_no}</td>
                          <td className="text-[12px] text-slate-500">
                            <div>{candidate.spec || '-'}</div>
                            {candidateIndex === 0 ? (
                              <div className="text-[11px] text-slate-400 mt-1">
                                {(row.source_product_name ? `${row.source_product_name} · ` : '')}同组任选其一满足即可
                              </div>
                            ) : null}
                          </td>
                          <td className="text-right tabular-nums text-slate-600">
                            <div>{formatQty(Number(candidate.available_qty || 0))}</div>
                            {Number(candidate.reserved_qty || 0) > 0 ? (
                              <div className="text-[10px] text-amber-600 mt-1 whitespace-nowrap">
                                {formatReservedUsageText(Number(candidate.reserved_qty || 0))}
                              </div>
                            ) : null}
                          </td>
                          <td className="text-right font-bold text-rose-600 tabular-nums">{formatQty(Number(candidate.shortage_qty || 0))}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                }

                return (
                  <tr key={row.key}>
                    <td className="text-center text-slate-400 text-[12px]">{idx + 1}</td>
                    <td className="font-mono text-[12px] font-medium text-slate-900">{row.part_no}</td>
                    <td className="text-[13px] text-slate-800 font-medium">{row.name || row.part_no}</td>
                    <td className="text-[12px] text-slate-500">{row.spec || '-'}</td>
                    <td className="text-right tabular-nums text-slate-600">
                      <div>{formatQty(Number(row.available_qty || 0))}</div>
                      {Number(row.reserved_qty || 0) > 0 ? (
                        <div className="text-[10px] text-amber-600 mt-1 whitespace-nowrap">
                          {formatReservedUsageText(Number(row.reserved_qty || 0))}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-right font-bold text-rose-600 tabular-nums">{formatQty(Number(row.shortage_qty || 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </div>
);
