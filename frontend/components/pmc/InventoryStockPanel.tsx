import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Search, X, Check, LayoutList, Activity } from 'lucide-react';
import type { InventoryAdjustmentCycleSummary, InventoryAdjustmentEvent } from '../../services/api';
import { InventoryLedgerTable } from './inventoryStock/InventoryLedgerTable';
import { InventoryPivotTable } from './inventoryStock/InventoryPivotTable';
import { InventoryTraceModal } from './inventoryStock/InventoryTraceModal';
import type { InventoryItem, InventoryPivotRow, InventoryStockPanelProps } from './inventoryStock/types';
import {
  formatChangeType,
  formatDateTime,
  getActorDisplay,
  getEffectivePartNo,
  getItemCurrentQuantity,
  getOriginalEmailBody,
  getProductSortBucket,
  getSignedDelta,
  isProductOrSemifinished,
  normalizePartNo,
  resolveItemType,
} from './inventoryStock/utils';

export const InventoryStockPanel: React.FC<InventoryStockPanelProps> = ({
  inventory,
  adjustmentEvents = [],
  adjustmentSummary = null,
}) => {
  const [sortMode, setSortMode] = useState<'default' | 'good_desc' | 'good_asc' | 'bad_desc'>('default');
  const [viewMode, setViewMode] = useState<'ledger' | 'pivot'>('ledger');
  const [keyword, setKeyword] = useState('');
  const [showFinishedOnly, setShowFinishedOnly] = useState(false);
  const [selectedPartNo, setSelectedPartNo] = useState<string | null>(null);

  const handleGoodSort = () => {
    if (sortMode === 'good_desc') setSortMode('good_asc');
    else if (sortMode === 'good_asc') setSortMode('default');
    else setSortMode('good_desc');
  };

  const handleBadSort = () => {
    if (sortMode === 'bad_desc') setSortMode('default');
    else setSortMode('bad_desc');
  };

  const filteredItems = useMemo(() => {
    let result = inventory.items;
    if (showFinishedOnly) {
      result = result.filter((item) => isProductOrSemifinished(item));
    }
    const q = keyword.trim().toLowerCase();
    if (!q) return result;
    return result.filter((item) => {
      const partNo = String(item.part_no || '').toLowerCase();
      const rawPartNo = String(item.raw_part_no || '').toLowerCase();
      const description = String(item.description || '').toLowerCase();
      const category = String(item.category || '').toLowerCase();
      const warehouse = String(item.warehouse || '').toLowerCase();
      const quality = String(item.quality_class || '').toLowerCase();
      return partNo.includes(q) || rawPartNo.includes(q) || description.includes(q) || category.includes(q) || warehouse.includes(q) || quality.includes(q);
    });
  }, [inventory.items, keyword, showFinishedOnly]);

  const sortedItems = [...filteredItems].sort((a, b) => {
    const aGood = a.good_qty ?? a.quantity ?? 0;
    const bGood = b.good_qty ?? b.quantity ?? 0;
    const aBad = a.bad_qty ?? 0;
    const bBad = b.bad_qty ?? 0;

    if (showFinishedOnly && sortMode === 'default') {
      const aType = resolveItemType(a);
      const bType = resolveItemType(b);
      if (aType !== bType) {
        if (aType === 'finished_goods') return -1;
        if (bType === 'finished_goods') return 1;
      }

      const aBucket = getProductSortBucket(a);
      const bBucket = getProductSortBucket(b);
      if (aBucket.rank !== bBucket.rank) return aBucket.rank - bBucket.rank;

      const aDesc = String(a.description || '').toLowerCase();
      const bDesc = String(b.description || '').toLowerCase();
      if (aDesc !== bDesc) return aDesc.localeCompare(bDesc, 'zh-CN');

      return String(a.part_no || '').localeCompare(String(b.part_no || ''), 'zh-CN');
    }

    if (sortMode === 'good_desc') return bGood - aGood;
    if (sortMode === 'good_asc') return aGood - bGood;
    if (sortMode === 'bad_desc') return bBad - aBad;
    return 0; // default (server order)
  });

  const itemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    inventory.items.forEach((item) => {
      map.set(normalizePartNo(item.part_no), item);
    });
    return map;
  }, [inventory.items]);

  const summaryRowMap = useMemo(() => {
    const map = new Map<string, InventoryAdjustmentCycleSummary['rows'][number]>();
    adjustmentSummary?.rows.forEach((row) => {
      map.set(normalizePartNo(row.part_no), row);
    });
    return map;
  }, [adjustmentSummary]);

  const confirmedEventsByPart = useMemo(() => {
    const map = new Map<string, InventoryAdjustmentEvent[]>();
    adjustmentEvents
      .filter((event) => event.status === 'applied')
      .forEach((event) => {
        const partNo = getEffectivePartNo(event);
        if (!partNo) return;
        const current = map.get(partNo) || [];
        current.push(event);
        map.set(partNo, current);
      });

    map.forEach((events, key) => {
      events.sort((a, b) => {
        const aTime = new Date(a.applied_at || a.updated_at || a.created_at).getTime();
        const bTime = new Date(b.applied_at || b.updated_at || b.created_at).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return a.id - b.id;
      });
      map.set(key, events);
    });

    return map;
  }, [adjustmentEvents]);

  const selectedItem = selectedPartNo ? itemMap.get(selectedPartNo) || null : null;
  const selectedSummaryRow = selectedPartNo ? summaryRowMap.get(selectedPartNo) || null : null;
  const selectedEvents = selectedPartNo ? confirmedEventsByPart.get(selectedPartNo) || [] : [];

  const pivotData = useMemo(() => {
    if (viewMode !== 'pivot') return [];
    const data: InventoryPivotRow[] = [];

    confirmedEventsByPart.forEach((events, partNo) => {
      if (events.length === 0) return;
      const itemInfo = itemMap.get(partNo);
      const summaryRow = summaryRowMap.get(partNo);
      
      if (showFinishedOnly && (!itemInfo || !isProductOrSemifinished(itemInfo))) return;
      
      const q = keyword.trim().toLowerCase();
      let matchSearch = true;
      if (q) {
        const p = partNo.toLowerCase();
        const rawP = String(itemInfo?.raw_part_no || '').toLowerCase();
        const desc = String(itemInfo?.description || '').toLowerCase();
        if (!p.includes(q) && !rawP.includes(q) && !desc.includes(q)) matchSearch = false;
      }
      if (!matchSearch) return;

      let netChange = 0;
      let outboundCount = 0;
      let inboundCount = 0;
      let scrapCount = 0;
      const actorCounts = new Map<string, number>();

      events.forEach(ev => {
        const delta = getSignedDelta(ev);
        netChange += delta;
        if (ev.change_type === 'outbound') outboundCount++;
        else if (ev.change_type === 'inbound') inboundCount++;
        else if (ev.change_type === 'scrap') scrapCount++;
        
        const actor = getActorDisplay(ev);
        actorCounts.set(actor, (actorCounts.get(actor) || 0) + 1);
      });

      const topActor = [...actorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

      const currentTotal = summaryRow
        ? Number(summaryRow.current_quantity || 0)
        : itemInfo
          ? ((itemInfo.good_qty ?? itemInfo.quantity ?? 0) + (itemInfo.bad_qty ?? 0))
          : 0;
      const originalTotal = summaryRow
        ? Number(summaryRow.base_quantity || 0)
        : currentTotal - netChange;

      data.push({
        partNo,
        description: itemInfo?.description || '-',
        category: itemInfo?.category,
        frequency: events.length,
        netChange,
        currentTotal,
        originalTotal,
        outboundCount,
        inboundCount,
        scrapCount,
        topActor
      });
    });

    data.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return Math.abs(b.netChange) - Math.abs(a.netChange);
    });

    return data;
  }, [viewMode, confirmedEventsByPart, itemMap, keyword, showFinishedOnly, summaryRowMap]);

  const selectedTrace = useMemo(() => {
    if (!selectedItem || !selectedPartNo) return null;

    const baseQuantity = selectedSummaryRow
      ? Number(selectedSummaryRow.base_quantity || 0)
      : getItemCurrentQuantity(selectedItem);
    const currentQuantity = selectedSummaryRow
      ? Number(selectedSummaryRow.current_quantity || 0)
      : getItemCurrentQuantity(selectedItem);
    let runningQuantity = baseQuantity;

    const steps = selectedEvents.map((event) => {
      const beforeQuantity = runningQuantity;
      const delta = getSignedDelta(event);
      const afterQuantity = beforeQuantity + delta;
      runningQuantity = afterQuantity;
      return {
        id: event.id,
        beforeQuantity,
        afterQuantity,
        delta,
        actor: getActorDisplay(event),
        originalEmailBody: getOriginalEmailBody(event),
        applyNote: event.apply_note?.trim() || '',
        changeLabel: formatChangeType(event.change_type),
        timestamp: formatDateTime(event.applied_at || event.updated_at || event.created_at),
        sender: event.sender || '未知发件人',
      };
    });
    const emailNetChange = selectedSummaryRow
      ? Number(selectedSummaryRow.net_change || 0)
      : steps.reduce((sum, step) => sum + step.delta, 0);
    const projectedQuantity = selectedSummaryRow
      ? Number(selectedSummaryRow.projected_quantity || baseQuantity + emailNetChange)
      : baseQuantity + emailNetChange;
    const variance = selectedSummaryRow
      ? Number(selectedSummaryRow.variance || 0)
      : currentQuantity - projectedQuantity;

    return {
      currentQuantity,
      baseQuantity,
      emailNetChange,
      projectedQuantity,
      variance,
      steps,
      baseTimestamp: formatDateTime(adjustmentSummary?.base_record?.parsed_at),
      latestTimestamp: formatDateTime(adjustmentSummary?.latest_record?.parsed_at),
    };
  }, [selectedItem, selectedPartNo, selectedSummaryRow, selectedEvents, adjustmentSummary]);

  useEffect(() => {
    if (!selectedPartNo) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPartNo(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPartNo]);

  return (
    <>
    <div className="m-panel animate-fade-in shadow-sm">
      {/* Header Area */}
      <div className="m-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border-b border-slate-100">
        <div className="flex flex-col">
          <h2 className="m-title text-slate-900">库存明细台账</h2>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="relative flex p-1 bg-slate-100 rounded-lg border border-slate-200/80 flex-none isolate">
            {/* Animated Slider Background */}
            <div 
              className={`absolute inset-y-1 w-[calc(50%-4px)] bg-white rounded-md shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] -z-10 ${
                viewMode === 'ledger' ? 'left-1' : 'left-[calc(50%+2px)]'
              }`}
            />
            <button
              onClick={() => setViewMode('ledger')}
              className={`px-3 py-1.5 w-[100px] rounded-md text-[13px] font-bold transition-colors flex justify-center items-center gap-1.5 relative ${
                viewMode === 'ledger' ? 'text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              明细台账
            </button>
            <button
              onClick={() => setViewMode('pivot')}
              className={`px-3 py-1.5 w-[100px] rounded-md text-[13px] font-bold transition-colors flex justify-center items-center gap-1.5 relative ${
                viewMode === 'pivot' ? 'text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              库存变动
            </button>
          </div>

          {/* Search */}
          <div className="relative w-full md:w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索编码、描述、类别、仓别..."
              className="m-input w-full pl-10 h-10"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex p-1 bg-slate-100 rounded-lg border border-slate-200/80 overflow-x-auto">
            <button
              onClick={() => setShowFinishedOnly(!showFinishedOnly)}
              className={`px-4 py-1.5 rounded-md text-[13px] font-bold transition-all flex flex-none items-center mr-2 gap-1.5 ${
                showFinishedOnly ? 'bg-white text-slate-900 border border-slate-200 shadow-sm' : 'text-slate-500 hover:text-slate-700 border border-transparent'
              }`}
            >
              <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                showFinishedOnly ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-300'
              }`}>
                {showFinishedOnly && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
              </div>
              半成品与成品机
            </button>
            <div className={`w-px h-5 mt-1.5 bg-slate-200 mr-2 flex-none transition-opacity duration-300 ${viewMode === 'pivot' ? 'opacity-30' : ''}`}></div>
            <button
              onClick={handleGoodSort}
              disabled={viewMode === 'pivot'}
              className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all duration-300 flex flex-none items-center ${
                viewMode === 'pivot' ? 'opacity-30 cursor-not-allowed grayscale' :
                sortMode.startsWith('good') ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span>良品库存</span>
              <span className="w-4 h-4 ml-1.5 flex items-center justify-center shrink-0">
                {sortMode === 'good_desc' && <ArrowDownNarrowWide className="w-3.5 h-3.5 text-slate-600 animate-in fade-in" />}
                {sortMode === 'good_asc' && <ArrowUpNarrowWide className="w-3.5 h-3.5 text-slate-600 animate-in fade-in" />}
              </span>
            </button>
            <button
              onClick={handleBadSort}
              disabled={viewMode === 'pivot'}
              className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all duration-300 flex items-center ${
                viewMode === 'pivot' ? 'opacity-30 cursor-not-allowed grayscale' :
                sortMode === 'bad_desc' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span>不良库存</span>
              <span className="w-4 h-4 ml-1.5 flex items-center justify-center shrink-0">
                {sortMode === 'bad_desc' && <ArrowDownNarrowWide className="w-3.5 h-3.5 text-rose-500 animate-in fade-in" />}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto min-h-[600px] transition-all duration-300">
        {viewMode === 'ledger' ? (
          <InventoryLedgerTable
            items={sortedItems}
            appliedEventsByPart={confirmedEventsByPart}
            onSelectPart={setSelectedPartNo}
          />
        ) : (
          <InventoryPivotTable
            rows={pivotData}
            itemMap={itemMap}
            onSelectPart={setSelectedPartNo}
          />
        )}
      </div>
    </div>
    <InventoryTraceModal
      item={selectedItem}
      trace={selectedTrace}
      onClose={() => setSelectedPartNo(null)}
    />
    </>
  );
};

export default InventoryStockPanel;
