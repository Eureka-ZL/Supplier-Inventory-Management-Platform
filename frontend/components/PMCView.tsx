import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Upload, Archive, CheckCircle2 } from 'lucide-react';
import { getAuthToken } from '../services/api';
import TargetGapPanel from './pmc/TargetGapPanel';
import InventoryStockPanel from './pmc/InventoryStockPanel';
import SingleProductCapacityPanel from './pmc/SingleProductCapacityPanel';
import PmcHistoryPanel from './pmc/PmcHistoryPanel';
import PmcBomPanel from './pmc/PmcBomPanel';
import type { BomProduct } from './pmc/bomTypes';
import { PmcBomProductCard } from './pmc/bom/PmcBomProductCard';
import PmcHeaderBar from './pmc/PmcHeaderBar';
import PmcSyncNotice from './pmc/PmcSyncNotice';
import PmcConfirmDialog from './pmc/PmcConfirmDialog';
import PmcInventoryAdjustmentPanel from './pmc/PmcInventoryAdjustmentPanel';
import { usePmcInventoryAdjustments } from './pmc/hooks/usePmcInventoryAdjustments';
import { usePmcBomEditor } from './pmc/hooks/usePmcBomEditor';
import { usePmcHistory } from './pmc/hooks/usePmcHistory';
import { usePmcInventoryData } from './pmc/hooks/usePmcInventoryData';
import { usePmcTargetGap } from './pmc/hooks/usePmcTargetGap';
import type { BomStatus, CapacityProduct, InventoryRecord, ManualSyncResult, UploadResult } from './pmc/types';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';
const SMALL_BOARD_SERIES_CONFIG: Record<string, { file: string; label: string }> = {
  kiev: {
    file: 'Kiev_小板系列_PCBA_V2.0A(120200000156)-20231220.xlsx',
    label: 'Kiev 小板系列',
  },
  kiev2025: {
    file: 'Kiev2025小板系列V2.0B_PCBA_BOM-120200000232_20251107.xlsx',
    label: 'Kiev2025 小板系列',
  },
  king: {
    file: 'King_小板系列V2.0A_BOM_120200000209-20250610.xlsx',
    label: 'King 小板系列',
  },
};
const REMOVED_PRODUCT_CODES = new Set(['110100000344']);
const REMOVED_PRODUCT_NAME_KEYWORDS = ['海外版-欧洲'];
const LINE_LABELS: Record<string, string> = {
  king: 'King 系列（MS20A15）',
  kiev2025: 'Kiev 2025 系列（MS2405）',
  kiev: 'Kiev 系列（MS1901）',
};

interface PMCViewProps {
  currentUser: string;
}

const isFinishedBomProduct = (product: BomProduct) => {
  const code = (product.product_code || '').trim();
  return code.startsWith('1101');
};
const getBomTierLabel = (code?: string) => {
  const value = (code || '').trim();
  if (value.startsWith('1101')) return '成品机';
  if (value.startsWith('1201')) return '机头';
  if (value.startsWith('1202')) return 'PCBA';
  return '组件';
};

