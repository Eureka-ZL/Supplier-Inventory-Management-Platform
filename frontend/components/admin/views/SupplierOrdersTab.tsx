import React from 'react';
import { SupplierOrder, OrderStatus, SupplierDocument } from '../../../types';
import { storageApi } from '../../../services/api';
import { FileText, Sparkles, Eye, Download } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/EmptyState';
import { notify } from '../../ui/NotificationCenter';

interface SupplierOrdersTabProps {
    filteredOrders: SupplierOrder[];
    supplierDocuments: SupplierDocument[];
    selectedOrderId: string | null;
    setSelectedOrderId: (id: string | null) => void;
    setAiAnalysis: (analysis: string | null) => void;
    handleViewDocument: (orderId: string, docType: string) => void;
    handleDownloadDocument: (orderId: string, docType: string) => void;
    handleRunAnalysis: () => void;
    isGeneratingAI: boolean;
    aiAnalysis: string | null;
    handleGenerateRejectText: () => void;
    rejectReason: string;
    setRejectReason: React.Dispatch<React.SetStateAction<string>>;
    handleReject: () => void;
    handleApprove: () => void;
}

export const SupplierOrdersTab: React.FC<SupplierOrdersTabProps> = ({
    filteredOrders, supplierDocuments, selectedOrderId, setSelectedOrderId, setAiAnalysis,
    handleViewDocument, handleDownloadDocument, handleRunAnalysis,
    isGeneratingAI, aiAnalysis, handleGenerateRejectText,
    rejectReason, setRejectReason, handleReject, handleApprove
}) => {
    const supplierReachDoc = supplierDocuments.find((doc) =>
        (doc.doc_type || '').toUpperCase().includes('REACH')
    );

    return (
        <div className="animate-in fade-in duration-300">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-700">全部订单 ({filteredOrders.length})</h3>
            </div>
            <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                        <tr>
                            <th className="px-6 py-3 text-left font-medium text-slate-500">订单号</th>
                            <th className="px-6 py-3 text-left font-medium text-slate-500">物料信息</th>
                            <th className="px-6 py-3 text-left font-medium text-slate-500">当前状态</th>
                            <th className="px-6 py-3 text-right font-medium text-slate-500">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredOrders.length === 0 && (
                            <tr>
                                <td colSpan={4} className="p-8">
                                    <EmptyState
                                        icon={<FileText className="w-10 h-10 text-slate-300" />}
                                        title="暂无订单数据"
                                        description="该供应商当前没有交料申请记录。"
                                    />
                                </td>
                            </tr>
                        )}
                        {filteredOrders.map(order => (
                            <React.Fragment key={order.id}>
                                <tr className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-6 py-4 font-bold text-slate-700">{order.id}</td>
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-slate-800">{order.partName}</div>
                                        <div className="text-xs text-slate-400">{order.partNumber}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge status={order.status === OrderStatus.READY_FOR_REVIEW ? '待审核' : order.status === OrderStatus.APPROVED ? '已审核' : order.status} />
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => {
                                                if (selectedOrderId === order.id) {
                                                    setSelectedOrderId(null);
                                                } else {
                                                    setSelectedOrderId(order.id);
                                                    setAiAnalysis(null);
                                                }
                                            }}
                                            className={`px-3 py-1.5 rounded-lg transition-colors font-medium text-xs ${selectedOrderId === order.id ? 'bg-slate-100 text-slate-700' : 'text-blue-600 hover:text-blue-800 hover:bg-blue-50'}`}
                                        >
                                            {selectedOrderId === order.id ? '收起详情' : '查看详情'}
                                        </button>
                                    </td>
                                </tr>
                                {selectedOrderId === order.id && (
                                    <tr className="bg-slate-50/50">
                                        <td colSpan={4} className="p-0">
                                            <div className="p-8 border-b border-t border-slate-100 bg-white animate-in slide-in-from-top-2 duration-200">
                                                <div className="max-w-5xl mx-auto space-y-8">

                                                    {/* 1. 交付文档 (Delivery Documents) */}
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-2 border-l-4 border-slate-800 pl-3">
                                                            <h3 className="font-bold text-slate-800 text-lg">交付文档</h3>
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                            {order.documents && order.documents.map((doc) => {
                                                                const normalizedDocType = `${doc.doc_type || ''} ${doc.document_type || ''}`.toUpperCase();
                                                                const isReachDoc = normalizedDocType.includes('REACH');
                                                                const effectiveFileName = isReachDoc ? supplierReachDoc?.file_name || doc.file_name : doc.file_name;

                                                                const handlePreview = async () => {
                                                                    if (isReachDoc && supplierReachDoc?.id) {
                                                                        try {
                                                                            const url = await storageApi.getSupplierDocViewUrl(supplierReachDoc.id);
                                                                            window.open(url, '_blank');
                                                                        } catch (error: any) {
                                                                            notify.error('预览失败: ' + error.message);
                                                                        }
                                                                        return;
                                                                    }
                                                                    handleViewDocument(order.id, doc.document_type);
                                                                };

                                                                const handleDownload = async () => {
                                                                    if (isReachDoc && supplierReachDoc?.id) {
                                                                        try {
                                                                            const url = await storageApi.getSupplierDocDownloadUrl(supplierReachDoc.id);
                                                                            const link = document.createElement('a');
                                                                            link.href = url;
                                                                            link.download = '';
                                                                            document.body.appendChild(link);
                                                                            link.click();
                                                                            document.body.removeChild(link);
                                                                        } catch (error: any) {
                                                                            notify.error('下载失败: ' + error.message);
                                                                        }
                                                                        return;
                                                                    }
                                                                    handleDownloadDocument(order.id, doc.document_type);
                                                                };

                                                                return (
                                                                    <div key={doc.id} className="border border-slate-200 rounded-2xl p-4 flex items-center gap-4 hover:shadow-md transition-shadow bg-white">
                                                                        <div className="p-3 rounded-xl bg-blue-50 text-blue-500">
                                                                            <FileText className="w-6 h-6" />
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="font-bold text-slate-700 truncate mb-1" title={effectiveFileName || '待上传'}>
                                                                                {effectiveFileName || '待上传'}
                                                                            </div>
                                                                            <div className="flex items-center gap-2 text-xs text-slate-400 uppercase">
                                                                                <span>{doc.doc_type}</span>
                                                                                {isReachDoc && supplierReachDoc?.file_name && (
                                                                                    <>
                                                                                        <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                                                                        <span className="text-emerald-600 normal-case">企业资质</span>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        {effectiveFileName && (
                                                                            <div className="flex flex-col gap-1">
                                                                                <button
                                                                                    onClick={handlePreview}
                                                                                    title="预览文件"
                                                                                    className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"
                                                                                >
                                                                                    <Eye className="w-4 h-4" />
                                                                                </button>
                                                                                <button
                                                                                    onClick={handleDownload}
                                                                                    title="下载文件"
                                                                                    className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-blue-600 rounded-lg transition-colors"
                                                                                >
                                                                                    <Download className="w-4 h-4" />
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* AI Analysis */}
                                                    <div className="space-y-4">
                                                        <div className="flex items-center gap-2 border-l-4 border-indigo-500 pl-3">
                                                            <h3 className="font-bold text-slate-800 text-lg">AI 智能分析</h3>
                                                        </div>
                                                        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-6 rounded-2xl border border-indigo-100 relative overflow-hidden">
                                                            <div className="flex justify-between items-center mb-4 relative z-10">
                                                                <h3 className="text-indigo-900 font-bold text-base flex items-center gap-2">
                                                                    <Sparkles className="w-5 h-5 text-indigo-600" /> 供应商配合度分析
                                                                </h3>
                                                                <button
                                                                    onClick={handleRunAnalysis}
                                                                    disabled={isGeneratingAI}
                                                                    className="text-sm font-medium text-white bg-indigo-600 px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
                                                                >
                                                                    {isGeneratingAI ? "正在分析..." : "开始分析"}
                                                                </button>
                                                            </div>
                                                            {aiAnalysis ? (
                                                                <div className="text-sm text-indigo-900 leading-relaxed bg-white/60 p-4 rounded-xl border border-indigo-100 relative z-10 shadow-sm">
                                                                    {aiAnalysis.split('\n').map((line, i) => <p key={i} className="mb-1 last:mb-0">{line}</p>)}
                                                                </div>
                                                            ) : (
                                                                <p className="text-sm text-indigo-400 relative z-10">点击上方按钮，AI 将根据时间戳分析该订单的处理效率。</p>
                                                            )}
                                                            <Sparkles className="absolute -bottom-4 -right-4 w-32 h-32 text-indigo-500/10 rotate-12" />
                                                        </div>
                                                    </div>

                                                    {/* 2. 审核意见 (Audit Review) */}
                                                    {(order.status === '待审核' || order.status === OrderStatus.READY_FOR_REVIEW) && (
                                                        <div className="space-y-4 pt-4">
                                                            <div className="flex justify-between items-center">
                                                                <div className="flex items-center gap-2 border-l-4 border-slate-800 pl-3">
                                                                    <h3 className="font-bold text-slate-800 text-lg">审核意见</h3>
                                                                </div>
                                                                <button
                                                                    onClick={handleGenerateRejectText}
                                                                    disabled={isGeneratingAI}
                                                                    className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 text-purple-600 border border-purple-200 rounded-lg text-sm font-medium hover:bg-purple-100 transition-colors"
                                                                >
                                                                    <Sparkles className="w-4 h-4" />
                                                                    <span>AI 润色/生成</span>
                                                                </button>
                                                            </div>

                                                            <div className="relative">
                                                                <textarea
                                                                    className="w-full border border-slate-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none min-h-[200px] resize-none text-slate-600"
                                                                    placeholder="请输入审核备注，或输入关键词后点击“AI 润色”..."
                                                                    value={rejectReason}
                                                                    onChange={(e) => setRejectReason(e.target.value)}
                                                                ></textarea>
                                                            </div>

                                                            {/* Quick Tags */}
                                                            <div className="flex gap-2 mt-3">
                                                                {['+ 文档模糊', '+ 缺少 RoHS', '+ 版本过期'].map(tag => (
                                                                    <button
                                                                        key={tag}
                                                                        onClick={() => setRejectReason((prev: string) => prev + (prev ? '\n' : '') + tag.replace('+ ', ''))}
                                                                        className="px-3 py-1 bg-slate-100 text-slate-500 text-xs rounded-lg hover:bg-slate-200 transition-colors"
                                                                    >
                                                                        {tag}
                                                                    </button>
                                                                ))}
                                                            </div>

                                                            {/* Action Buttons */}
                                                            <div className="flex gap-4 pt-2">
                                                                <button
                                                                    onClick={handleReject}
                                                                    disabled={!rejectReason.trim()}
                                                                    className="flex-1 py-3.5 border border-red-100 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                                >
                                                                    驳回申请
                                                                </button>
                                                                <button
                                                                    onClick={handleApprove}
                                                                    className="flex-1 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all active:scale-[0.98]"
                                                                >
                                                                    通过审核
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Read-only Reject Reason if exists */}
                                                    {order.rejectReason && order.status !== '待审核' && order.status !== OrderStatus.READY_FOR_REVIEW && (
                                                        <div className="space-y-2">
                                                            <div className="flex items-center gap-2 border-l-4 border-red-500 pl-3">
                                                                <h3 className="font-bold text-red-800 text-lg">驳回原因</h3>
                                                            </div>
                                                            <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 whitespace-pre-wrap">
                                                                {order.rejectReason}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
