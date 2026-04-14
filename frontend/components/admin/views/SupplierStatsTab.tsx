import React from 'react';
import { Supplier, SupplierOrder } from '../../../types';
import { Clock, FileCheck, XCircle, ShieldCheck, ClipboardCheck, AlertTriangle, FileText, MoreHorizontal, Calendar, ChevronDown, ChevronRight, Plus } from 'lucide-react';

interface SupplierStatsTabProps {
    selectedSupplier: Supplier;
    filterDocType: string | null;
    setFilterDocType: (docType: string | null) => void;
    groupedOrders: Record<string, SupplierOrder[]>;
    expandedMonths: Record<string, boolean>;
    toggleMonth: (month: string) => void;
}

export const SupplierStatsTab: React.FC<SupplierStatsTabProps> = ({
    selectedSupplier, filterDocType, setFilterDocType,
    groupedOrders, expandedMonths, toggleMonth
}) => {
    return (
        <div className="h-full p-8 overflow-y-auto bg-slate-50/50" style={{ scrollbarGutter: 'stable' }}>
            {(!selectedSupplier?.orders || selectedSupplier.orders.length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                        <Clock className="w-8 h-8 text-slate-300" />
                    </div>
                    <p>暂无历史数据</p>
                </div>
            ) : (
                <div className="max-w-5xl mx-auto pb-20">
                    {/* Document Summary Dashboard */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                <FileCheck className="w-5 h-5 text-blue-500" />
                                交料汇总
                            </h3>
                            {filterDocType && (
                                <button
                                    onClick={() => setFilterDocType(null)}
                                    className="text-xs flex items-center gap-1 text-slate-500 hover:text-slate-700 bg-white border border-slate-200 px-2 py-1 rounded-full transition-colors"
                                >
                                    <XCircle className="w-3 h-3" /> 清除筛选
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            {(() => {
                                // Calculate stats inline
                                const stats = { 'RoHS': 0, 'REACH': 0, 'MSDS': 0, 'SPEC': 0, 'REPORT': 0, 'OTHER': 0 };
                                const getLabel = (type: string) => {
                                    const t = type?.toUpperCase() || '';
                                    if (t.includes('ROHS')) return 'RoHS';
                                    if (t.includes('REACH')) return 'REACH';
                                    if (t.includes('MSDS')) return 'MSDS';
                                    if (t.includes('承认书') || t.includes('SPEC')) return 'SPEC';
                                    if (t.includes('报告') || t.includes('REPORT')) return 'REPORT';
                                    return 'OTHER';
                                };

                                selectedSupplier.orders.forEach(o => o.documents?.filter(d => d.uploaded_at).forEach((d: any) => {
                                    const label = getLabel(d.document_type || d.doc_type);
                                    if (stats[label as keyof typeof stats] !== undefined) {
                                        stats[label as keyof typeof stats]++;
                                    } else {
                                        stats['OTHER']++;
                                    }
                                }));

                                const displayMap = {
                                    'RoHS': { label: 'RoHS', bg: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: ShieldCheck },
                                    'REACH': { label: 'REACH', bg: 'bg-indigo-50 text-indigo-700 border-indigo-100', icon: ClipboardCheck },
                                    'MSDS': { label: 'MSDS', bg: 'bg-amber-50 text-amber-700 border-amber-100', icon: AlertTriangle },
                                    'SPEC': { label: '承认书', bg: 'bg-blue-50 text-blue-700 border-blue-100', icon: FileText },
                                    'REPORT': { label: '检测报告', bg: 'bg-purple-50 text-purple-700 border-purple-100', icon: FileCheck },
                                    'OTHER': { label: '其他', bg: 'bg-slate-50 text-slate-700 border-slate-200', icon: MoreHorizontal },
                                };

                                return Object.entries(stats).map(([key, count]) => {
                                    const config = displayMap[key as keyof typeof displayMap];
                                    const isActive = filterDocType === key;

                                    return (
                                        <div
                                            key={key}
                                            onClick={() => setFilterDocType(isActive ? null : key)}
                                            className={`
                                            relative p-3 rounded-xl border cursor-pointer transition-all duration-200
                                            ${isActive ? 'ring-2 ring-blue-500 shadow-md transform scale-[1.02]' : 'hover:shadow-sm hover:border-blue-300'}
                                            ${config.bg} ${isActive ? 'bg-white' : ''}
                                         `}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] uppercase font-bold tracking-wider opacity-70">{config.label}</span>
                                                <config.icon className="w-4 h-4 opacity-50" />
                                            </div>
                                            <div className="text-2xl font-bold">{count}</div>
                                            {isActive && <div className="absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>}
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>

                    {/* Filtered Timeline */}
                    <div className="flex flex-col gap-6">
                        {Object.keys(groupedOrders).length === 0 ? (
                            <div className="text-center py-10 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
                                未找到相关记录
                            </div>
                        ) : (
                            Object.keys(groupedOrders)
                                .sort((a, b) => b.localeCompare(a, 'zh-CN'))
                                .map((month) => {
                                    const isExpanded = expandedMonths[month];
                                    const ordersInMonth = groupedOrders[month];

                                    return (
                                        <div key={month} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm transition-all duration-200">
                                            {/* Month Header */}
                                            <div
                                                onClick={() => toggleMonth(month)}
                                                className="flex items-center justify-between p-4 bg-slate-50/80 cursor-pointer hover:bg-slate-100 transition-colors select-none border-b border-slate-100"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                                                        <Calendar className="w-5 h-5 text-blue-500" />
                                                    </div>
                                                    <div>
                                                        <h3 className="font-bold text-slate-700 text-lg">{month}</h3>
                                                        <p className="text-xs text-slate-400">共 {ordersInMonth.length} 个任务</p>
                                                    </div>
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronDown className="w-5 h-5 text-slate-400" />
                                                ) : (
                                                    <ChevronRight className="w-5 h-5 text-slate-400" />
                                                )}
                                            </div>

                                            {/* Orders List */}
                                            {isExpanded && (
                                                <div className="p-6 bg-white">
                                                    <div className="space-y-12">
                                                        {ordersInMonth.map((order: any, idx: number) => {
                                                            if (!order) return null;

                                                            // Helper for UTC Date parsing
                                                            const parseUtcDate = (dateStr: string | null) => {
                                                                if (!dateStr) return new Date();
                                                                // If date string doesn't end with Z and doesn't have offset, assume UTC and append Z
                                                                const normalized = !dateStr.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(dateStr)
                                                                    ? `${dateStr}Z`
                                                                    : dateStr;
                                                                return new Date(normalized);
                                                            };

                                                            // Helper for duration
                                                            const getDuration = (start: string | null, end: string | null) => {
                                                                if (!start || !end) return null;
                                                                try {
                                                                    const startDate = parseUtcDate(start);
                                                                    const endDate = parseUtcDate(end);
                                                                    const diff = endDate.getTime() - startDate.getTime();

                                                                    // Hide if less than 1 minute (effectively 0 or negative)
                                                                    if (diff < 60000) return null;

                                                                    const minutes = Math.floor(diff / 60000);
                                                                    const hours = Math.floor(minutes / 60);
                                                                    const days = Math.floor(hours / 24);

                                                                    if (days > 0) return `+${days}天${hours % 24}小时`;
                                                                    if (hours > 0) return `+${hours}小时${minutes % 60}分`;
                                                                    return `+${minutes}分钟`;
                                                                } catch (e) {
                                                                    return null;
                                                                }
                                                            };

                                                            // Sort documents by uploaded_at to make a real timeline
                                                            const getDocLabel = (type: string) => {
                                                                const t = type?.toUpperCase() || '';
                                                                if (t.includes('ROHS')) return 'RoHS';
                                                                if (t.includes('REACH')) return 'REACH';
                                                                if (t.includes('MSDS')) return 'MSDS';
                                                                if (t.includes('承认书') || t.includes('SPEC')) return 'SPEC';
                                                                if (t.includes('报告') || t.includes('REPORT')) return 'REPORT';
                                                                return 'OTHER';
                                                            };

                                                            const docStyles = {
                                                                'RoHS': { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', icon: ShieldCheck },
                                                                'REACH': { dot: 'bg-indigo-500', bg: 'bg-indigo-50', text: 'text-indigo-700', icon: ClipboardCheck },
                                                                'MSDS': { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', icon: AlertTriangle },
                                                                'SPEC': { dot: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', icon: FileText },
                                                                'REPORT': { dot: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-700', icon: FileCheck },
                                                                'OTHER': { dot: 'bg-slate-400', bg: 'bg-slate-50', text: 'text-slate-700', icon: MoreHorizontal },
                                                            };

                                                            const timelineEvents = [
                                                                // 1. Order Created Event (Always show for context)
                                                                {
                                                                    type: 'create',
                                                                    date: parseUtcDate(order.createdAt),
                                                                    label: '任务创建',
                                                                    subtext: `订单号: ${order.id}`,
                                                                    icon: Plus,
                                                                    color: 'bg-blue-500',
                                                                    bg: 'bg-blue-50',
                                                                    text: 'text-blue-700',
                                                                    diff: null
                                                                },
                                                                // 2. Document Events (Filtered)
                                                                ...(order.documents || [])
                                                                    .filter((d: any) => d.uploaded_at)
                                                                    .filter((d: any) => !filterDocType || getDocLabel(d.document_type || d.doc_type) === filterDocType)
                                                                    .map((doc: any) => {
                                                                        const label = getDocLabel(doc.document_type || doc.doc_type);
                                                                        // @ts-ignore
                                                                        const style = docStyles[label] || docStyles['OTHER'];
                                                                        return {
                                                                            type: 'upload',
                                                                            date: parseUtcDate(doc.uploaded_at!),
                                                                            label: `上传文件: ${doc.document_type || doc.doc_type}`,
                                                                            subtext: null,
                                                                            icon: style.icon,
                                                                            color: style.dot,
                                                                            bg: style.bg,
                                                                            text: style.text,
                                                                            diff: getDuration(order.createdAt, doc.uploaded_at)
                                                                        };
                                                                    })
                                                            ].sort((a, b) => a.date.getTime() - b.date.getTime());

                                                            return (
                                                                <div key={order.id || idx} className="relative">
                                                                    {/* Order Card Header */}
                                                                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                                                                        <div className="flex items-center gap-3">
                                                                            <div className="font-mono font-bold text-slate-700 text-lg bg-slate-100 px-3 py-1 rounded-lg">
                                                                                {order.id}
                                                                            </div>
                                                                            <span className={`text-xs px-2.5 py-1 rounded-full font-bold
                                                      ${order.status === '已核准' ? 'bg-green-100 text-green-700' :
                                                                                    order.status === '已驳回' ? 'bg-red-100 text-red-700' :
                                                                                        'bg-amber-100 text-amber-700'}`}>
                                                                                {order.status}
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-xs text-slate-400">
                                                                            {new Date(order.createdAt).toLocaleString('zh-CN', { month: 'long', day: 'numeric' })}
                                                                        </div>
                                                                    </div>

                                                                    {/* Audit Trail Timeline */}
                                                                    <div className="pl-4 space-y-0 relative">
                                                                        {/* Continuous Vertical Line */}
                                                                        <div className="absolute left-[23px] top-2 bottom-4 w-0.5 bg-slate-100"></div>

                                                                        {timelineEvents.map((event, eventIdx) => (
                                                                            <div key={eventIdx} className="relative flex gap-6 pb-8 last:pb-0 group">
                                                                                {/* Time Column (Left) */}
                                                                                <div className="w-24 pt-1 text-right flex-shrink-0 flex flex-col items-end gap-1">
                                                                                    <div className="text-xs font-bold text-slate-600">
                                                                                        {event.date.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                                                    </div>
                                                                                    <div className="text-[10px] text-slate-400 leading-none">
                                                                                        {event.date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' })}
                                                                                    </div>
                                                                                    {event.diff && (
                                                                                        <div className="mt-1 bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium inline-block">
                                                                                            {event.diff}
                                                                                        </div>
                                                                                    )}
                                                                                </div>

                                                                                {/* Timeline Marker (Center) */}
                                                                                <div className="relative z-10">
                                                                                    <div className={`w-4 h-4 rounded-full border-2 border-white shadow-sm mt-1.5 ${event.color}`}></div>
                                                                                </div>

                                                                                {/* Content Column (Right) */}
                                                                                <div className="flex-1 pt-0.5">
                                                                                    <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100 hover:border-blue-200 transition-colors">
                                                                                        <div className={`p-2 rounded-lg ${event.bg}`}>
                                                                                            <event.icon className={`w-4 h-4 ${event.text}`} />
                                                                                        </div>
                                                                                        <div>
                                                                                            <div className="text-sm font-medium text-slate-700">{event.label}</div>
                                                                                            {event.subtext && <div className="text-xs text-slate-500 space-y-1">{event.subtext}</div>}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        ))}

                                                                        {/* Pending Items (if any docs not uploaded) */}
                                                                        {order.documents?.filter((d: any) => !d.uploaded_at).map((doc: any, docIdx: number) => (
                                                                            <div key={`pending-${docIdx}`} className="relative flex gap-6 pb-4 last:pb-0 opacity-60">
                                                                                <div className="w-24 text-right pt-1 text-xs text-slate-300">--:--</div>
                                                                                <div className="relative z-10">
                                                                                    <div className="w-4 h-4 rounded-full border-2 border-slate-200 bg-slate-100 mt-1.5"></div>
                                                                                </div>
                                                                                <div className="flex-1 pt-0.5">
                                                                                    <div className="flex items-center gap-3 border border-slate-100 border-dashed p-2 rounded-lg">
                                                                                        <FileText className="w-4 h-4 text-slate-300" />
                                                                                        <div className="text-sm text-slate-400">待上传: {doc.document_type || doc.doc_type}</div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
