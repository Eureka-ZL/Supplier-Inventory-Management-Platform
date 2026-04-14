import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { getAuthToken } from '../../../services/api';
import type { BomProduct } from '../bomTypes';
import type { BomStatus, InventoryRecord, ManualSyncResult, UploadResult } from '../types';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

const formatSyncTime = (timeStr?: string) => {
  if (!timeStr) return '';
  const value = new Date(timeStr);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatBomStatusTime = (timeStr?: string | null) => {
  if (!timeStr) return '';
  const value = new Date(timeStr);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getSyncSourceLabel = (sourceEmail?: string) => {
  const value = (sourceEmail || '').trim();
  if (!value) return '';
  return value === '手动上传' ? '手动同步' : '邮件同步';
};

interface UsePmcInventoryDataOptions {
  selectedLine: string | null;
  setSelectedLine: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setActiveTab: Dispatch<SetStateAction<'bom' | 'inventory' | 'stock' | 'adjustments' | 'history'>>;
  fetchHistoryEvents: () => Promise<void> | void;
  refreshAdjustmentData: () => Promise<void> | void;
  resetTargetGapState: () => void;
  filterBomProduct: (product: BomProduct) => boolean;
}

export const usePmcInventoryData = ({
  selectedLine,
  setSelectedLine,
  setError,
  setSuccessMessage,
  setActiveTab,
  fetchHistoryEvents,
  refreshAdjustmentData,
  resetTargetGapState,
  filterBomProduct,
}: UsePmcInventoryDataOptions) => {
  const [records, setRecords] = useState<InventoryRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [revokingGmail, setRevokingGmail] = useState(false);
  const [gmailAuthorized, setGmailAuthorized] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [manualSyncResult, setManualSyncResult] = useState<ManualSyncResult | null>(null);
  const [manualSyncNoticeDismissed, setManualSyncNoticeDismissed] = useState(false);
  const [bomProducts, setBomProducts] = useState<BomProduct[]>([]);
  const [bomStatus, setBomStatus] = useState<BomStatus | null>(null);
  const [bomLoading, setBomLoading] = useState(false);

  const latestInventoryRecord = records[0] || null;
  const latestSyncTime = formatSyncTime(latestInventoryRecord?.parsed_at);
  const latestSyncSource = getSyncSourceLabel(latestInventoryRecord?.source_email);
  const latestSyncSummary = [latestSyncTime ? `最近同步 ${latestSyncTime}` : '', latestSyncSource].filter(Boolean).join(' · ');
  const bomStatusTime = formatBomStatusTime(bomStatus?.latest_updated_at);
  const bomStatusSummary = bomStatus?.ready
    ? [
        '物料清单库',
        bomStatusTime ? `更新 ${bomStatusTime}` : '',
        bomStatus?.finished_product_count ? `成品机 ${bomStatus.finished_product_count}` : '',
        typeof bomStatus?.part_count === 'number' ? `物料 ${bomStatus.part_count}` : '',
      ].filter(Boolean).join(' · ')
    : '';

  const fetchBomList = async () => {
    setBomLoading(true);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/bom/list`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const rawProducts: BomProduct[] = data.products || [];
        const products = rawProducts.filter((product) => !filterBomProduct(product));
        setBomProducts(products);
        if (products.length > 0 && !selectedLine) {
          const firstLine = products[0].category || '未分类';
          setSelectedLine(firstLine);
        }
      }
    } catch (err) {
      console.error('Failed to load BOM list:', err);
    } finally {
      setBomLoading(false);
    }
  };

  const fetchBomStatus = async () => {
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/bom/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data: BomStatus = await response.json();
      setBomStatus(data);
    } catch (err) {
      console.error('Failed to load BOM status:', err);
    }
  };

  const checkGmailStatus = async () => {
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/gmail/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setGmailAuthorized(data.authorized);
      }
    } catch {
      setGmailAuthorized(false);
    }
  };

  const authorizeGmail = async () => {
    let popup: Window | null = null;
    let pollInterval: number | null = null;
    let timeoutId: number | null = null;
    const cleanup = () => {
      if (pollInterval !== null) {
        window.clearInterval(pollInterval);
        pollInterval = null;
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      window.removeEventListener('message', handleOAuthMessage);
    };

    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'gmail-oauth-complete') return;

      cleanup();
      if (event.data.success) {
        setGmailAuthorized(true);
        setError(null);
        setSuccessMessage(null);
      } else {
        setError(`邮箱授权失败: ${event.data.message || '未知错误'}`);
      }
    };

    try {
      const token = getAuthToken();
      popup = window.open('about:blank', '_blank');
      window.addEventListener('message', handleOAuthMessage);

      const response = await fetch(`${API_BASE_URL}/api/pmc/gmail/authorize`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (popup) {
          popup.location.href = data.authorization_url;
        } else {
          window.location.href = data.authorization_url;
        }
        pollInterval = window.setInterval(async () => {
          const statusResp = await fetch(`${API_BASE_URL}/api/pmc/gmail/status`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (statusResp.ok) {
            const statusData = await statusResp.json();
            if (statusData.authorized) {
              setGmailAuthorized(true);
              cleanup();
            }
          }
        }, 3000);
        timeoutId = window.setTimeout(() => {
          cleanup();
        }, 300000);
      } else {
        window.removeEventListener('message', handleOAuthMessage);
        const errData = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
        throw new Error(errData.detail || '后端服务异常');
      }
    } catch (err: any) {
      cleanup();
      if (popup) popup.close();
      setError(`无法启动邮箱授权: ${err.message}`);
    }
  };

  const revokeGmailAuthorization = async () => {
    if (revokingGmail) return;

    try {
      setRevokingGmail(true);
      setError(null);
      setSuccessMessage(null);

      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/gmail/authorize`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Revoke failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setGmailAuthorized(false);
      setManualSyncResult(null);
      setManualSyncNoticeDismissed(false);
      setSuccessMessage(data.message || '邮箱授权已取消');
    } catch (err: any) {
      setError(`取消邮箱授权失败: ${err.message || '未知错误'}`);
    } finally {
      setRevokingGmail(false);
    }
  };

  const fetchRecords = async () => {
    setError(null);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/inventory/latest`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const loadUploadResultByRecordId = async (recordId: number) => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/api/pmc/inventory/record/${recordId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({ detail: 'Load record failed' }));
      throw new Error(errData.detail || `HTTP ${response.status}`);
    }
    const data: UploadResult = await response.json();
    setUploadResult(data);
  };

  const loadLatestUploadResult = async () => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/api/pmc/inventory/latest?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;
    const recordsData: InventoryRecord[] = await response.json();
    const latestId = recordsData?.[0]?.id;
    if (latestId) {
      await loadUploadResultByRecordId(latestId);
    }
  };

  const syncEmails = async () => {
    setSyncing(true);
    setError(null);
    setManualSyncResult(null);
    setManualSyncNoticeDismissed(false);
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/pmc/inventory/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Sync failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      const data: ManualSyncResult = await response.json();
      setManualSyncResult(data);
      if (data.record_id) {
        await loadUploadResultByRecordId(data.record_id);
        resetTargetGapState();
        setActiveTab('stock');
      } else {
        await loadLatestUploadResult();
      }
      void fetchRecords();
      await Promise.resolve(fetchHistoryEvents());
      await Promise.resolve(refreshAdjustmentData());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const uploadExcelFile = async (file: File) => {
    setUploading(true);
    setError(null);
    setUploadResult(null);
    setManualSyncResult(null);
    setManualSyncNoticeDismissed(false);
    try {
      const token = getAuthToken();
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE_URL}/api/pmc/inventory/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      const result: UploadResult = await response.json();
      setUploadResult(result);
      resetTargetGapState();
      setActiveTab('stock');
      void fetchRecords();
      await Promise.resolve(fetchHistoryEvents());
      await Promise.resolve(refreshAdjustmentData());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (manualSyncResult) {
      setManualSyncNoticeDismissed(false);
    }
  }, [manualSyncResult]);

  useEffect(() => {
    checkGmailStatus();
    void fetchRecords();
    void Promise.resolve(fetchHistoryEvents());
    void Promise.resolve(refreshAdjustmentData());
    void fetchBomList();
    void fetchBomStatus();
    void loadLatestUploadResult();

    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail_authorized') === 'true') {
      setGmailAuthorized(true);
      setError(null);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('gmail_authorized') === 'false') {
      setGmailAuthorized(false);
      window.history.replaceState({}, '', window.location.pathname);
    }

    const interval = setInterval(() => {
      void fetchRecords();
      void Promise.resolve(fetchHistoryEvents());
      void Promise.resolve(refreshAdjustmentData());
      void fetchBomStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return {
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
  };
};