const formatProductName = (name: string) => {
  if (!name) return name;
  let formatted = name.replace(/（/g, '(').replace(/）/g, ')');
  formatted = formatted.replace(/([^\s])\(/g, '$1 (');
  formatted = formatted.replace(/\)\(/g, ') (');
  formatted = formatted.replace(/\s{2,}/g, ' ');
  return formatted.trim();
};

const isRemovedProductLike = (product: {
  product_code?: string;
  product_name?: string;
  source_file?: string;
  file?: string;
  product?: string;
}) => {
  const code = (product.product_code || '').trim();
  const name = (product.product_name || product.product || '').trim();
  const sourceFile = (product.source_file || product.file || '').trim();
  if (REMOVED_PRODUCT_CODES.has(code)) return true;
  return REMOVED_PRODUCT_NAME_KEYWORDS.some((keyword) => name.includes(keyword) || sourceFile.includes(keyword));
};

export const PMCView: React.FC<PMCViewProps> = ({ currentUser: _currentUser }) => {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [gmailRevokeConfirmOpen, setGmailRevokeConfirmOpen] = useState(false);
  const [expandedProductMap, setExpandedProductMap] = useState<Record<string, boolean>>({});
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'bom' | 'inventory' | 'stock' | 'adjustments' | 'history'>('bom');
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [bomViewMode, setBomViewMode] = useState<'finished' | 'all'>('finished');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resetTargetGapStateRef = useRef<(() => void) | null>(null);

  const {
    historyEvents,
    historyGroupExpanded,
    setHistoryGroupExpanded,
    expandedHistoryEvents,
    setExpandedHistoryEvents,
    expandedHistoryPathNodes,
    setExpandedHistoryPathNodes,
    deletingHistoryEventId,
    permanentlyDeletingHistoryEventId,
    restoringHistoryEventId,
    historyShowDeleted,
    setHistoryShowDeleted,
    historyManageMode,
    setHistoryManageMode,
    selectedHistoryEventIds,
    setSelectedHistoryEventIds,
    historyBatchDeleting,
    historyBatchPermanentDeleting,
    historyBatchRestoring,
    historyCleaning,
    historyConfirmAction,
    setHistoryConfirmAction,
    historyActiveCount,
    historyArchivedCount,
    historyKeyword,
    setHistoryKeyword,
    historyDateFrom,
    setHistoryDateFrom,
    historyDateTo,
    setHistoryDateTo,
    fetchHistoryEvents,
    deleteHistoryEvent,
    toggleHistoryEventSelected,
    deleteSelectedHistoryEvents,
    requestPermanentDeleteHistoryEvent,
    requestPermanentDeleteSelectedHistoryEvents,
    restoreHistoryEvent,
    restoreSelectedHistoryEvents,
    cleanupHistoryEvents,
    confirmHistoryAction,
  } = usePmcHistory({ setError });

  const normalizeLineKey = (line?: string) => (line || '未分类').trim().toLowerCase();
  const displayLineName = (line?: string) => {
    const normalized = normalizeLineKey(line);
    return LINE_LABELS[normalized] || `${(line || '未分类').toUpperCase()}产线`;
  };
  const lineRank = (line: string) => {
    const normalized = normalizeLineKey(line);
    if (normalized === 'king') return 1;
    if (normalized === 'kiev2025') return 2;
    if (normalized === 'kiev') return 3;
    return 999;
  };

  const {
    records,
    syncing,
    revokingGmail,
    gmailAuthorized,
    uploading,
    uploadResult,
    manualSyncResult,
    manualSyncNoticeDismissed,
    setManualSyncNoticeDismissed,
    bomProducts,
    bomStatus,
    bomLoading,
    latestSyncSummary,
    bomStatusSummary,
    fetchBomList,
    fetchBomStatus,
    fetchRecords,
    loadUploadResultByRecordId,
    loadLatestUploadResult,
    syncEmails,
    uploadExcelFile,
    authorizeGmail,
    revokeGmailAuthorization,
  } = usePmcInventoryData({
    selectedLine,
    setSelectedLine,
    setError,
    setSuccessMessage,
    setActiveTab,
    fetchHistoryEvents,
    refreshAdjustmentData: () => Promise.resolve(),
    resetTargetGapState: () => resetTargetGapStateRef.current?.(),
    filterBomProduct: isRemovedProductLike,
  });

  const {
    targetGapMode,
    setTargetGapMode,
    targetGapRows,
    setTargetGapRows,
    targetGapBatchResult,
    targetGapLoading,
    targetGapProductsByLine,
    targetGapLines,
    getTargetGapProductStableKey,
    analyzeTargetGapBatch,
    resetTargetGapState,
  } = usePmcTargetGap({
    bomProducts,
    recordId: uploadResult?.record_id,
    lineRank,
    formatProductName,
    setError,
  });
  resetTargetGapStateRef.current = resetTargetGapState;

  const {
    editingProductKey,
    editingParts,
    selectedAltRows,
    savingBom,
    startEditBom,
    cancelEditBom,
    updateEditingPart,
    addEditingPart,
    removeEditingPart,
    toggleAltRowSelection,
    applySelectedAsAltGroup,
    clearSelectedAltGroup,
    saveBomParts,
  } = usePmcBomEditor({
    setError,
    onAfterSave: async () => {
      await fetchBomList();
      await fetchBomStatus();
      if (uploadResult?.record_id) {
        await loadUploadResultByRecordId(uploadResult.record_id);
      }
      await fetchHistoryEvents();
    },
  });

  const {
    events: inventoryAdjustmentEvents,
    summary: inventoryAdjustmentSummary,
    loadingData: inventoryAdjustmentLoading,
    scanning: adjustmentScanning,
    applyingEventId: applyingAdjustmentEventId,
    rejectingEventId: rejectingAdjustmentEventId,
    batchRejecting: batchRejectingAdjustments,
    restoringEventId: restoringAdjustmentEventId,
    deletingEventId: deletingAdjustmentEventId,
    batchRestoring: batchRestoringAdjustments,
    batchDeleting: batchDeletingAdjustments,
    confirmAction: inventoryAdjustmentConfirmAction,
    setConfirmAction: setInventoryAdjustmentConfirmAction,
    refreshAdjustmentData,
    scanEmails: scanInventoryAdjustmentEmails,
    applyAdjustment: applyInventoryAdjustment,
    rejectAdjustment: rejectInventoryAdjustment,
    rejectAdjustmentsBatch: rejectInventoryAdjustmentsBatch,
    restoreAdjustment: restoreInventoryAdjustment,
    restoreAdjustmentsBatch: restoreInventoryAdjustmentsBatch,
    confirmDeletion: confirmInventoryAdjustmentAction,
  } = usePmcInventoryAdjustments({
    setError,
    setSuccessMessage,
    setActiveTab,
    fetchRecords,
    fetchHistoryEvents,
    loadLatestUploadResult,
  });

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const bomByLine: Record<string, BomProduct[]> = {};
  bomProducts.forEach(p => {
    const line = p.category || '未分类';
    if (!bomByLine[line]) bomByLine[line] = [];
    bomByLine[line].push(p);
  });
  const getLineBomProducts = (line: string) => {
    const products = bomByLine[line] || [];
    return bomViewMode === 'finished' ? products.filter(isFinishedBomProduct) : products;
  };
  const bomProductByCode = new Map<string, BomProduct>();
  bomProducts.forEach((product) => {
    const code = (product.product_code || '').trim();
    if (!code) return;
    if (!bomProductByCode.has(code)) {
      bomProductByCode.set(code, product);
    }
  });
  const getChildBomProducts = (product: BomProduct) => {
    const seen = new Set<string>();
    const children: BomProduct[] = [];
    product.parts.forEach((part) => {
      const partNo = (part.part_no || '').trim();
      if (!partNo || seen.has(partNo)) return;
      const child = bomProductByCode.get(partNo);
      if (!child) return;
      seen.add(partNo);
      children.push(child);
    });
    return children;
  };

  const bomLineOptions = Object.keys(bomByLine)
    .sort((a, b) => lineRank(a) - lineRank(b))
    .map((line) => ({
      key: line,
      label: displayLineName(line),
      count: getLineBomProducts(line).length,
    }));
  const selectedLineProducts = selectedLine ? getLineBomProducts(selectedLine) : [];
  const selectedLineKey = selectedLine ? selectedLine.toLowerCase() : '';
  const selectedSeriesConfig = selectedLineKey ? SMALL_BOARD_SERIES_CONFIG[selectedLineKey] : undefined;
  const selectedSeriesProducts = selectedSeriesConfig
    ? selectedLineProducts.filter((product) => product.file === selectedSeriesConfig.file)
    : [];
  const selectedNormalProducts = selectedSeriesConfig
    ? selectedLineProducts.filter((product) => product.file !== selectedSeriesConfig.file)
    : selectedLineProducts;
  const selectedSeriesSection = selectedSeriesConfig
    ? {
        key: `${selectedLineKey}-small-board-series`,
        label: selectedSeriesConfig.label,
        file: selectedSeriesConfig.file,
        products: selectedSeriesProducts,
      }
    : null;


  const sortedCapacityProducts = uploadResult
    ? [...uploadResult.capacity_analysis.products]
        .filter((product) => !isRemovedProductLike(product))
        .sort((a, b) => {
        if (b.capacity !== a.capacity) return b.capacity - a.capacity;
        return a.product.localeCompare(b.product, 'zh-CN');
      })
    : [];

  const capacityByLine: Record<string, UploadResult['capacity_analysis']['products']> = {};
  sortedCapacityProducts.forEach((product) => {
    const line = product.line || '未分类';
    if (!capacityByLine[line]) capacityByLine[line] = [];
    capacityByLine[line].push(product);
  });
  const capacityLines = Object.keys(capacityByLine).sort((a, b) => {
    const rankDiff = lineRank(a) - lineRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.localeCompare(b, 'zh-CN');
  });

  const renderProductCard = (product: BomProduct, nested = false, visitedCodes?: Set<string>) => (
    <PmcBomProductCard
      key={`${product.file}-${product.product_code || product.product_name}`}
      product={product}
      nested={nested}
      visitedCodes={visitedCodes}
      formatProductName={formatProductName}
      getBomTierLabel={getBomTierLabel}
      getChildBomProducts={getChildBomProducts}
      expandedProductMap={expandedProductMap}
      setExpandedProductMap={setExpandedProductMap}
      editingProductKey={editingProductKey}
      editingParts={editingParts}
      selectedAltRows={selectedAltRows}
      savingBom={savingBom}
      onStartEditBom={startEditBom}
      onCancelEditBom={cancelEditBom}
      onUpdateEditingPart={updateEditingPart}
      onAddEditingPart={addEditingPart}
      onRemoveEditingPart={removeEditingPart}
      onToggleAltRowSelection={toggleAltRowSelection}
      onApplySelectedAsAltGroup={applySelectedAsAltGroup}
      onClearSelectedAltGroup={clearSelectedAltGroup}
      onSaveBomParts={saveBomParts}
    />
  );

  const renderTargetGapModule = () => (
    <TargetGapPanel
      targetGapMode={targetGapMode}
      onChangeTargetGapMode={setTargetGapMode}
      targetGapLines={targetGapLines}
      targetGapProductsByLine={targetGapProductsByLine}
      displayLineName={displayLineName}
      getTargetGapProductStableKey={getTargetGapProductStableKey}
      targetGapRows={targetGapRows}
      setTargetGapRows={setTargetGapRows}
      targetGapLoading={targetGapLoading}
      onAnalyzeTargetGapBatch={analyzeTargetGapBatch}
      targetGapBatchResult={targetGapBatchResult}
    />
  );

  const handleUploadExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await uploadExcelFile(file);
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="pmc-shell w-full animate-fade-in relative">
      <PmcConfirmDialog
        isOpen={gmailRevokeConfirmOpen}
        onClose={() => {
          if (!revokingGmail) setGmailRevokeConfirmOpen(false);
        }}
        onConfirm={() => { void revokeGmailAuthorization(); }}
        title="确认断开邮箱"
        message="断开后，系统会立即停止自动读取邮箱附件；如果之后还需要自动同步，需要重新完成一次连接。"
        intent="danger"
        confirmLabel={revokingGmail ? '断开中...' : '确认断开'}
        cancelLabel="继续保持连接"
        confirmDisabled={revokingGmail}
        cancelDisabled={revokingGmail}
      />
      <PmcConfirmDialog
        isOpen={!!historyConfirmAction}
        onClose={() => setHistoryConfirmAction(null)}
        onConfirm={() => { void confirmHistoryAction(); }}
        title={
          historyConfirmAction?.type === 'archive' ? '确认归档历史记录'
            : historyConfirmAction?.type === 'batch_archive' ? '确认批量归档历史记录'
            : historyConfirmAction?.type === 'restore' ? '确认恢复归档记录'
            : historyConfirmAction?.type === 'batch_restore' ? '确认批量恢复归档记录'
            : historyConfirmAction?.type === 'cleanup' ? '确认清理旧归档'
            : '确认彻底删除归档记录'
        }
        message={
          historyConfirmAction?.type === 'archive'
            ? `确定要将这条${historyConfirmAction.event.event_type === 'bom_change' ? '物料清单变更' : '库存更新'}移入归档吗？`
            : historyConfirmAction?.type === 'batch_archive'
              ? `确定要将选中的 ${historyConfirmAction.events.length} 条历史记录移入归档吗？`
              : historyConfirmAction?.type === 'restore'
                ? `确定要将这条已归档${historyConfirmAction.event.event_type === 'bom_change' ? '物料清单变更' : '库存更新'}恢复到主历史列表吗？`
                : historyConfirmAction?.type === 'batch_restore'
                  ? `确定要恢复选中的 ${historyConfirmAction.events.length} 条已归档记录吗？`
                  : historyConfirmAction?.type === 'cleanup'
                    ? `确定要将 ${historyConfirmAction.days} 天前的历史记录统一移入归档吗？`
                    : historyConfirmAction?.type === 'batch_permanent_delete'
                      ? `确定要彻底删除选中的 ${historyConfirmAction.events.length} 条已归档记录吗？删除后将无法恢复。`
                      : historyConfirmAction?.event
                        ? `确定要彻底删除这条已归档${historyConfirmAction.event.event_type === 'bom_change' ? '物料清单变更' : '库存更新'}记录吗？删除后将无法恢复。`
                        : ''
        }
        intent={
          historyConfirmAction?.type === 'restore' || historyConfirmAction?.type === 'batch_restore'
            ? 'restore'
            : historyConfirmAction?.type === 'permanent_delete' || historyConfirmAction?.type === 'batch_permanent_delete'
              ? 'danger'
              : 'warning'
        }
        confirmLabel={
          historyConfirmAction?.type === 'archive' ? '确认归档'
            : historyConfirmAction?.type === 'batch_archive' ? '确认批量归档'
            : historyConfirmAction?.type === 'restore' ? '确认恢复'
            : historyConfirmAction?.type === 'batch_restore' ? '确认批量恢复'
            : historyConfirmAction?.type === 'cleanup' ? '确认清理'
            : '确认彻底删除'
        }
      />
      <PmcConfirmDialog
        isOpen={!!inventoryAdjustmentConfirmAction}
        onClose={() => setInventoryAdjustmentConfirmAction(null)}
        onConfirm={() => { void confirmInventoryAdjustmentAction(); }}
        title={
          inventoryAdjustmentConfirmAction?.type === 'permanent_delete' &&
          inventoryAdjustmentConfirmAction.event.status === 'applied'
            ? inventoryAdjustmentConfirmAction.event.new_record_id
              ? '确认删除旧版已确认邮件并回滚库存'
              : '确认删除已确认邮件'
            : '确认删除已忽略邮件'
        }
        message={
          inventoryAdjustmentConfirmAction?.type === 'permanent_delete'
            ? inventoryAdjustmentConfirmAction.event.status === 'applied'
              ? inventoryAdjustmentConfirmAction.event.new_record_id
                ? `确定要删除这条旧版已确认邮件库存变动，并回滚它生成的库存快照吗？\n\n删除后，系统会回到快照 #${inventoryAdjustmentConfirmAction.event.previous_record_id ?? '-'}，这条确认记录也会从数据库移除。\n\n${inventoryAdjustmentConfirmAction.event.subject || '未命名邮件'}`
                : `确定要把这条已确认邮件库存变动从数据库删除吗？删除后它不会再参与库存对账。\n\n${inventoryAdjustmentConfirmAction.event.subject || '未命名邮件'}`
              : `确定要把这条已忽略邮件库存变动从数据库彻底删除吗？删除后它不会再出现在“显示已处理”里，后续重新扫描邮箱时才有机会重新导入。\n\n${inventoryAdjustmentConfirmAction.event.subject || '未命名邮件'}`
            : inventoryAdjustmentConfirmAction?.type === 'batch_permanent_delete'
              ? `确定要把选中的 ${inventoryAdjustmentConfirmAction.eventIds.length} 条已忽略邮件从数据库彻底删除吗？删除后它们不会再出现在“显示已处理”里，后续重新扫描邮箱时才有机会重新导入。`
              : ''
        }
        intent="danger"
        confirmLabel={
          deletingAdjustmentEventId || batchDeletingAdjustments
            ? '删除中...'
            : inventoryAdjustmentConfirmAction?.type === 'permanent_delete' &&
              inventoryAdjustmentConfirmAction.event.status === 'applied'
              ? inventoryAdjustmentConfirmAction.event.new_record_id
                ? '确认删除并回滚'
                : '确认删除'
              : '确认彻底删除'
        }
        cancelLabel="取消"
        confirmDisabled={!!deletingAdjustmentEventId || batchDeletingAdjustments}
        cancelDisabled={!!deletingAdjustmentEventId || batchDeletingAdjustments}
      />
      <main className="w-full">
        <PmcHeaderBar
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          gmailAuthorized={Boolean(gmailAuthorized)}
          latestSyncSummary={latestSyncSummary}
          bomStatusReady={Boolean(bomStatus?.ready)}
          bomStatusSummary={bomStatusSummary}
          syncing={syncing}
          uploading={uploading}
          revokingGmail={revokingGmail}
          onSyncEmails={syncEmails}
          onUploadClick={() => fileInputRef.current?.click()}
          onAuthorizeGmail={authorizeGmail}
          onRevokeGmail={() => setGmailRevokeConfirmOpen(true)}
        />
        <input ref={fileInputRef} type="file" onChange={handleUploadExcel} className="hidden" />

      {successMessage && (
        <div className="mb-6 m-panel !border-emerald-200 bg-emerald-50/70 p-4 flex items-center gap-3 text-[13px] font-medium text-emerald-800">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" strokeWidth={2} />
          {successMessage}
        </div>
      )}

      {error && (
        <div className="mb-6 m-panel !border-rose-200 bg-rose-50/50 p-4 flex items-center gap-3 text-[13px] font-medium text-rose-800">
          <AlertTriangle className="w-5 h-5 text-rose-500" strokeWidth={2} /> 
          {error}
        </div>
      )}

      <PmcSyncNotice
        manualSyncResult={manualSyncResult}
        dismissed={manualSyncNoticeDismissed}
        onDismiss={() => setManualSyncNoticeDismissed(true)}
      />

      {/* ===== Tab Content ===== */}
      <div className="relative z-10 space-y-8">
        {activeTab === 'bom' && (
          <PmcBomPanel
            bomLoading={bomLoading}
            lineOptions={bomLineOptions}
            selectedLine={selectedLine}
            onSelectLine={setSelectedLine}
            bomViewMode={bomViewMode}
            onChangeBomViewMode={(mode) => {
              setBomViewMode(mode);
              setExpandedProductMap({});
              setExpandedSeries(null);
            }}
            seriesSection={selectedSeriesSection}
            expandedSeries={expandedSeries}
            onToggleSeries={(key) => setExpandedSeries(expandedSeries === key ? null : key)}
            normalProducts={selectedNormalProducts}
            totalLineProducts={selectedLineProducts.length}
            renderProductCard={renderProductCard}
          />
        )}

        {activeTab === 'stock' && (
          <div className="animate-fade-in space-y-8">
            {!uploadResult ? (
              <div className="pmc-empty-state">
                <div className="w-20 h-20 bg-slate-50 rounded-[28px] flex items-center justify-center border border-white shadow-inner">
                  <Archive className="w-8 h-8 text-slate-400" />
                </div>
                <h2 className="text-3xl font-bold text-slate-900 mb-2">等待库存数据</h2>
                <p className="text-slate-500 font-medium max-w-sm mx-auto leading-relaxed">请通过顶部上传最新库存文件以查看库存明细表。</p>
              </div>
            ) : (
              <InventoryStockPanel
                inventory={uploadResult.inventory}
                adjustmentEvents={inventoryAdjustmentEvents}
                adjustmentSummary={inventoryAdjustmentSummary}
              />
            )}
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="animate-fade-in space-y-8">
            {!uploadResult ? (
              <div className="pmc-empty-state">
                <div className="w-20 h-20 bg-slate-50 rounded-[28px] flex items-center justify-center border border-white shadow-inner">
                  <Upload className="w-8 h-8 text-slate-400" />
                </div>
                <h2 className="text-3xl font-bold text-slate-900 mb-2">等待上传库存</h2>
                <p className="text-slate-500 font-medium max-w-sm mx-auto leading-relaxed">请通过顶部上传最新库存文件，系统会自动完成机型产能与缺料计算。</p>
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                {/* 缺口分析作为核心大卡片 */}
                {renderTargetGapModule()}

                <div className="flex flex-col gap-8">
                  {/* 产能概览 */}
                  <SingleProductCapacityPanel
                    capacityByLine={capacityByLine}
                    capacityLines={capacityLines}
                    displayLineName={displayLineName}
                    normalizeLineKey={normalizeLineKey}
                    smallBoardSeriesConfig={SMALL_BOARD_SERIES_CONFIG}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'adjustments' && (
          <PmcInventoryAdjustmentPanel
            events={inventoryAdjustmentEvents}
            summary={inventoryAdjustmentSummary}
            loadingData={inventoryAdjustmentLoading}
            scanning={adjustmentScanning}
            applyingEventId={applyingAdjustmentEventId}
            rejectingEventId={rejectingAdjustmentEventId}
            batchRejecting={batchRejectingAdjustments}
            restoringEventId={restoringAdjustmentEventId}
            deletingEventId={deletingAdjustmentEventId}
            batchRestoring={batchRestoringAdjustments}
            batchDeleting={batchDeletingAdjustments}
            onScan={scanInventoryAdjustmentEmails}
            onApply={(payload) => { void applyInventoryAdjustment(payload); }}
            onReject={(payload) => { void rejectInventoryAdjustment(payload); }}
            onRejectBatch={(payload) => { void rejectInventoryAdjustmentsBatch(payload); }}
            onRestore={(eventId) => { void restoreInventoryAdjustment(eventId); }}
            onDelete={(event) => setInventoryAdjustmentConfirmAction({ type: 'permanent_delete', event })}
            onRestoreBatch={(payload) => { void restoreInventoryAdjustmentsBatch(payload); }}
            onDeleteBatch={(payload) => setInventoryAdjustmentConfirmAction({ type: 'batch_permanent_delete', eventIds: payload.eventIds })}
          />
        )}

        {activeTab === 'history' && (
          <PmcHistoryPanel
            historyEvents={historyEvents}
            historyGroupExpanded={historyGroupExpanded}
            setHistoryGroupExpanded={setHistoryGroupExpanded}
            expandedHistoryEvents={expandedHistoryEvents}
            setExpandedHistoryEvents={setExpandedHistoryEvents}
            expandedHistoryPathNodes={expandedHistoryPathNodes}
            setExpandedHistoryPathNodes={setExpandedHistoryPathNodes}
            deletingHistoryEventId={deletingHistoryEventId}
            permanentlyDeletingHistoryEventId={permanentlyDeletingHistoryEventId}
            restoringHistoryEventId={restoringHistoryEventId}
            historyShowDeleted={historyShowDeleted}
            setHistoryShowDeleted={setHistoryShowDeleted}
            historyManageMode={historyManageMode}
            setHistoryManageMode={setHistoryManageMode}
            selectedHistoryEventIds={selectedHistoryEventIds}
            setSelectedHistoryEventIds={setSelectedHistoryEventIds}
            historyBatchDeleting={historyBatchDeleting}
            historyBatchPermanentDeleting={historyBatchPermanentDeleting}
            historyBatchRestoring={historyBatchRestoring}
            historyCleaning={historyCleaning}
            historyKeyword={historyKeyword}
            setHistoryKeyword={setHistoryKeyword}
            historyDateFrom={historyDateFrom}
            setHistoryDateFrom={setHistoryDateFrom}
            historyDateTo={historyDateTo}
            setHistoryDateTo={setHistoryDateTo}
            onDeleteHistoryEvent={deleteHistoryEvent}
            onToggleHistoryEventSelected={toggleHistoryEventSelected}
            onDeleteSelectedHistoryEvents={deleteSelectedHistoryEvents}
            onRequestPermanentDeleteHistoryEvent={requestPermanentDeleteHistoryEvent}
            onRequestPermanentDeleteSelectedHistoryEvents={requestPermanentDeleteSelectedHistoryEvents}
            onRestoreHistoryEvent={restoreHistoryEvent}
            onRestoreSelectedHistoryEvents={restoreSelectedHistoryEvents}
            onCleanupHistoryEvents={cleanupHistoryEvents}
            activeCountOverride={historyActiveCount}
            archivedCountOverride={historyArchivedCount}
          />
        )}
      </div>
    </main>

    </div>
  );
};
