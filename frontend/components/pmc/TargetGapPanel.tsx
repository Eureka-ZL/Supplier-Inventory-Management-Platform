import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';

import { GlobalShortageTable } from './targetGap/GlobalShortageTable';
import { buildTargetGapRowTree, TargetGapTree } from './targetGap/TargetGapTree';
import type {
  GlobalShortageEntry,
  TargetGapInputRow,
  TargetGapPanelProps,
} from './targetGap/types';
import { formatProductName } from './targetGap/utils';

export const TargetGapPanel: React.FC<TargetGapPanelProps> = ({
  targetGapMode,
  onChangeTargetGapMode,
  targetGapLines,
  targetGapProductsByLine,
  displayLineName,
  getTargetGapProductStableKey,
  targetGapRows,
  setTargetGapRows,
  targetGapLoading,
  onAnalyzeTargetGapBatch,
  targetGapBatchResult,
}) => {
  const [expandedResultRows, setExpandedResultRows] = useState<Record<string, boolean>>({});
  const [showTargetGapActions, setShowTargetGapActions] = useState(false);
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Record<string, boolean>>({});
  const selectedProductKeyCount: Record<string, number> = targetGapRows.reduce((acc: Record<string, number>, row) => {
    const key = (row.productKey || '').trim();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const hasDuplicateProduct = Object.values(selectedProductKeyCount).some((count) => Number(count) > 1);
  const totalModelLimit = (() => {
    const keys = new Set<string>();
    targetGapLines.forEach((line) => {
      const products = targetGapProductsByLine[line] || [];
      products.forEach((product) => keys.add(getTargetGapProductStableKey(product)));
    });
    return keys.size;
  })();
  const hasReachedModelLimit = totalModelLimit > 0 && targetGapRows.length >= totalModelLimit;

  const addTargetRow = () => {
    if (hasReachedModelLimit) return;
    setTargetGapRows((prev) => [
      ...prev,
      {
        id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        line: '',
        productKey: '',
        targetUnits: '',
      },
    ]);
  };

  const removeTargetRow = (id: string) => {
    setTargetGapRows((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.id !== id);
    });
  };

  const updateTargetRow = (id: string, patch: Partial<TargetGapInputRow>) => {
    setTargetGapRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const merged = { ...row, ...patch };
        if (patch.line !== undefined && patch.line !== row.line) {
          merged.productKey = '';
        }
        return merged;
      })
    );
  };

  const handleTargetUnitsKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    if ((event.nativeEvent as KeyboardEvent).isComposing) return;
    event.preventDefault();
    onAnalyzeTargetGapBatch();
  };

  const globalShortageEntries = useMemo<GlobalShortageEntry[]>(() => {
    if (!targetGapBatchResult) return [];

    const materialMap = new Map<string, GlobalShortageEntry>();
    const alternativeGroupMap = new Map<string, GlobalShortageEntry>();

    targetGapBatchResult.rows.forEach((row) => {
      (row.layers || []).forEach((layer) => {
        (layer.rows || []).forEach((item) => {
          if (item.is_subassembly) return;
          const shortageQty = Number(item.shortage_qty || 0);
          if (shortageQty <= 0) return;

          const partNo = String(item.part_no || '').trim();
          if (!partNo) return;
          const sourceProductCode = String(item.source_product_code || '').trim();
          const sourceProductName = String(item.source_product_name || row.product || '').trim();
          const altGroup = item.alt_group;

          if (item.is_alternative && altGroup !== undefined && altGroup !== null) {
            const groupKey = `${sourceProductCode || row.product}::${String(altGroup)}`;
            const labelBase = String(item.name || partNo).trim() || '替代料';
            const existingGroup = alternativeGroupMap.get(groupKey);
            if (!existingGroup) {
              alternativeGroupMap.set(groupKey, {
                key: groupKey,
                type: 'alternative_group',
                label: `${labelBase} 替代组`,
                name: labelBase,
                shortage_qty: shortageQty,
                source_product_name: sourceProductName,
                produced_units: Number(row.current_capacity || 0),
                option_count: 1,
                candidates: [
                  {
                    part_no: partNo,
                    name: String(item.name || '').trim(),
                    spec: String(item.spec || '').trim(),
                    available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
                    current_available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
                    simulated_available_qty: Number(item.simulated_available_qty || 0),
                    reserved_qty: Number(item.reserved_qty || 0),
                    produced_units: Number(row.current_capacity || 0),
                    shortage_qty: shortageQty,
                  },
                ],
              });
              return;
            }
            existingGroup.shortage_qty = Math.min(Number(existingGroup.shortage_qty || 0), shortageQty);
            existingGroup.source_product_name = existingGroup.source_product_name || sourceProductName;
            existingGroup.produced_units = Math.max(Number(existingGroup.produced_units || 0), Number(row.current_capacity || 0));
            const candidates = existingGroup.candidates || [];
            const existingCandidate = candidates.find((candidate) => candidate.part_no === partNo);
            if (existingCandidate) {
              existingCandidate.shortage_qty += shortageQty;
              existingCandidate.available_qty = Math.max(
                Number(existingCandidate.available_qty || 0),
                Number(item.current_available_qty ?? item.available_qty ?? 0)
              );
              existingCandidate.current_available_qty = Math.max(
                Number(existingCandidate.current_available_qty || 0),
                Number(item.current_available_qty ?? item.available_qty ?? 0)
              );
              existingCandidate.simulated_available_qty = Math.max(
                Number(existingCandidate.simulated_available_qty || 0),
                Number(item.simulated_available_qty || 0)
              );
              existingCandidate.reserved_qty = Math.max(
                Number(existingCandidate.reserved_qty || 0),
                Number(item.reserved_qty || 0)
              );
              existingCandidate.produced_units = Math.max(
                Number(existingCandidate.produced_units || 0),
                Number(row.current_capacity || 0)
              );
              if (!existingCandidate.name && item.name) existingCandidate.name = String(item.name || '').trim();
              if (!existingCandidate.spec && item.spec) existingCandidate.spec = String(item.spec || '').trim();
            } else {
              candidates.push({
                part_no: partNo,
                name: String(item.name || '').trim(),
                spec: String(item.spec || '').trim(),
                available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
                current_available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
                simulated_available_qty: Number(item.simulated_available_qty || 0),
                reserved_qty: Number(item.reserved_qty || 0),
                produced_units: Number(row.current_capacity || 0),
                shortage_qty: shortageQty,
              });
            }
            existingGroup.candidates = candidates.sort((a, b) => Number(a.shortage_qty || 0) - Number(b.shortage_qty || 0));
            existingGroup.option_count = existingGroup.candidates.length;
            return;
          }

          const existingMaterial = materialMap.get(partNo);
          if (!existingMaterial) {
            materialMap.set(partNo, {
              key: partNo,
              type: 'material',
              label: partNo,
              part_no: partNo,
              name: String(item.name || '').trim(),
              spec: String(item.spec || '').trim(),
              available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
              current_available_qty: Number(item.current_available_qty ?? item.available_qty ?? 0),
              simulated_available_qty: Number(item.simulated_available_qty || 0),
              reserved_qty: Number(item.reserved_qty || 0),
              produced_units: Number(row.current_capacity || 0),
              shortage_qty: shortageQty,
            });
            return;
          }
          existingMaterial.shortage_qty += shortageQty;
          existingMaterial.available_qty = Math.max(
            Number(existingMaterial.available_qty || 0),
            Number(item.current_available_qty ?? item.available_qty ?? 0)
          );
          existingMaterial.current_available_qty = Math.max(
            Number(existingMaterial.current_available_qty || 0),
            Number(item.current_available_qty ?? item.available_qty ?? 0)
          );
          existingMaterial.simulated_available_qty = Math.max(
            Number(existingMaterial.simulated_available_qty || 0),
            Number(item.simulated_available_qty || 0)
          );
          existingMaterial.reserved_qty = Math.max(Number(existingMaterial.reserved_qty || 0), Number(item.reserved_qty || 0));
          existingMaterial.produced_units = Math.max(Number(existingMaterial.produced_units || 0), Number(row.current_capacity || 0));
          if (!existingMaterial.name && item.name) existingMaterial.name = String(item.name || '').trim();
          if (!existingMaterial.spec && item.spec) existingMaterial.spec = String(item.spec || '').trim();
        });
      });
    });

    return [
      ...Array.from(alternativeGroupMap.values()),
      ...Array.from(materialMap.values()),
    ].sort((a, b) => Number(b.shortage_qty || 0) - Number(a.shortage_qty || 0));
  }, [targetGapBatchResult]);


  return (
    <div className="animate-fade-in m-panel mb-8">
      <div className="m-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border-b border-slate-100">
        <div className="flex flex-col">
          <h3 className="m-title text-slate-900">目标缺料演算</h3>
        </div>
        <div className="pmc-section-actions justify-end">
          <div className="pmc-segmented">
            <button
              type="button"
              onClick={() => onChangeTargetGapMode('finished')}
              className={`pmc-segmented-button ${targetGapMode === 'finished' ? 'active' : ''}`}
            >
              成品机演算
            </button>
            <button
              type="button"
              onClick={() => onChangeTargetGapMode('subassembly')}
              className={`pmc-segmented-button ${targetGapMode === 'subassembly' ? 'active' : ''}`}
            >
              子装配演算
            </button>
          </div>
          <button
            type="button"
            onClick={addTargetRow}
            disabled={hasReachedModelLimit}
            className={`h-9 px-4 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 flex items-center gap-2 transition-all font-medium text-[13px] ${
              hasReachedModelLimit ? 'opacity-30' : ''
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>{targetGapMode === 'finished' ? '添加成品机' : '添加子装配'}</span>
          </button>
          <button
            onClick={onAnalyzeTargetGapBatch}
            disabled={targetGapLoading || targetGapRows.length === 0 || hasDuplicateProduct}
            className={`bg-slate-900 text-white hover:bg-slate-800 h-9 px-6 rounded-lg flex items-center justify-center gap-2 transition-all font-medium text-[13px] shadow-sm ${
              targetGapLoading || targetGapRows.length === 0 || hasDuplicateProduct
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {targetGapLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
            )}
            <span>{targetGapLoading ? '正在演算...' : '开始全局演算'}</span>
          </button>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {targetGapRows.map((row) => {
          const products = targetGapProductsByLine[row.line] || [];
          return (
            <div key={row.id} className="flex flex-col sm:flex-row sm:items-end gap-4 p-4 bg-slate-50 border border-slate-200/80 rounded-2xl transition-all hover:bg-white hover:shadow-sm">
              <div className="flex-1 min-w-0">
                <label className="text-[13px] font-medium text-slate-700 mb-1.5 block truncate">选择产品</label>
                <div className="relative">
                  <select
                    value={row.line}
                    onChange={(e) => updateTargetRow(row.id, { line: e.target.value })}
                    className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 pr-10 text-[13px] text-slate-900 shadow-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 outline-none transition-all appearance-none truncate"
                  >
                    <option value="">请选择</option>
                    {targetGapLines.map((line) => (
                      <option key={`target-gap-line-${row.id}-${line}`} value={line}>
                        {displayLineName(line)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <div className="flex-[2] min-w-0">
                <label className="text-[13px] font-medium text-slate-700 mb-1.5 block truncate">
                  {targetGapMode === 'finished' ? '成品机型号' : '子装配型号'}
                </label>
                <div className="relative">
                  <select
                    value={row.productKey}
                    onChange={(e) => updateTargetRow(row.id, { productKey: e.target.value })}
                    disabled={!row.line}
                    className={`w-full h-10 rounded-lg border border-slate-200 bg-white px-3 pr-10 text-[13px] text-slate-900 shadow-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 outline-none transition-all appearance-none truncate ${!row.line ? 'opacity-50 bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
                  >
                    <option value="">请选择</option>
                    {products.map((product) => (
                      <option
                        key={`target-gap-product-${row.id}-${getTargetGapProductStableKey(product)}`}
                        value={getTargetGapProductStableKey(product)}
                        disabled={
                          getTargetGapProductStableKey(product) !== row.productKey &&
                          (selectedProductKeyCount[getTargetGapProductStableKey(product)] || 0) > 0
                        }
                      >
                        {formatProductName(product.product_name)}
                        {targetGapMode === 'subassembly' ? ` [${product.tier === 'head' ? '机头' : 'PCBA'}]` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <div className="w-full sm:w-32 flex-none">
                <label className="text-[13px] font-medium text-slate-700 mb-1.5 block truncate">演算目标 (台)</label>
                <input
                  type="number"
                  min={1}
                  value={row.targetUnits}
                  onChange={(e) => updateTargetRow(row.id, { targetUnits: e.target.value })}
                  onKeyDown={handleTargetUnitsKeyDown}
                  placeholder="0"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 shadow-sm focus:border-slate-500 focus:ring-1 focus:ring-slate-500 outline-none transition-all"
                />
              </div>
              <div className="flex-none pb-0">
                <button
                  type="button"
                  onClick={() => removeTargetRow(row.id)}
                  disabled={targetGapRows.length <= 1}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                    targetGapRows.length <= 1
                      ? 'text-slate-200 cursor-not-allowed'
                      : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 border hover:border-rose-200 border-transparent'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}

        {(hasDuplicateProduct || (totalModelLimit > 0 && targetGapRows.length >= totalModelLimit)) && (
          <div className="mt-2 px-1">
            {hasDuplicateProduct && (
              <p className="text-[11px] font-bold text-p-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> 存在重复{targetGapMode === 'finished' ? '成品机' : '子装配'}，请调整后再计算。
              </p>
            )}
            {!hasDuplicateProduct && hasReachedModelLimit && (
              <p className="text-[11px] font-bold text-slate-400">
                已达到上限：最多可添加 {totalModelLimit} 条（型号总数）。
              </p>
            )}
          </div>
        )}
      </div>

      {targetGapBatchResult && (
        <div className="px-6 pb-10 space-y-8 animate-fade-in border-t border-slate-100 pt-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 shadow-sm flex flex-col">
              <span className="text-[11px] font-semibold text-slate-400 mb-3">目标对象数</span>
              <span className="text-[28px] font-bold text-slate-900 leading-none">{targetGapBatchResult.summary.target_count}</span>
            </div>
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 shadow-sm flex flex-col">
              <span className="text-[11px] font-semibold text-slate-400 mb-3">目标总台数</span>
              <span className="text-[28px] font-bold text-slate-900 leading-none">{targetGapBatchResult.summary.target_units_total.toLocaleString()}</span>
            </div>
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 shadow-sm flex flex-col">
              <span className="text-[11px] font-semibold text-slate-400 mb-3">可满足台数</span>
              <span className="text-[28px] font-bold text-slate-900 leading-none">{targetGapBatchResult.summary.producible_units_total.toLocaleString()}</span>
            </div>
            <div className={`p-5 rounded-xl border shadow-sm flex flex-col ${targetGapBatchResult.summary.gap_units_total > 0 ? 'border-rose-100 bg-rose-50/40' : 'border-slate-200 bg-slate-50'}`}>
              <span className={`text-[11px] font-semibold mb-3 ${targetGapBatchResult.summary.gap_units_total > 0 ? 'text-rose-500' : 'text-slate-400'}`}>总缺台数</span>
              <span className={`text-[28px] font-bold leading-none ${targetGapBatchResult.summary.gap_units_total > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {targetGapBatchResult.summary.gap_units_total.toLocaleString()}
              </span>
            </div>
          </div>

          {targetGapBatchResult.summary.gap_units_total > 0 && (
            <div className="space-y-4">
              {targetGapBatchResult.rows.map((row) => {
                const expanded = !!expandedResultRows[row.row_id];
                return (
                  <div key={row.row_id} className="border border-slate-200 bg-white rounded-xl overflow-hidden shadow-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedResultRows((prev) => ({
                            ...prev,
                            [row.row_id]: !prev[row.row_id],
                          }))
                        }
                        className="w-full px-6 py-4 flex items-center gap-6 text-left hover:bg-slate-50 transition-all select-none"
                      >
                        <div className={`pmc-row-toggle ${expanded ? 'is-open' : ''}`}>
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-semibold text-slate-900 truncate">{formatProductName(row.product)}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5 font-medium">{displayLineName(row.line)}</div>
                        </div>
                        <div className="flex items-center gap-10">
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block mb-0.5 font-semibold">目标</span>
                            <span className="text-[16px] font-bold text-slate-900 tabular-nums">{row.target_units.toLocaleString()}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block mb-0.5 font-semibold">可满足</span>
                            <span className="text-[16px] font-bold text-slate-900 tabular-nums">{row.current_capacity.toLocaleString()}</span>
                          </div>
                          <div className="text-right min-w-[60px]">
                            <span className="text-[10px] text-slate-400 block mb-0.5 font-semibold">缺台</span>
                            <span className={`text-[16px] font-bold tabular-nums ${row.gap_units > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{row.gap_units.toLocaleString()}</span>
                          </div>
                        </div>
                      </button>
                      
                      {expanded && (
                        <div className="border-t border-slate-100 bg-slate-50/30 p-8">
                          {(() => {
                            const rowTree = buildTargetGapRowTree(row);
                            if (row.material_shortages.length === 0) {
                              return (
                                <div className="flex items-center gap-2 text-emerald-600 font-medium text-[13px]">
                                  <ShieldCheck className="w-4 h-4" />
                                  该机型物料充足，可百分之百达成目标。
                                </div>
                              );
                            }
                            return (
                              <div className="space-y-8">
                                {rowTree && (
                                <div>
                                  <h4 className="text-[13px] font-bold text-slate-700 mb-4">缺料明细</h4>
                                  <p className="text-[12px] text-slate-500 mb-4 leading-6">
                                    明细中的“当前库存”来自当前库存快照；若标注“已使用”，表示这部分库存已被本次全局演算中已可产的数量先使用，因此“缺口”按演算后的可用库存计算。
                                  </p>
                                  <TargetGapTree
                                    rowId={row.row_id}
                                    root={rowTree}
                                    expandedNodes={expandedTreeNodes}
                                    setExpandedNodes={setExpandedTreeNodes}
                                  />
                                </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                );
              })}

              <GlobalShortageTable
                rows={globalShortageEntries}
                open={showTargetGapActions}
                onToggle={() => setShowTargetGapActions((prev) => !prev)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TargetGapPanel;
