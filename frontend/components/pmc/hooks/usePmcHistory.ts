import { useCallback, useEffect, useState } from 'react';

import { getAuthToken } from '../../../services/api';
import type { PmcHistoryEvent } from '../historyTypes';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

export type HistoryConfirmAction =
  | { type: 'archive'; event: PmcHistoryEvent }
  | { type: 'batch_archive'; events: PmcHistoryEvent[] }
  | { type: 'restore'; event: PmcHistoryEvent }
  | { type: 'batch_restore'; events: PmcHistoryEvent[] }
  | { type: 'cleanup'; days: number }
  | { type: 'permanent_delete'; event: PmcHistoryEvent }
  | { type: 'batch_permanent_delete'; events: PmcHistoryEvent[] };

interface UsePmcHistoryOptions {
  setError: (value: string | null) => void;
}

const parseHistoryNumericId = (event: PmcHistoryEvent): number | null => {
  const rawId = (event.event_id || '').split('-')[1];
  const numericId = Number(rawId);
  if (!numericId || Number.isNaN(numericId)) {
    return null;
  }
  return numericId;
};

const buildHistoryPayload = (events: PmcHistoryEvent[]) =>
  events
    .map((event) => {
      const numericId = parseHistoryNumericId(event);
      if (!numericId) return null;
      return { event_type: event.event_type, event_id: numericId };
    })
    .filter(Boolean);

