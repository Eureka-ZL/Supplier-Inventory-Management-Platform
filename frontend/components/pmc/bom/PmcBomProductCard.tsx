import React from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Save, Trash2, X } from 'lucide-react';

import type { BomPart, BomProduct } from '../bomTypes';

interface PmcBomProductCardProps {
  product: BomProduct;
  nested?: boolean;
  visitedCodes?: Set<string>;
  formatProductName: (name: string) => string;
  getBomTierLabel: (code?: string) => string;
  getChildBomProducts: (product: BomProduct) => BomProduct[];
  expandedProductMap: Record<string, boolean>;
  setExpandedProductMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingProductKey: string | null;
  editingParts: BomPart[];
  selectedAltRows: Set<number>;
  savingBom: boolean;
  onStartEditBom: (product: BomProduct) => void;
  onCancelEditBom: () => void;
  onUpdateEditingPart: (index: number, patch: Partial<BomPart>) => void;
  onAddEditingPart: () => void;
  onRemoveEditingPart: (index: number) => void;
  onToggleAltRowSelection: (index: number, checked: boolean) => void;
  onApplySelectedAsAltGroup: () => void;
  onClearSelectedAltGroup: () => void;
  onSaveBomParts: (product: BomProduct) => Promise<void>;
}

export const PmcBomProductCard: React.FC<PmcBomProductCardProps> = ({
  product,
  nested = false,
  visitedCodes,
  formatProductName,
  getBomTierLabel,
  getChildBomProducts,
  expandedProductMap,
  setExpandedProductMap,
  editingProductKey,
  editingParts,
  selectedAltRows,
  savingBom,
  onStartEditBom,
  onCancelEditBom,
  onUpdateEditingPart,
  onAddEditingPart,
  onRemoveEditingPart,
  onToggleAltRowSelection,
  onApplySelectedAsAltGroup,
  onClearSelectedAltGroup,
  onSaveBomParts,
}) => {
  const toggleKey = `${product.file}-${product.product_code || product.product_name}`;
  const isExpanded = !!expandedProductMap[toggleKey];
  const isEditing = editingProductKey === toggleKey;
  const code = (product.product_code || '').trim();
  const tierLabel = getBomTierLabel(code);
  const visited = new Set(visitedCodes || []);
  if (code) visited.add(code);
  const childProducts = getChildBomProducts(product).filter((child) => {
    const childCode = (child.product_code || '').trim();
    return !childCode || !visited.has(childCode);
  });
  const canClearAltGroup = isEditing && Array.from(selectedAltRows as Set<number>).some((idx: number) => {
    const row = editingParts[idx];
    return !!row && row.alt_group !== null && row.alt_group !== undefined;
  });

  return (
    <div
      className={`expandable-card transition-all duration-300 ${
        nested ? 'mx-0 my-2 shadow-sm' : ''
      } ${isExpanded ? 'expanded' : ''}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() =>
          setExpandedProductMap((prev) => ({
            ...prev,
            [toggleKey]: !prev[toggleKey],
          }))
        }
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          setExpandedProductMap((prev) => ({
            ...prev,
            [toggleKey]: !prev[toggleKey],
          }));
        }}
        className={`w-full flex items-center justify-between px-6 py-5 transition-all text-left select-none ${
          isExpanded ? 'bg-slate-50' : ''
        }`}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className={`btn-icon-circle ${isExpanded ? 'active' : ''}`}>
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-bold text-sm truncate text-slate-900">{formatProductName(product.product_name)}</span>
              <span className="status-tag slate">{tierLabel}</span>
            </div>
            {product.product_code && (
              <div className="text-[11px] text-slate-400 font-medium mt-1.5 flex items-center gap-2">
                <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-bold text-slate-500">料号</span>
                <span className="font-mono tracking-tight">{product.product_code}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6 pr-2">
          {isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isEditing) onCancelEditBom();
                else onStartEditBom(product);
              }}
              className={`h-8 px-3 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                isEditing
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
              disabled={!product.product_code || savingBom}
              title={!product.product_code ? '缺少产品料号，无法编辑' : '编辑物料清单条目'}
            >
              <Pencil className="w-3.5 h-3.5" />
              {isEditing ? '编辑中' : '编辑'}
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-label">物料数</span>
            <span className="text-value text-sm">{product.total_parts}</span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-100 bg-white">
          {isEditing && (
            <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="text-[11px] font-bold text-slate-600 tracking-wide flex items-center gap-3">
                <span>清单编辑中</span>
                <span className="text-[10px] text-slate-400">勾选两条及以上物料后，可一键设为互替</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onApplySelectedAsAltGroup();
                  }}
                  className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-60"
                  disabled={savingBom || selectedAltRows.size < 2}
                >
                  设为互替
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearSelectedAltGroup();
                  }}
                  className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-60"
                  disabled={savingBom || !canClearAltGroup}
                >
                  取消互替
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelEditBom();
                  }}
                  className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-bold flex items-center gap-1.5 hover:border-slate-300"
                  disabled={savingBom}
                >
                  <X className="w-3.5 h-3.5" />
                  取消
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void onSaveBomParts(product);
                  }}
                  className="h-8 px-3 rounded-lg border border-slate-900 bg-slate-900 text-white text-[11px] font-bold flex items-center gap-1.5 hover:bg-slate-800 disabled:opacity-60"
                  disabled={savingBom}
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingBom ? '保存中...' : '保存清单'}
                </button>
              </div>
            </div>
          )}
          <div className="pmc-table-wrap">
            <table className="m-table">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: isEditing ? '20%' : '22%' }} />
                <col style={{ width: isEditing ? '20%' : '24%' }} />
                <col style={{ width: isEditing ? '23%' : '30%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: isEditing ? '12%' : '11%' }} />
                {isEditing && <col style={{ width: '6%' }} />}
                {isEditing && <col style={{ width: '6%' }} />}
              </colgroup>
              <thead>
                <tr>
                  <th className="text-center w-12">#</th>
                  <th>物料编码</th>
                  <th>物料名称</th>
                  <th>规格描述</th>
                  <th className="text-right">用量</th>
                  <th>厂家</th>
                  {isEditing && <th className="text-center w-20">选择</th>}
                  {isEditing && <th className="text-center w-16">操作</th>}
                </tr>
              </thead>
              {isEditing ? (
                <tbody className="divide-y divide-slate-100/50">
                  {editingParts.map((part, i) => (
                    <tr key={`editing-part-${toggleKey}-${i}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-2 text-center text-slate-400 font-bold">{i + 1}</td>
                      <td className="px-6 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={part.part_no}
                            onChange={(e) => onUpdateEditingPart(i, { part_no: e.target.value.replace(/\D+/g, '') })}
                            className="w-full h-9 rounded-lg border border-slate-200 px-3 text-[13px] font-mono font-bold text-slate-900 focus:outline-none focus:border-slate-400"
                            placeholder="物料编码（纯数字）"
                            inputMode="numeric"
                          />
                          {part.alt_group ? (
                            <span className="inline-flex h-7 px-2 items-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 text-[11px] font-bold whitespace-nowrap">
                              互替组 {part.alt_group}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-2">
                        <input
                          type="text"
                          value={part.name}
                          onChange={(e) => onUpdateEditingPart(i, { name: e.target.value })}
                          className="w-full h-9 rounded-lg border border-slate-200 px-3 text-[13px] font-bold text-slate-800 focus:outline-none focus:border-slate-400"
                          placeholder="物料名称"
                        />
                      </td>
                      <td className="px-6 py-2">
                        <input
                          type="text"
                          value={part.spec}
                          onChange={(e) => onUpdateEditingPart(i, { spec: e.target.value })}
                          className="w-full h-9 rounded-lg border border-slate-200 px-3 text-[12px] text-slate-600 focus:outline-none focus:border-slate-400"
                          placeholder="规格描述"
                        />
                      </td>
                      <td className="px-6 py-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={Number.isFinite(part.qty) ? part.qty : 0}
                          onChange={(e) => {
                            const raw = e.target.value;
                            onUpdateEditingPart(i, { qty: raw === '' ? 0 : Number(raw) });
                          }}
                          className="w-full h-9 rounded-lg border border-slate-200 px-3 text-[13px] text-right font-bold text-slate-900 focus:outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-6 py-2">
                        <input
                          type="text"
                          value={part.manufacturer}
                          onChange={(e) => onUpdateEditingPart(i, { manufacturer: e.target.value })}
                          className="w-full h-9 rounded-lg border border-slate-200 px-3 text-[12px] text-slate-500 focus:outline-none focus:border-slate-400"
                          placeholder="厂家"
                        />
                      </td>
                      <td className="px-6 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedAltRows.has(i)}
                          onChange={(e) => onToggleAltRowSelection(i, e.target.checked)}
                          className="h-4 w-4 accent-slate-900 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveEditingPart(i);
                          }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-500 hover:bg-rose-50"
                          title="删除条目"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : (
                <tbody className="divide-y divide-slate-100/50">
                  {product.parts.map((part, i) => {
                    const isAlt = part.alt_group !== null && part.alt_group !== undefined;
                    const isFirstInGroup = isAlt && (i === 0 || product.parts[i - 1]?.alt_group !== part.alt_group);
                    let count = 0;
                    for (let j = 0; j <= i; j++) {
                      const p = product.parts[j];
                      const pIsAlt = p.alt_group !== null && p.alt_group !== undefined;
                      const pIsFirstInGroup = pIsAlt && (j === 0 || product.parts[j - 1]?.alt_group !== p.alt_group);
                      if (!pIsAlt || pIsFirstInGroup) count++;
                    }
                    const displayNum = count;
                    let groupSize = 1;
                    if (isFirstInGroup || (!isAlt && part.alt_group === null)) {
                      if (isAlt) groupSize = product.parts.filter((p) => p.alt_group === part.alt_group).length;
                    }
                    return (
                      <tr key={`${part.part_no}-${i}`} className={`transition-colors group ${isAlt ? 'bg-slate-50' : 'hover:bg-slate-50/50'}`}>
                        {(!isAlt || isFirstInGroup) && (
                          <td className="px-6 py-3 text-center text-slate-400 font-bold" rowSpan={groupSize > 1 ? groupSize : undefined}>
                            {displayNum}
                          </td>
                        )}
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-900 font-bold font-mono text-[13px] tracking-tight cell-truncate" title={part.part_no}>{part.part_no}</span>
                            {isAlt && (
                              <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-widest">
                                互替
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-slate-800 font-bold text-[13px]" title={part.name || '-'}>
                          <span className="cell-truncate">{part.name || '-'}</span>
                        </td>
                        <td className="px-6 py-3 text-slate-500 text-[12px]" title={part.spec || '-'}>
                          <span className="cell-truncate">{part.spec || '-'}</span>
                        </td>
                        {(!isAlt || isFirstInGroup) && (
                          <td className="px-6 py-3 text-right font-bold text-slate-900 text-sm" rowSpan={groupSize > 1 ? groupSize : undefined}>
                            {part.qty}
                          </td>
                        )}
                        <td className="px-6 py-3 text-slate-400 font-bold italic text-[11px]" title={part.manufacturer || '-'}>
                          <span className="cell-truncate">{part.manufacturer || '-'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
          {isEditing && (
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddEditingPart();
                }}
                className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] font-bold flex items-center gap-1.5 hover:bg-slate-50"
              >
                <Plus className="w-3.5 h-3.5" />
                新增条目
              </button>
            </div>
          )}
          {!isEditing && childProducts.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/30 p-4">
              <div className="px-4 py-3 mb-2 text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-900"></div>
                子总成层级
              </div>
              <div className="space-y-3">
                {childProducts.map((child) => (
                  <PmcBomProductCard
                    key={`${child.file}-${child.product_code || child.product_name}`}
                    product={child}
                    nested
                    visitedCodes={visited}
                    formatProductName={formatProductName}
                    getBomTierLabel={getBomTierLabel}
                    getChildBomProducts={getChildBomProducts}
                    expandedProductMap={expandedProductMap}
                    setExpandedProductMap={setExpandedProductMap}
                    editingProductKey={editingProductKey}
                    editingParts={editingParts}
                    selectedAltRows={selectedAltRows}
                    savingBom={savingBom}
                    onStartEditBom={onStartEditBom}
                    onCancelEditBom={onCancelEditBom}
                    onUpdateEditingPart={onUpdateEditingPart}
                    onAddEditingPart={onAddEditingPart}
                    onRemoveEditingPart={onRemoveEditingPart}
                    onToggleAltRowSelection={onToggleAltRowSelection}
                    onApplySelectedAsAltGroup={onApplySelectedAsAltGroup}
                    onClearSelectedAltGroup={onClearSelectedAltGroup}
                    onSaveBomParts={onSaveBomParts}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
