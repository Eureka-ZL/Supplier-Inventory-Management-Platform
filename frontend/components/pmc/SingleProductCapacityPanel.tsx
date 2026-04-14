import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import CapacityPartsTable from './CapacityPartsTable';

interface SmallBoardSeriesConfig {
  file: string;
  label: string;
}

interface CapacityProduct {
  product: string;
  line?: string;
  source_file?: string;
  capacity: number;
  bottleneck: string;
  parts: {
    part_no: string;
    name?: string;
    spec?: string;
    manufacturer?: string;
    required_qty: number;
    available_qty: number;
    can_produce: number;
    is_bottleneck: boolean;
    part_type?: 'fixed' | 'alternative';
    alt_group?: string;
    is_selected_option?: boolean;
  }[];
}

interface SingleProductCapacityPanelProps {
  capacityByLine: Record<string, CapacityProduct[]>;
  capacityLines: string[];
  displayLineName: (line?: string) => string;
  normalizeLineKey: (line?: string) => string;
  smallBoardSeriesConfig: Record<string, SmallBoardSeriesConfig>;
}

const formatProductName = (name: string) => {
  if (!name) return name;
  let formatted = name.replace(/（/g, '(').replace(/）/g, ')');
  formatted = formatted.replace(/([^\s])\(/g, '$1 (');
  formatted = formatted.replace(/\)\(/g, ') (');
  formatted = formatted.replace(/\s{2,}/g, ' ');
  return formatted.trim();
};

export const SingleProductCapacityPanel: React.FC<SingleProductCapacityPanelProps> = ({
  capacityByLine,
  capacityLines,
  displayLineName,
  normalizeLineKey,
  smallBoardSeriesConfig,
}) => {
  const [selectedCapacityLine, setSelectedCapacityLine] = useState<string | null>(null);
  const [expandedCapacityProduct, setExpandedCapacityProduct] = useState<string | null>(null);
  const [expandedCapacitySeries, setExpandedCapacitySeries] = useState<string | null>(null);
  const orderedCapacityLines = [...capacityLines].sort((a, b) => {
    const priorityMap: Record<string, number> = {
      king: 0,
      kiev2025: 1,
      kiev: 2,
    };
    const aPriority = priorityMap[normalizeLineKey(a)] ?? 99;
    const bPriority = priorityMap[normalizeLineKey(b)] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.localeCompare(b, 'zh-CN');
  });

  useEffect(() => {
    if (orderedCapacityLines.length === 0) {
      if (selectedCapacityLine !== null) setSelectedCapacityLine(null);
      return;
    }
    if (!selectedCapacityLine || !capacityByLine[selectedCapacityLine]) {
      setSelectedCapacityLine(orderedCapacityLines[0]);
    }
  }, [orderedCapacityLines.join('|'), selectedCapacityLine, capacityByLine]);

  const renderCapacityProductCard = (product: CapacityProduct, idx: number, nested = false) => {
    const productKey = `${product.line || '未分类'}::${product.source_file || ''}::${product.product}::${idx}`;
    const expanded = expandedCapacityProduct === productKey;

    return (
      <div
        key={productKey}
        className={`border border-slate-200 bg-white rounded-xl overflow-hidden mb-3 hover:border-slate-300 transition-all ${nested ? 'shadow-none !border-slate-100' : 'shadow-sm'}`}
      >
        <button
          onClick={() => setExpandedCapacityProduct(expanded ? null : productKey)}
          className={`w-full flex items-center justify-between px-6 py-4 transition-all text-left select-none ${
            expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70'
          }`}
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className={`pmc-row-toggle ${expanded ? 'is-open' : ''}`}>
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold truncate text-slate-900">{formatProductName(product.product)}</div>
            </div>
          </div>
          <div className="flex items-center gap-6 pr-2">
            <div className="text-right">
              <span className="text-label block mb-0.5">可支持台数</span>
              <span className={`text-[18px] tabular-nums ${product.capacity === 0 ? 'text-rose-600 font-black' : 'font-bold text-slate-900'}`}>
                {product.capacity.toLocaleString()}
              </span>
            </div>
          </div>
        </button>

        {expanded && (
          <div className="bg-white border-t border-slate-100 animate-fade-in">
            <CapacityPartsTable product={product} keyPrefix={productKey} sortMode="can_produce_asc" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="m-panel animate-fade-in mb-8">
      <div className="m-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border-b border-slate-100">
        <div className="flex flex-col">
          <h3 className="m-title text-slate-900">单产品产能明细</h3>
        </div>
        
        <nav className="m-tabs">
          {orderedCapacityLines.map((line) => (
            <button
              key={`capacity-line-${line}`}
              onClick={() => {
                setSelectedCapacityLine(line);
                setExpandedCapacityProduct(null);
                setExpandedCapacitySeries(null);
              }}
              className={`m-tab-item ${selectedCapacityLine === line ? 'active' : ''}`}
            >
              <span>{displayLineName(line)}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="p-6">
        {selectedCapacityLine && (() => {
          const lineProducts = capacityByLine[selectedCapacityLine] || [];
          const lineKey = normalizeLineKey(selectedCapacityLine);
          const seriesConfig = smallBoardSeriesConfig[lineKey];
          const smallBoardProducts = seriesConfig
            ? lineProducts.filter((p) => (p.source_file || '') === seriesConfig.file)
            : [];
          const normalProducts = seriesConfig
            ? lineProducts.filter((p) => (p.source_file || '') !== seriesConfig.file)
            : lineProducts;
          const seriesExpandKey = `${lineKey}-capacity-small-board-series`;

          return (
            <>
              {smallBoardProducts.length > 0 && (
                <div className={`border border-slate-200 bg-white rounded-xl overflow-hidden mb-4 shadow-sm ${
                  expandedCapacitySeries === seriesExpandKey ? 'border-slate-300 shadow-md' : ''
                }`}>
                  <button
                    onClick={() => setExpandedCapacitySeries(expandedCapacitySeries === seriesExpandKey ? null : seriesExpandKey)}
                    className={`w-full flex items-center justify-between px-6 py-5 transition-all text-left select-none ${
                      expandedCapacitySeries === seriesExpandKey ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`pmc-row-toggle ${expandedCapacitySeries === seriesExpandKey ? 'is-open' : ''}`}>
                        {expandedCapacitySeries === seriesExpandKey ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-bold text-[16px] truncate text-slate-900">
                            {seriesConfig?.label || '小板系列'}
                          </span>
                          <span className="m-badge-blue">小板系列</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 font-medium">
                          来源文件：{seriesConfig?.file}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-label block mb-0.5">机型数</span>
                      <span className="text-[18px] font-bold text-slate-900 tabular-nums">{smallBoardProducts.length}</span>
                    </div>
                  </button>

                  {expandedCapacitySeries === seriesExpandKey && (
                    <div className="px-6 py-4 space-y-2 bg-slate-50/50 border-t border-slate-100 animate-fade-in">
                      {smallBoardProducts.map((product, idx) => renderCapacityProductCard(product, idx, true))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {normalProducts.map((product, idx) => renderCapacityProductCard(product, idx + smallBoardProducts.length))}
              </div>

              {lineProducts.length === 0 && (
                <div className="pmc-empty-state mt-4">
                  <Package className="w-10 h-10 text-slate-200 mx-auto mb-4" strokeWidth={1} />
                  <p className="text-[13px] font-medium text-slate-400">暂无产能模拟数据</p>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default SingleProductCapacityPanel;