export function usePmcHistory({ setError }: UsePmcHistoryOptions) {
  const [historyEvents, setHistoryEvents] = useState<PmcHistoryEvent[]>([]);
  const [historyGroupExpanded, setHistoryGroupExpanded] = useState({ bom: true, inventory: true });
  const [expandedHistoryEvents, setExpandedHistoryEvents] = useState<Record<string, boolean>>({});
  const [expandedHistoryPathNodes, setExpandedHistoryPathNodes] = useState<Record<string, boolean>>({});
  const [deletingHistoryEventId, setDeletingHistoryEventId] = useState<string | null>(null);
  const [permanentlyDeletingHistoryEventId, setPermanentlyDeletingHistoryEventId] = useState<string | null>(null);
  const [restoringHistoryEventId, setRestoringHistoryEventId] = useState<string | null>(null);
  const [historyShowDeleted, setHistoryShowDeleted] = useState(false);
  const [historyManageMode, setHistoryManageMode] = useState(false);
  const [selectedHistoryEventIds, setSelectedHistoryEventIds] = useState<Set<string>>(new Set());
  const [historyBatchDeleting, setHistoryBatchDeleting] = useState(false);
  const [historyBatchPermanentDeleting, setHistoryBatchPermanentDeleting] = useState(false);
  const [historyBatchRestoring, setHistoryBatchRestoring] = useState(false);
  const [historyCleaning, setHistoryCleaning] = useState(false);
  const [historyConfirmAction, setHistoryConfirmAction] = useState<HistoryConfirmAction | null>(null);
  const [historyActiveCount, setHistoryActiveCount] = useState(0);
  const [historyArchivedCount, setHistoryArchivedCount] = useState(0);
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');

  const fetchHistoryEvents = useCallback(async (includeDeleted: boolean = historyShowDeleted) => {
    try {
      const token = getAuthToken();
      const deletedOnly = includeDeleted;
      const response = await fetch(`${API_BASE_URL}/api/pmc/history/events?limit=120&include_deleted=${includeDeleted ? 'true' : 'false'}&deleted_only=${deletedOnly ? 'true' : 'false'}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const events = Array.isArray(data?.events) ? data.events as PmcHistoryEvent[] : [];
      setHistoryEvents(events);
      if (typeof data?.active_count === 'number') setHistoryActiveCount(data.active_count);
      if (typeof data?.archived_count === 'number') setHistoryArchivedCount(data.archived_count);
    } catch (err) {
      console.error('Failed to load history events:', err);
    }
  }, [historyShowDeleted]);

  useEffect(() => {
    void fetchHistoryEvents(historyShowDeleted);
    setExpandedHistoryEvents({});
    setSelectedHistoryEventIds(new Set());
    setHistoryManageMode(false);
  }, [fetchHistoryEvents, historyShowDeleted]);

  const archiveHistoryEventNow = useCallback(async (event: PmcHistoryEvent) => {
    const numericId = parseHistoryNumericId(event);
    if (!numericId) {
      setError('历史记录编号解析失败，无法删除');
      return;
    }
    setDeletingHistoryEventId(event.event_id);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/history/event/${event.event_type}/${numericId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Delete failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      setExpandedHistoryEvents((prev) => {
        const next = { ...prev };
        delete next[event.event_id];
        return next;
      });
      setSelectedHistoryEventIds((prev) => {
        const next = new Set(prev);
        next.delete(event.event_id);
        return next;
      });
      await fetchHistoryEvents();
    } catch (err: any) {
      setError(err.message || '删除历史记录失败');
    } finally {
      setDeletingHistoryEventId(null);
    }
  }, [fetchHistoryEvents, setError]);

  const toggleHistoryEventSelected = useCallback((eventId: string) => {
    setSelectedHistoryEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const permanentlyDeleteHistoryEvent = useCallback(async (event: PmcHistoryEvent) => {
    const numericId = parseHistoryNumericId(event);
    if (!numericId) {
      setError('历史记录编号解析失败，无法彻底删除');
      return;
    }

    setPermanentlyDeletingHistoryEventId(event.event_id);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/history/event/${event.event_type}/${numericId}/permanent`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Permanent delete failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      setSelectedHistoryEventIds((prev) => {
        const next = new Set(prev);
        next.delete(event.event_id);
        return next;
      });
      setExpandedHistoryEvents((prev) => {
        const next = { ...prev };
        delete next[event.event_id];
        return next;
      });
      await fetchHistoryEvents();
    } catch (err: any) {
      setError(err.message || '彻底删除历史记录失败');
    } finally {
      setPermanentlyDeletingHistoryEventId(null);
    }
  }, [fetchHistoryEvents, setError]);

  const permanentlyDeleteSelectedHistoryEvents = useCallback(async (events: PmcHistoryEvent[]) => {
    setHistoryBatchPermanentDeleting(true);
    setError(null);
    try {
      const token = getAuthToken();
      const payload = buildHistoryPayload(events);
      if (!payload.length) {
        throw new Error('没有可彻底删除的有效历史记录');
      }

      const response = await fetch(`${API_BASE_URL}/api/pmc/history/events/permanent-delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: payload }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Batch permanent delete failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      setSelectedHistoryEventIds(new Set());
      setExpandedHistoryEvents({});
      setHistoryManageMode(false);
      await fetchHistoryEvents();
    } catch (err: any) {
      setError(err.message || '批量彻底删除历史记录失败');
    } finally {
      setHistoryBatchPermanentDeleting(false);
    }
  }, [fetchHistoryEvents, setError]);

  const archiveSelectedHistoryEventsNow = useCallback(async (selectedEvents: PmcHistoryEvent[]) => {
    setHistoryBatchDeleting(true);
    setError(null);
    try {
      const token = getAuthToken();
      const events = buildHistoryPayload(selectedEvents);
      if (!events.length) {
        throw new Error('没有可删除的有效历史记录');
      }
      const response = await fetch(`${API_BASE_URL}/api/pmc/history/events/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Batch delete failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      setSelectedHistoryEventIds(new Set());
      setExpandedHistoryEvents({});
      setHistoryManageMode(false);
      await fetchHistoryEvents();
    } catch (err: any) {
      setError(err.message || '批量删除历史记录失败');
    } finally {
      setHistoryBatchDeleting(false);
    }
  }, [fetchHistoryEvents, setError]);

  const restoreHistoryEventNow = useCallback(async (event: PmcHistoryEvent) => {
    const numericId = parseHistoryNumericId(event);
    if (!numericId) {
      setError('历史记录编号解析失败，无法恢复');
      return;
    }
    setRestoringHistoryEventId(event.event_id);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/history/event/${event.event_type}/${numericId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Restore failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      setSelectedHistoryEventIds((prev) => {
        const next = new Set(prev);
        next.delete(event.event_id);
        return next;
      });
      setExpandedHistoryEvents((prev) => {
        const next = { ...prev };
        delete next[event.event_id];
        return next;
      });
      await fetchHistoryEvents();
    } catch (err: any) {
      setError(err.message || '恢复历史记录失败');
    } finally {
      setRestoringHistoryEventId(null);
    }
  }, [fetchHistoryEvents, setError]);

  const restoreSelectedHistoryEventsNow = useCallback(async (selectedEvents: PmcHistoryEvent[]) => {
    setHistoryBatchRestoring(true);
    setError(null);
    try {
      const token = getAuthToken();
      const events = buildHistoryPayload(selectedEvents);
      if (!events.length) {
        throw new Error('没有可恢复的有效历史记录');
      }
      const response = await fetch(`${API_BASE_URL}/api/pmc/history/events/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Batch restore failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      setSelectedHistoryEventIds(new Set());
      setExpandedHistoryEvents({});
      setHistoryManageMode(false);
      await fetchHistoryEvents();
    } catch (err: any) {
      setError(err.message || '批量恢复历史记录失败');
    } finally {
      setHistoryBatchRestoring(false);
    }
  }, [fetchHistoryEvents, setError]);

  const cleanupHistoryEventsNow = useCallback(async (days: number = 30) => {
    setHistoryCleaning(true);
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/history/events/cleanup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ older_than_days: days, event_scope: 'all' }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Cleanup failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      setSelectedHistoryEventIds(new Set());
      setExpandedHistoryEvents({});
      await fetchHistoryEvents();
    } catch (err: any) {
      setError(err.message || '清理旧记录失败');
    } finally {
      setHistoryCleaning(false);
    }
  }, [fetchHistoryEvents, setError]);

  const deleteHistoryEvent = useCallback(async (event: PmcHistoryEvent) => {
    setHistoryConfirmAction({ type: 'archive', event });
  }, []);

  const deleteSelectedHistoryEvents = useCallback(async () => {
    const selectedEvents = historyEvents.filter((event) => selectedHistoryEventIds.has(event.event_id));
    if (!selectedEvents.length) return;
    setHistoryConfirmAction({ type: 'batch_archive', events: selectedEvents });
  }, [historyEvents, selectedHistoryEventIds]);

  const requestPermanentDeleteHistoryEvent = useCallback((event: PmcHistoryEvent) => {
    setHistoryConfirmAction({ type: 'permanent_delete', event });
  }, []);

  const requestPermanentDeleteSelectedHistoryEvents = useCallback(() => {
    const selectedEvents = historyEvents.filter((event) => selectedHistoryEventIds.has(event.event_id));
    if (!selectedEvents.length) return;
    setHistoryConfirmAction({ type: 'batch_permanent_delete', events: selectedEvents });
  }, [historyEvents, selectedHistoryEventIds]);

  const restoreHistoryEvent = useCallback(async (event: PmcHistoryEvent) => {
    setHistoryConfirmAction({ type: 'restore', event });
  }, []);

  const restoreSelectedHistoryEvents = useCallback(async () => {
    const selectedEvents = historyEvents.filter((event) => selectedHistoryEventIds.has(event.event_id));
    if (!selectedEvents.length) return;
    setHistoryConfirmAction({ type: 'batch_restore', events: selectedEvents });
  }, [historyEvents, selectedHistoryEventIds]);

  const cleanupHistoryEvents = useCallback(async (days: number = 30) => {
    setHistoryConfirmAction({ type: 'cleanup', days });
  }, []);

  const confirmHistoryAction = useCallback(async () => {
    const action = historyConfirmAction;
    if (!action) return;
    setHistoryConfirmAction(null);

    if (action.type === 'archive') {
      await archiveHistoryEventNow(action.event);
      return;
    }
    if (action.type === 'batch_archive') {
      await archiveSelectedHistoryEventsNow(action.events);
      return;
    }
    if (action.type === 'restore') {
      await restoreHistoryEventNow(action.event);
      return;
    }
    if (action.type === 'batch_restore') {
      await restoreSelectedHistoryEventsNow(action.events);
      return;
    }
    if (action.type === 'cleanup') {
      await cleanupHistoryEventsNow(action.days);
      return;
    }
    if (action.type === 'permanent_delete') {
      await permanentlyDeleteHistoryEvent(action.event);
      return;
    }
    await permanentlyDeleteSelectedHistoryEvents(action.events);
  }, [
    archiveHistoryEventNow,
    archiveSelectedHistoryEventsNow,
    cleanupHistoryEventsNow,
    historyConfirmAction,
    permanentlyDeleteHistoryEvent,
    permanentlyDeleteSelectedHistoryEvents,
    restoreHistoryEventNow,
    restoreSelectedHistoryEventsNow,
  ]);

  return {
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
  };
}
