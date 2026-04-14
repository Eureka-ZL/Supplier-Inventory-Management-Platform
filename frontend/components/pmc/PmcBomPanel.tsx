import React from 'react';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import type { BomProduct } from './bomTypes';

interface SeriesSection {
  key: string;
  label: string;
  file: string;
  products: BomProduct[];
}

interface LineOption {
  key: string;
  label: string;
  count: number;
}

interface PmcBomPanelProps {
  bomLoading: boolean;
  lineOptions: LineOption[];
  selectedLine: string | null;
  onSelectLine: (line: string) => void;
  bomViewMode: 'finished' | 'all';
  onChangeBomViewMode: (mode: 'finished' | 'all') => void;
  seriesSection: SeriesSection | null;
  expandedSeries: string | null;
  onToggleSeries: (key: string) => void;
  normalProducts: BomProduct[];
  totalLineProducts: number;
  renderProductCard: (product: BomProduct, nested?: boolean) => React.ReactNode;
}

const PmcBomPanel = ({
  bomLoading,
  lineOptions,
  selectedLine,
  onSelectLine,
  bomViewMode,
  onChangeBomViewMode,
  seriesSection,
  expandedSeries,
  onToggleSeries,
  normalProducts,
  totalLineProducts,
  renderProductCard,
}: PmcBomPanelProps) => {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="m-panel p-6">
        <div className="pmc-section-toolbar">
          <div className="flex flex-col">
            <span className="text-label mb-2">当前产线</span>
            <div className="pmc-chip-group">
              {lineOptions.map((line) => (
                <button
                  key={line.key}
                  onClick={() => onSelectLine(line.key)}
                  className={`pmc-chip ${selectedLine === line.key ? 'active' : ''}`}
                >
                  {line.label}
                  <span className={`ml-2 text-[11px] ${selectedLine === line.key ? 'text-slate-300' : 'text-slate-400'}`}>
                    {line.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-label mb-2">显示方式</span>
            <div className="pmc-segmented">
              <button
                onClick={() => onChangeBomViewMode('finished')}
                className={`pmc-segmented-button ${bomViewMode === 'finished' ? 'active' : ''}`}
              >
                仅成品机
              </button>
              <button
                onClick={() => onChangeBomViewMode('all')}
                className={`pmc-segmented-button ${bomViewMode === 'all' ? 'active' : ''}`}
              >
                展开二级清单
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {bomLoading ? (
          <div className="pmc-empty-state">
            <RefreshIndicator />
            <p className="text-label">正在加载物料清单...</p>
          </div>
        ) : (
          <>
            {seriesSection && seriesSection.products.length > 0 && (
              <div className={`expandable-card transition-all duration-300 ${expandedSeries === seriesSection.key ? 'expanded' : ''}`}>
                <button
                  onClick={() => onToggleSeries(seriesSection.key)}
                  className={`w-full flex items-center justify-between px-6 py-5 transition-all text-left select-none ${
                    expandedSeries === seriesSection.key ? 'bg-slate-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`btn-icon-circle ${expandedSeries === seriesSection.key ? 'active' : ''}`}>
                      {expandedSeries === seriesSection.key ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-bold text-sm truncate text-slate-900">
                          {seriesSection.label}
                        </span>
                        <span className="status-tag indigo">小板系列</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-medium mt-1.5 flex items-center gap-2">
                        <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] font-bold text-slate-500">来源</span>
                        <span className="font-mono tracking-tight">{seriesSection.file}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 pr-2">
                    <div className="flex flex-col items-end">
                      <span className="text-label mb-1">机型数量</span>
                      <span className="text-value text-sm">{seriesSection.products.length}</span>
                    </div>
                  </div>
                </button>

                {expandedSeries === seriesSection.key && (
                  <div className="p-4 pt-0 space-y-4 border-t border-slate-100 bg-white">
                    {seriesSection.products.map((product) => renderProductCard(product, true))}
                  </div>
                )}
              </div>
            )}

            {normalProducts.map((product) => renderProductCard(product))}

            {totalLineProducts === 0 && (
              <div className="pmc-empty-state">
                <Package className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                <p className="text-label">当前视图下暂无匹配机型</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const RefreshIndicator = () => (
  <svg className="w-10 h-10 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path d="M22 12A10 10 0 0 0 12 2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export default PmcBomPanel;
