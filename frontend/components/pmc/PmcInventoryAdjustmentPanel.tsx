import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, Mail, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type { InventoryAdjustmentCycleSummary, InventoryAdjustmentEvent } from '../../services/api';

interface ApplyDraft {
  partNo: string;
  quantity: string;
  note: string;
}

interface PmcInventoryAdjustmentPanelProps {
  events: InventoryAdjustmentEvent[];
  summary: InventoryAdjustmentCycleSummary | null;
  loadingData: boolean;
  scanning: boolean;
  applyingEventId: number | null;
  rejectingEventId: number | null;
  batchRejecting: boolean;
  restoringEventId: number | null;
  deletingEventId: number | null;
  batchRestoring: boolean;
  batchDeleting: boolean;
  onScan: () => void;
  onApply: (payload: {
    eventId: number;
    partNo?: string;
    quantity?: number;
    applyNote?: string;
  }) => void;
  onReject: (payload: {
    eventId: number;
    applyNote?: string;
  }) => void;
  onRejectBatch: (payload: {
    eventIds: number[];
  }) => void;
  onRestore: (eventId: number) => void;
  onDelete: (event: InventoryAdjustmentEvent) => void;
  onRestoreBatch: (payload: {
    eventIds: number[];
  }) => void;
  onDeleteBatch: (payload: {
    eventIds: number[];
  }) => void;
}

/* ─── Helpers ─── */

const fmtDate = (v?: string | null) => {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const fmtChangeType = (v?: string) => {
  const m: Record<string, string> = { outbound: '\u51fa\u5e93', inbound: '\u5165\u5e93', return: '\u5f52\u8fd8', scrap: '\u62a5\u5e9f' };
  return m[String(v || '').trim()] || '\u5f02\u52a8';
};

const changeTypeTone: Record<string, { bg: string; text: string }> = {
  outbound: { bg: '#fef2f2', text: '#dc2626' },
  inbound: { bg: '#f0fdf4', text: '#16a34a' },
  return: { bg: '#eff6ff', text: '#2563eb' },
  scrap: { bg: '#fefce8', text: '#ca8a04' },
};

const statusMeta: Record<string, { label: string; dot: string }> = {
  pending: { label: '\u5f85\u786e\u8ba4', dot: '#f59e0b' },
  applied: { label: '\u5df2\u786e\u8ba4', dot: '#10b981' },
  rejected: { label: '\u5df2\u5ffd\u7565', dot: '#94a3b8' },
};

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '\u2026' : s);

/* ─── Component ─── */

