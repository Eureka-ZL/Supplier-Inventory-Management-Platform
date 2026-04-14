import { useCallback, useEffect, useState } from 'react';

import {
  pmcApi,
  type InventoryAdjustmentCycleSummary,
  type InventoryAdjustmentEvent,
} from '../../../services/api';

type PmcTab = 'bom' | 'inventory' | 'stock' | 'adjustments' | 'history';

export type InventoryAdjustmentConfirmAction =
  | { type: 'permanent_delete'; event: InventoryAdjustmentEvent }
  | { type: 'batch_permanent_delete'; eventIds: number[] };

interface UsePmcInventoryAdjustmentsOptions {
  setError: (value: string | null) => void;
  setSuccessMessage: (value: string | null) => void;
  setActiveTab: (tab: PmcTab) => void;
  fetchRecords: () => Promise<void> | void;
  fetchHistoryEvents: () => Promise<void> | void;
  loadLatestUploadResult: () => Promise<void> | void;
}

export function usePmcInventoryAdjustments({
  setError,
  setSuccessMessage,
  setActiveTab,
  fetchRecords,
  fetchHistoryEvents,
  loadLatestUploadResult,
}: UsePmcInventoryAdjustmentsOptions) {
  const [events, setEvents] = useState<InventoryAdjustmentEvent[]>([]);
  const [summary, setSummary] = useState<InventoryAdjustmentCycleSummary | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [applyingEventId, setApplyingEventId] = useState<number | null>(null);
  const [rejectingEventId, setRejectingEventId] = useState<number | null>(null);
  const [batchRejecting, setBatchRejecting] = useState(false);
  const [restoringEventId, setRestoringEventId] = useState<number | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const [batchRestoring, setBatchRestoring] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<InventoryAdjustmentConfirmAction | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await pmcApi.listInventoryAdjustments();
      setEvents(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to load inventory adjustment events:', err);
      setError(`加载邮件库存变动列表失败: ${err?.message || '未知错误'}`);
    }
  }, [setError]);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await pmcApi.getInventoryAdjustmentSummary();
      setSummary(data);
    } catch (err: any) {
      console.error('Failed to load inventory adjustment summary:', err);
      setSummary(null);
      setError(`加载库存周期对账失败: ${err?.message || '未知错误'}`);
    }
  }, [setError]);

  const refreshAdjustmentData = useCallback(async () => {
    setLoadingData(true);
    await Promise.all([fetchEvents(), fetchSummary()]);
    setLoadingData(false);
  }, [fetchEvents, fetchSummary]);

  useEffect(() => {
    void refreshAdjustmentData();
  }, [refreshAdjustmentData]);

  const scanEmails = useCallback(async () => {
    try {
      setScanning(true);
      setError(null);
      setSuccessMessage(null);
      const result = await pmcApi.scanInventoryAdjustments();
      await refreshAdjustmentData();
      setActiveTab('adjustments');
      setSuccessMessage(`邮件扫描完成：新增 ${result.created_count} 条邮件库存变动，跳过 ${result.skipped_count} 条`);
    } catch (err: any) {
      setError(`扫描邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setScanning(false);
    }
  }, [refreshAdjustmentData, setActiveTab, setError, setSuccessMessage]);

  const applyAdjustment = useCallback(async (payload: {
    eventId: number;
    partNo?: string;
    quantity?: number;
    applyNote?: string;
  }) => {
    try {
      setApplyingEventId(payload.eventId);
      setError(null);
      setSuccessMessage(null);
      const result = await pmcApi.applyInventoryAdjustment({
        event_id: payload.eventId,
        part_no: payload.partNo,
        quantity: payload.quantity,
        apply_note: payload.applyNote,
      });
      await Promise.all([
        refreshAdjustmentData(),
        Promise.resolve(fetchRecords()),
        Promise.resolve(fetchHistoryEvents()),
        Promise.resolve(loadLatestUploadResult()),
      ]);
      setSuccessMessage(
        `邮件库存变动已确认：${result.part_no} ${result.quantity}`
      );
    } catch (err: any) {
      setError(`确认邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setApplyingEventId(null);
    }
  }, [
    fetchHistoryEvents,
    fetchRecords,
    loadLatestUploadResult,
    refreshAdjustmentData,
    setError,
    setSuccessMessage,
  ]);

  const rejectAdjustment = useCallback(async (payload: {
    eventId: number;
    applyNote?: string;
  }) => {
    try {
      setRejectingEventId(payload.eventId);
      setError(null);
      setSuccessMessage(null);
      await pmcApi.rejectInventoryAdjustment({
        event_id: payload.eventId,
        apply_note: payload.applyNote,
      });
      await Promise.all([
        refreshAdjustmentData(),
        Promise.resolve(fetchHistoryEvents()),
      ]);
      setSuccessMessage('这条邮件库存变动已移除，默认不会再显示在待处理列表里');
    } catch (err: any) {
      setError(`移除邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setRejectingEventId(null);
    }
  }, [refreshAdjustmentData, setError, setSuccessMessage]);

  const rejectAdjustmentsBatch = useCallback(async (payload: { eventIds: number[] }) => {
    try {
      setBatchRejecting(true);
      setError(null);
      setSuccessMessage(null);
      const result = await pmcApi.rejectInventoryAdjustmentsBatch({
        event_ids: payload.eventIds,
      });
      await Promise.all([
        refreshAdjustmentData(),
        Promise.resolve(fetchHistoryEvents()),
      ]);
      setSuccessMessage(`已批量移除 ${result.rejected_count} 条邮件库存变动`);
    } catch (err: any) {
      setError(`批量移除邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setBatchRejecting(false);
    }
  }, [refreshAdjustmentData, setError, setSuccessMessage]);

  const restoreAdjustment = useCallback(async (eventId: number) => {
    try {
      setRestoringEventId(eventId);
      setError(null);
      setSuccessMessage(null);
      await pmcApi.restoreInventoryAdjustment({ event_id: eventId });
      await Promise.all([
        refreshAdjustmentData(),
        Promise.resolve(fetchHistoryEvents()),
      ]);
      setSuccessMessage('这条已忽略邮件库存变动已恢复到待处理列表');
      setActiveTab('adjustments');
    } catch (err: any) {
      setError(`恢复邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setRestoringEventId(null);
    }
  }, [refreshAdjustmentData, setActiveTab, setError, setSuccessMessage]);

  const deleteAdjustment = useCallback(async (event: InventoryAdjustmentEvent) => {
    try {
      setDeletingEventId(event.id);
      setError(null);
      setSuccessMessage(null);
      const result = await pmcApi.deleteInventoryAdjustment(event.id);
      if (result.rolled_back_to_record_id || result.deleted_record_id) {
        await Promise.all([
          refreshAdjustmentData(),
          Promise.resolve(fetchRecords()),
          Promise.resolve(fetchHistoryEvents()),
          Promise.resolve(loadLatestUploadResult()),
        ]);
      } else {
        await Promise.all([
          refreshAdjustmentData(),
          Promise.resolve(fetchHistoryEvents()),
        ]);
      }
      if (event.status === 'applied' || result.deleted_status === 'applied') {
        if (result.rolled_back_to_record_id || event.previous_record_id) {
          setSuccessMessage(
            `这条旧版已确认邮件库存变动已删除，库存已回滚到快照 #${result.rolled_back_to_record_id ?? event.previous_record_id ?? '-'}`
          );
        } else {
          setSuccessMessage('这条已确认邮件库存变动已从数据库删除');
        }
      } else {
        setSuccessMessage('这条已忽略邮件库存变动已从数据库删除');
      }
      setActiveTab('adjustments');
    } catch (err: any) {
      setError(`删除邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setDeletingEventId(null);
    }
  }, [
    fetchHistoryEvents,
    fetchRecords,
    loadLatestUploadResult,
    refreshAdjustmentData,
    setActiveTab,
    setError,
    setSuccessMessage,
  ]);

  const restoreAdjustmentsBatch = useCallback(async (payload: { eventIds: number[] }) => {
    try {
      setBatchRestoring(true);
      setError(null);
      setSuccessMessage(null);
      const result = await pmcApi.restoreInventoryAdjustmentsBatch({
        event_ids: payload.eventIds,
      });
      await Promise.all([
        refreshAdjustmentData(),
        Promise.resolve(fetchHistoryEvents()),
      ]);
      setSuccessMessage(`已批量恢复 ${result.restored_count} 条已忽略邮件库存变动`);
    } catch (err: any) {
      setError(`批量恢复邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setBatchRestoring(false);
    }
  }, [refreshAdjustmentData, setError, setSuccessMessage]);

  const deleteAdjustmentsBatch = useCallback(async (payload: { eventIds: number[] }) => {
    try {
      setBatchDeleting(true);
      setError(null);
      setSuccessMessage(null);
      const result = await pmcApi.deleteInventoryAdjustmentsBatch({
        event_ids: payload.eventIds,
      });
      await Promise.all([
        refreshAdjustmentData(),
        Promise.resolve(fetchHistoryEvents()),
      ]);
      setSuccessMessage(`已从数据库删除 ${result.deleted_count} 条已忽略邮件库存变动`);
      setActiveTab('adjustments');
    } catch (err: any) {
      setError(`批量删除邮件库存变动失败: ${err.message || '未知错误'}`);
    } finally {
      setBatchDeleting(false);
    }
  }, [refreshAdjustmentData, setActiveTab, setError, setSuccessMessage]);

  const confirmDeletion = useCallback(async () => {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);

    if (action.type === 'permanent_delete') {
      await deleteAdjustment(action.event);
      return;
    }
    await deleteAdjustmentsBatch({ eventIds: action.eventIds });
  }, [confirmAction, deleteAdjustment, deleteAdjustmentsBatch]);

  return {
    events,
    summary,
    loadingData,
    scanning,
    applyingEventId,
    rejectingEventId,
    batchRejecting,
    restoringEventId,
    deletingEventId,
    batchRestoring,
    batchDeleting,
    confirmAction,
    setConfirmAction,
    fetchEvents,
    fetchSummary,
    refreshAdjustmentData,
    scanEmails,
    applyAdjustment,
    rejectAdjustment,
    rejectAdjustmentsBatch,
    restoreAdjustment,
    deleteAdjustment,
    restoreAdjustmentsBatch,
    deleteAdjustmentsBatch,
    confirmDeletion,
  };
}