const PmcInventoryAdjustmentPanel: React.FC<PmcInventoryAdjustmentPanelProps> = ({
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
  onScan,
  onApply,
  onReject,
  onRejectBatch,
  onRestore,
  onDelete,
  onRestoreBatch,
  onDeleteBatch,
}) => {
  const [viewMode, setViewMode] = useState<'pending' | 'all' | 'rejected'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, ApplyDraft>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [reconciliationSearch, setReconciliationSearch] = useState('');
  const [showAllReconciliation, setShowAllReconciliation] = useState(false);

  // init drafts
  useEffect(() => {
    setDrafts(() =>
      events.reduce((next: Record<number, ApplyDraft>, ev) => {
        next[ev.id] = {
          partNo: String(ev.matched_part_no || ev.part_no || '').trim(),
          quantity: ev.quantity != null ? String(ev.quantity) : '',
          note: String(ev.apply_note || '').trim(),
        };
        return next;
      }, {} as Record<number, ApplyDraft>)
    );
  }, [events]);

  // clean up selection when events change
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(events.map((e) => e.id));
      const next = new Set<number>();
      prev.forEach((id) => { if (validIds.has(id)) next.add(id); });
      return next;
    });
  }, [events]);

  const stats = useMemo(() => {
    const pending = events.filter((e) => e.status === 'pending').length;
    const applied = events.filter((e) => e.status === 'applied').length;
    const rejected = events.filter((e) => e.status === 'rejected').length;
    return { pending, applied, rejected, total: events.length };
  }, [events]);

  const visibleEvents = useMemo(() => {
    let filtered = events;
    if (viewMode === 'pending') filtered = events.filter((e) => e.status === 'pending');
    else if (viewMode === 'rejected') filtered = events.filter((e) => e.status === 'rejected');

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      filtered = filtered.filter((e) =>
        (e.subject || '').toLowerCase().includes(q) ||
        (e.part_no || '').toLowerCase().includes(q) ||
        (e.matched_part_no || '').toLowerCase().includes(q) ||
        (e.sender || '').toLowerCase().includes(q) ||
        (e.part_name || '').toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [events, viewMode, searchTerm]);

  const selectableIds = useMemo(
    () => visibleEvents
      .filter((e) => e.status === 'pending' || e.status === 'rejected')
      .map((e) => e.id),
    [visibleEvents]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  useEffect(() => {
    const selectableIdSet = new Set(selectableIds);
    setSelectedIds((prev) => {
      const next = new Set<number>();
      prev.forEach((id) => {
        if (selectableIdSet.has(id)) next.add(id);
      });
      return next;
    });
  }, [selectableIds]);

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      selectableIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateDraft = (id: number, patch: Partial<ApplyDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch } as ApplyDraft,
    }));
  };

  /* ─── Reconciliation rows filtering ─── */
  const reconciliationRows = useMemo(() => {
    if (!summary) return [];
    let rows = summary.rows;
    
    rows = rows.filter(r => 
      r.outbound_total > 0 || 
      r.scrap_total > 0 || 
      r.inbound_total > 0 || 
      r.return_total > 0 || 
      r.net_change !== 0
    );
    
    if (reconciliationSearch.trim()) {
      const q = reconciliationSearch.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.part_no.toLowerCase().includes(q) ||
        (r.part_name || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [summary, reconciliationSearch]);

  const displayReconciliationRows = showAllReconciliation
    ? reconciliationRows
    : reconciliationRows.slice(0, 15);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ═══════════════════════════════════════════════════════════
          SECTION 1: Reconciliation Dashboard
         ═══════════════════════════════════════════════════════════ */}
      {summary && (
        <section className="m-panel">
          {/* Reconciliation detail table */}
          <div style={{ padding: '20px 24px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--m-text-primary)' }}>{'\u7269\u6599\u5bf9\u8d26\u660e\u7ec6'}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={reconciliationSearch}
                    onChange={(e) => setReconciliationSearch(e.target.value)}
                    placeholder={'\u641c\u7d22\u7269\u6599\u7f16\u7801\u6216\u540d\u79f0'}
                    className="w-56 h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 pl-9 text-[13px] text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="m-table" style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th>{'\u7269\u6599\u7f16\u7801'}</th>
                  <th>{'\u7269\u6599\u540d\u79f0'}</th>
                  <th style={{ textAlign: 'right' }}>{'\u671f\u521d\u5e93\u5b58'}</th>
                  <th style={{ textAlign: 'right' }}>{'\u90ae\u4ef6\u51fa\u5e93'}</th>
                  <th style={{ textAlign: 'right' }}>{'\u90ae\u4ef6\u5165\u5e93'}</th>
                  <th style={{ textAlign: 'right' }}>{'\u90ae\u4ef6\u51c0\u53d8\u5316'}</th>
                  <th style={{ textAlign: 'right' }}>{'\u671f\u672b\u5e93\u5b58'}</th>
                  <th style={{ textAlign: 'right' }}>{'\u5dee\u5f02'}</th>
                </tr>
              </thead>
              <tbody>
                {displayReconciliationRows.map((row) => (
                  <tr key={row.part_no}>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 12 }}>{row.part_no}</td>
                    <td style={{ fontSize: 12, color: 'var(--m-text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.part_name || '-'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>{row.base_quantity}</td>
                    <td style={{ textAlign: 'right', color: '#dc2626', fontWeight: 500 }}>{row.outbound_total + row.scrap_total > 0 ? `-${row.outbound_total + row.scrap_total}` : '-'}</td>
                    <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 500 }}>{row.inbound_total + row.return_total > 0 ? `+${row.inbound_total + row.return_total}` : '-'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: row.net_change >= 0 ? '#16a34a' : '#dc2626' }}>
                      {row.net_change > 0 ? `+${row.net_change}` : row.net_change < 0 ? `${row.net_change}` : '-'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.current_quantity}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {row.is_aligned ? (
                        <span style={{ color: '#16a34a' }}>{'\u2713'}</span>
                      ) : (
                        <span style={{ color: '#dc2626' }}>
                          {row.variance > 0 ? `+${row.variance}` : `${row.variance}`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {reconciliationRows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--m-text-muted)' }}>
                      {'\u5f53\u524d\u5468\u671f\u6ca1\u6709\u9700\u8981\u5bf9\u8d26\u7684\u7269\u6599'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {reconciliationRows.length > 15 && (
            <div style={{ padding: '8px 24px 16px', textAlign: 'center' }}>
              <button
                onClick={() => setShowAllReconciliation((v) => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, color: 'var(--m-accent)' }}
              >
                {showAllReconciliation ? `\u6536\u8d77 (\u5171 ${reconciliationRows.length} \u6761)` : `\u5c55\u5f00\u5168\u90e8 (${reconciliationRows.length} \u6761)`}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════
          SECTION 2: Email Inventory Movement Stream
         ═══════════════════════════════════════════════════════════ */}
      <section className="m-panel">
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--m-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="m-title">{'\u90ae\u4ef6\u5e93\u5b58\u53d8\u52a8\u6d41\u6c34'}</h2>
              <p style={{ marginTop: 4, fontSize: 13, color: 'var(--m-text-secondary)' }}>
                {'\u786e\u8ba4\u540e\u53c2\u4e0e\u5bf9\u8d26\uff0c\u4e0d\u4fee\u6539\u5e93\u5b58\u8868'}
              </p>
            </div>
            <button
              onClick={onScan}
              disabled={scanning}
              className="m-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36 }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} className={scanning ? 'animate-spin' : ''} />
              {scanning ? '\u626b\u63cf\u4e2d...' : '\u626b\u63cf\u6700\u65b0\u90ae\u4ef6'}
            </button>
          </div>

          {/* Tabs + Stats */}
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 0, background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
              {([
                { key: 'all' as const, label: `\u5168\u90e8 (${stats.total})` },
                { key: 'pending' as const, label: `\u5f85\u786e\u8ba4 (${stats.pending})` },
                { key: 'rejected' as const, label: `\u5df2\u5ffd\u7565 (${stats.rejected})` },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setViewMode(tab.key); setSelectedIds(new Set()); setExpandedId(null); }}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: viewMode === tab.key ? 600 : 400,
                    color: viewMode === tab.key ? 'var(--m-text-primary)' : 'var(--m-text-secondary)',
                    background: viewMode === tab.key ? '#fff' : 'transparent',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    boxShadow: viewMode === tab.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={'\u641c\u7d22\u4e3b\u9898\u3001\u6599\u53f7\u3001\u53d1\u4ef6\u4eba'}
                  className="w-64 h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 pl-9 text-[13px] text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all placeholder:text-slate-400"
                />
              </div>

              {/* Batch actions */}
              {selectedIds.size > 0 && viewMode === 'pending' && (
                <button
                  onClick={() => onRejectBatch({ eventIds: Array.from(selectedIds) })}
                  disabled={batchRejecting}
                  className="m-btn-ghost"
                  style={{ height: 32, fontSize: 12, color: '#dc2626', borderColor: '#fecaca' }}
                >
                  {batchRejecting ? '\u79fb\u9664\u4e2d...' : `\u6279\u91cf\u79fb\u9664 (${selectedIds.size})`}
                </button>
              )}
              {selectedIds.size > 0 && viewMode === 'rejected' && (
                <>
                  <button
                    onClick={() => onRestoreBatch({ eventIds: Array.from(selectedIds) })}
                    disabled={batchRestoring}
                    className="m-btn-ghost"
                    style={{ height: 32, fontSize: 12, color: '#16a34a', borderColor: '#bbf7d0' }}
                  >
                    {batchRestoring ? '\u6062\u590d\u4e2d...' : `\u6279\u91cf\u6062\u590d (${selectedIds.size})`}
                  </button>
                  <button
                    onClick={() => onDeleteBatch({ eventIds: Array.from(selectedIds) })}
                    disabled={batchDeleting}
                    className="m-btn-ghost"
                    style={{ height: 32, fontSize: 12, color: '#dc2626', borderColor: '#fecaca' }}
                  >
                    {batchDeleting ? '\u5220\u9664\u4e2d...' : `\u6279\u91cf\u5220\u9664 (${selectedIds.size})`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        {loadingData && visibleEvents.length === 0 ? (
          <div className="py-24 px-6 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <RefreshCw className="w-8 h-8 text-slate-400 animate-spin" />
            </div>
            <h3 className="text-[16px] font-semibold text-slate-800 mb-2">
              {'\u6b63\u5728\u52a0\u8f7d\u90ae\u4ef6\u5e93\u5b58\u53d8\u52a8'}
            </h3>
            <p className="text-[14px] text-slate-500">
              {'\u6b63\u5728\u4ece\u6570\u636e\u5e93\u8bfb\u53d6\u5df2\u786e\u8ba4\u3001\u5f85\u786e\u8ba4\u548c\u5df2\u5ffd\u7565\u7684\u90ae\u4ef6\u5e93\u5b58\u53d8\u52a8\u8bb0\u5f55'}
            </p>
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="py-24 px-6 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Mail className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-[16px] font-semibold text-slate-800 mb-2">
              {viewMode === 'pending' ? '\u6ca1\u6709\u5f85\u786e\u8ba4\u7684\u90ae\u4ef6\u5e93\u5b58\u53d8\u52a8' : viewMode === 'rejected' ? '\u6ca1\u6709\u5df2\u5ffd\u7565\u7684\u90ae\u4ef6\u5e93\u5b58\u53d8\u52a8' : '\u8fd8\u6ca1\u6709\u4efb\u4f55\u90ae\u4ef6\u5e93\u5b58\u53d8\u52a8'}
            </h3>
            <p className="text-[14px] text-slate-500">
              {'\u70b9\u51fb\u201c\u626b\u63cf\u6700\u65b0\u90ae\u4ef6\u201d\u4ece\u90ae\u7bb1\u91cc\u62d3\u53d6\u7b26\u5408\u89c4\u5219\u7684\u9886\u6599\u6216\u5f52\u8fd8\u90ae\u4ef6'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-200/60 pb-8 relative">
            <table className="w-full text-left border-collapse whitespace-nowrap min-w-max">
              <thead className="bg-slate-50/80 border-b border-slate-200/80 backdrop-blur-sm sticky top-0 z-10">
                <tr>
                  <th className="w-[48px] py-3.5 text-center px-2">
                    {(viewMode === 'pending' || viewMode === 'rejected') && selectableIds.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 transition-colors shadow-sm cursor-pointer"
                      />
                    )}
                  </th>
                  <th className="w-[32px] py-3.5 px-2"></th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px]">{'\u53d1\u4ef6\u4eba'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px]">{'\u4e3b\u9898'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px]">{'\u7c7b\u578b'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px]">{'\u7269\u6599\u7f16\u7801'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px] text-right">{'\u6570\u91cf'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px] text-center">{'\u6765\u6e90'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px] text-center">{'\u72b6\u6001'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px]">{'\u65f6\u95f4'}</th>
                  <th className="py-3.5 px-4 text-slate-500 font-semibold text-[13px] w-[120px]">{'\u64cd\u4f5c'}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((ev) => {
                  const isExpanded = expandedId === ev.id;
                  const draft = drafts[ev.id] || { partNo: '', quantity: '', note: '' };
                  const tone = changeTypeTone[ev.change_type] || { bg: '#f8fafc', text: '#475569' };
                  const sMeta = statusMeta[ev.status] || statusMeta.pending;
                  const canApply = ev.status === 'pending';
                  const isSelectable = ev.status === 'pending' || ev.status === 'rejected';

                  return (
                    <React.Fragment key={ev.id}>
                      {/* Main row */}
                      <tr
                        className={`group cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50/60' : 'bg-white hover:bg-slate-50'} border-b border-slate-100 last:border-b-0`}
                        onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                      >
                        <td className="text-center py-4 px-2" onClick={(e) => e.stopPropagation()}>
                          {isSelectable && (viewMode === 'pending' || viewMode === 'rejected') && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(ev.id)}
                              onChange={() => toggleOne(ev.id)}
                              className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 transition-colors shadow-sm cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="py-4 px-2">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 text-slate-400" />
                            : <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                          }
                        </td>
                        <td className="py-4 px-4 text-[13.5px] font-medium text-slate-700 max-w-[160px] truncate" title={ev.sender ? ev.sender.replace(/<[^>]+>/g, '').trim() : ''}>
                          {ev.sender ? truncate(ev.sender.replace(/<[^>]+>/g, '').trim(), 16) : '-'}
                        </td>
                        <td className="py-4 px-4 text-[13.5px] font-medium text-slate-900 max-w-[280px] truncate" title={ev.subject || ''}>
                          {ev.subject || '\u672a\u547d\u540d\u90ae\u4ef6'}
                        </td>
                        <td className="py-4 px-4">
                          <span style={{
                            backgroundColor: tone.bg,
                            color: tone.text,
                          }} className="inline-block px-2.5 py-1 rounded-md text-[12px] font-semibold tracking-wide">
                            {fmtChangeType(ev.change_type)}
                          </span>
                        </td>
                        <td className="py-4 px-4 font-mono text-[13.5px] font-semibold text-slate-800">
                          {ev.matched_part_no || ev.part_no || '-'}
                        </td>
                        <td className="py-4 px-4 text-right">
                          <span className="font-bold text-[15px] text-slate-900">{ev.quantity ?? '-'}</span>
                          {ev.unit && <span className="text-[12px] font-medium text-slate-500 ml-1.5">{ev.unit}</span>}
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className={`inline-flex items-center justify-center text-[11px] font-bold px-2 py-1 rounded-full ${ev.parse_source === 'ai' ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500'}`}>
                            {ev.parse_source === 'ai' ? 'AI' : '\u89c4\u5219'}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className="inline-flex items-center justify-center gap-2 text-[12px] font-medium text-slate-600 bg-white border border-slate-200/80 px-3 py-1 rounded-full shadow-sm">
                            <span style={{ backgroundColor: sMeta.dot }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
                            {sMeta.label}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-[12.5px] text-slate-500 font-mono font-medium">{fmtDate(ev.created_at)}</td>
                        <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            {ev.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => onApply({
                                    eventId: ev.id,
                                    partNo: draft.partNo.trim() || undefined,
                                    quantity: draft.quantity.trim() ? Number(draft.quantity) : undefined,
                                    applyNote: draft.note.trim() || undefined,
                                  })}
                                  disabled={applyingEventId === ev.id}
                                  title={'\u786e\u8ba4'}
                                  className="w-8 h-8 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-700 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => onReject({ eventId: ev.id, applyNote: draft.note.trim() || undefined })}
                                  disabled={rejectingEventId === ev.id}
                                  title={'\u79fb\u9664'}
                                  className="w-8 h-8 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 flex items-center justify-center hover:bg-rose-100 hover:text-rose-700 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {ev.status === 'applied' && (
                              <button
                                onClick={() => onDelete(ev)}
                                disabled={deletingEventId === ev.id}
                                title={'\u5220\u9664'}
                                className="w-8 h-8 rounded-lg border border-rose-200 bg-white text-rose-600 flex items-center justify-center hover:bg-rose-50 hover:text-rose-700 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {ev.status === 'rejected' && (
                              <>
                                <button
                                  onClick={() => onRestore(ev.id)}
                                  disabled={restoringEventId === ev.id}
                                  title={'\u6062\u590d'}
                                  className="w-8 h-8 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 hover:text-emerald-700 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => onDelete(ev)}
                                  disabled={deletingEventId === ev.id}
                                  title={'\u5220\u9664'}
                                  className="w-8 h-8 rounded-lg border border-rose-200 bg-white text-rose-600 flex items-center justify-center hover:bg-rose-50 hover:text-rose-700 hover:shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="p-0 bg-slate-50/50 border-b border-transparent">
                            <div className="p-6 md:p-8 flex flex-col lg:flex-row gap-6 lg:gap-8">
                              {/* Left: email body */}
                              <div className="flex-1 min-w-0 flex flex-col gap-6">
                                {ev.body_text ? (
                                  <div className="bg-white border border-slate-200/60 rounded-xl p-5 shadow-sm max-h-[500px] overflow-y-auto flex flex-col w-full relative">
                                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 sticky -top-5 pb-2 pt-5 bg-white/95 backdrop-blur-sm z-10">{'\u90ae\u4ef6\u6b63\u6587'}</div>
                                    <pre className="whitespace-pre-wrap break-words text-[13px] leading-[1.8] text-slate-700 font-sans m-0">
                                      {ev.body_text}
                                    </pre>
                                  </div>
                                ) : (
                                  <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-8 flex items-center justify-center text-slate-400 text-[13px]">
                                    {'\u65e0\u90ae\u4ef6\u6b63\u6587'}
                                  </div>
                                )}
                              </div>

                              {/* Right: Parsed Info + Actions / Form */}
                              <div className="w-full lg:w-[320px] shrink-0 flex flex-col gap-5">
                                {/* Parsed Detail Card */}
                                <div className="bg-white rounded-xl border border-slate-200/60 shadow-sm overflow-hidden flex flex-col">
                                  <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                                    <h4 className="text-[13px] font-bold text-slate-800 tracking-wide">{'\u8bc6\u522b\u7ed3\u679c'}</h4>
                                  </div>
                                  <div className="p-4 border-b border-slate-100">
                                    <div className="text-[11px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{'\u8bc6\u522b\u7269\u6599'}</div>
                                    <div className="text-[14px] font-bold text-slate-900 font-mono truncate" title={ev.part_no || '-'}>{ev.part_no || '-'}</div>
                                    <div className="text-[12px] text-slate-500 mt-0.5 truncate" title={ev.part_name || '-'}>{ev.part_name || '-'}</div>
                                  </div>
                                  <div className="p-4 border-b border-slate-100">
                                    <div className="text-[11px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{'\u5339\u914d\u5e93\u5b58'}</div>
                                    <div className="text-[14px] font-bold text-slate-900 font-mono truncate" title={ev.matched_part_no || '-'}>{ev.matched_part_no || '-'}</div>
                                    <div className="text-[12px] text-slate-500 mt-0.5 truncate" title={ev.match_count > 1 ? `\u5339\u914d\u5230 ${ev.match_count} \u6761\u5019\u9009` : ev.matched_part_name || '-'}>
                                      {ev.match_count > 1 ? <span className="text-amber-600 font-medium">{`\u5339\u914d\u5230 ${ev.match_count} \u6761\u5019\u9009`}</span> : ev.matched_part_name || '-'}
                                    </div>
                                  </div>
                                  <div className="p-4 flex gap-4 border-b border-slate-100">
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[11px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{'\u7f6e\u4fe1\u5ea6'}</div>
                                      <div className="text-[16px] font-bold text-slate-900">{Math.round((ev.parse_confidence || 0) * 100)}%</div>
                                    </div>
                                    {ev.actor_name && (
                                      <div className="flex-1 min-w-0 border-l border-slate-100 pl-4">
                                        <div className="text-[11px] font-bold text-slate-400 mb-1 uppercase tracking-wider">{'\u7533\u8bf7\u4eba'}</div>
                                        <div className="text-[13px] font-bold text-slate-900 truncate" title={ev.actor_name}>{ev.actor_name}</div>
                                      </div>
                                    )}
                                  </div>
                                  {ev.apply_note && ev.status === 'applied' && (
                                    <div className="p-4 bg-emerald-50/50">
                                      <div className="text-[11px] font-bold text-emerald-600 mb-1 uppercase tracking-wider">{'\u5907\u6ce8'}</div>
                                      <div className="text-[13px] font-medium text-emerald-800 leading-relaxed" title={ev.apply_note}>{ev.apply_note}</div>
                                    </div>
                                  )}
                                </div>

                                {canApply && (
                                  <div className="bg-white border border-slate-200/60 shadow-sm rounded-xl p-6 flex flex-col gap-5 w-full">
                                    <h4 className="text-[14px] font-bold text-slate-900 tracking-wide">{'\u786e\u8ba4\u4fe1\u606f'}</h4>
                                    <div className="flex flex-col gap-4">
                                      <div>
                                        <label className="text-[12px] font-semibold text-slate-700 mb-1.5 block truncate">{'\u6599\u53f7'}</label>
                                        <input
                                          value={draft.partNo}
                                          onChange={(e) => updateDraft(ev.id, { partNo: e.target.value })}
                                          disabled={applyingEventId === ev.id}
                                          className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all font-mono"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[12px] font-semibold text-slate-700 mb-1.5 block truncate">{'\u6570\u91cf'}</label>
                                        <input
                                          type="number"
                                          min={0}
                                          step="any"
                                          value={draft.quantity}
                                          onChange={(e) => updateDraft(ev.id, { quantity: e.target.value })}
                                          disabled={applyingEventId === ev.id}
                                          className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all"
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[12px] font-semibold text-slate-700 mb-1.5 block truncate">{'\u5907\u6ce8'}</label>
                                        <textarea
                                          value={draft.note}
                                          onChange={(e) => updateDraft(ev.id, { note: e.target.value })}
                                          disabled={applyingEventId === ev.id}
                                          rows={2}
                                          className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] font-medium text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all resize-none"
                                        />
                                      </div>
                                      <div className="flex flex-col gap-2 mt-2">
                                        <button
                                          onClick={() => onApply({
                                            eventId: ev.id,
                                            partNo: draft.partNo.trim() || undefined,
                                            quantity: draft.quantity.trim() ? Number(draft.quantity) : undefined,
                                            applyNote: draft.note.trim() || undefined,
                                          })}
                                          disabled={applyingEventId === ev.id}
                                          className="w-full bg-slate-900 text-white hover:bg-slate-800 h-10 rounded-lg flex items-center justify-center gap-2 transition-all font-medium text-[13px] shadow-sm"
                                        >
                                          {applyingEventId === ev.id ? '\u786e\u8ba4\u4e2d...' : '\u786e\u8ba4\u5165\u8d26'}
                                          {applyingEventId !== ev.id && <ArrowRight className="w-4 h-4 ml-1" />}
                                        </button>
                                        <button
                                          onClick={() => onReject({ eventId: ev.id, applyNote: draft.note.trim() || undefined })}
                                          disabled={rejectingEventId === ev.id}
                                          className="w-full h-10 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center gap-2 transition-all font-medium text-[13px]"
                                        >
                                          {rejectingEventId === ev.id ? '\u79fb\u9664\u4e2d...' : '\u79fb\u9664'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {ev.status === 'rejected' && (
                                  <div className="bg-white border border-slate-200/60 rounded-xl p-6 shadow-sm">
                                    <div className="text-[13px] font-medium text-slate-600 leading-relaxed">
                                      {'\u8fd9\u6761\u90ae\u4ef6\u5e93\u5b58\u53d8\u52a8\u5df2\u5ffd\u7565\uff0c\u4e0d\u53c2\u4e0e\u5bf9\u8d26\u3002'}
                                    </div>
                                    <div className="mt-5 flex flex-col gap-2">
                                      <button
                                        onClick={() => onRestore(ev.id)}
                                        disabled={restoringEventId === ev.id}
                                        className="w-full h-10 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center gap-2 transition-all font-medium text-[13px]"
                                      >
                                        <RotateCcw className="w-4 h-4" />
                                        {restoringEventId === ev.id ? '\u6062\u590d\u4e2d...' : '\u6062\u590d\u5230\u5f85\u786e\u8ba4'}
                                      </button>
                                      <button
                                        onClick={() => onDelete(ev)}
                                        disabled={deletingEventId === ev.id}
                                        className="w-full h-10 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 flex items-center justify-center gap-2 transition-all font-medium text-[13px]"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                        {deletingEventId === ev.id ? '\u5f7b\u5e95\u5220\u9664...' : '\u5f7b\u5e95\u5220\u9664'}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default PmcInventoryAdjustmentPanel;
