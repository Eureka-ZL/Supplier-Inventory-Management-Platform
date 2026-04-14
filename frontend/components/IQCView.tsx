import React, { useState } from 'react';
import { PurchaseOrder, OrderStatus } from '../types';
import { Search, PackageCheck, CheckCircle2, Truck, FileText, Eye, Download } from 'lucide-react';
import { Timeline } from './Timeline';
import { orderApi } from '../services/api';
import { ConfirmModal } from './admin/ConfirmModal';
import { notify } from './ui/NotificationCenter';

interface IQCViewProps {
    orders: PurchaseOrder[];
    onUpdateOrder: (updatedOrder: PurchaseOrder) => void;
    currentUser: string;
}

export const IQCView: React.FC<IQCViewProps> = ({ orders, onUpdateOrder, currentUser: _currentUser }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'READY' | 'HISTORY'>('READY');
    const [receivingOrderId, setReceivingOrderId] = useState<string | null>(null);

    // Filter orders based on tab and search term
    const displayedOrders = orders.filter(o => {
        // Search filter
        const matchesSearch = o.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            o.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
            o.supplierName.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        // Tab filter
        if (activeTab === 'READY') {
            return o.status === OrderStatus.APPROVED;
        } else {
            return o.status === OrderStatus.RECEIVED;
        }
    });

    const selectedOrder = orders.find(o => o.id === selectedOrderId) || null;

    const handleReceive = async () => {
        if (!selectedOrder) return;
        if (selectedOrder.status !== OrderStatus.APPROVED) return;
        setReceivingOrderId(selectedOrder.id);
    };

    const confirmReceive = async () => {
        if (!receivingOrderId) return;
        try {
            await orderApi.receiveOrder(receivingOrderId);
            const updated = await orderApi.getOrder(receivingOrderId);
            setReceivingOrderId(null);
            onUpdateOrder(updated);
        } catch (error: any) {
            notify.error('收货确认失败: ' + (error.response?.data?.detail || error.message));
        }
    };

    return (
        <div className="flex h-full bg-gray-50">
            <ConfirmModal
                isOpen={!!receivingOrderId}
                onClose={() => setReceivingOrderId(null)}
                onConfirm={confirmReceive}
                title="确认实物收货"
                message={receivingOrderId ? `确认接收 PO 单号 ${receivingOrderId} 的实物货物吗？` : ''}
                type="warning"
                confirmLabel="确认收货"
            />
            {/* Sidebar / List View */}
            <div className="w-96 bg-white border-r flex flex-col shadow-sm">
                <div className="p-4 border-b">
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <PackageCheck className="w-6 h-6 text-blue-600" />
                        IQC 收货作业
                    </h2>
                </div>

                {/* Tabs */}
                <div className="flex border-b">
                    <button
                        onClick={() => { setActiveTab('READY'); setSelectedOrderId(null); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'READY'
                            ? 'border-blue-600 text-blue-600 bg-blue-50'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        待收货 ({orders.filter(o => o.status === OrderStatus.APPROVED).length})
                    </button>
                    <button
                        onClick={() => { setActiveTab('HISTORY'); setSelectedOrderId(null); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'HISTORY'
                            ? 'border-blue-600 text-blue-600 bg-blue-50'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        收货记录
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 border-b bg-gray-50">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
                        <input
                            type="text"
                            placeholder="搜索 PO / 料号 / 供应商"
                            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Order List */}
                <div className="flex-1 overflow-y-auto">
                    {displayedOrders.length === 0 ? (
                        <div className="p-8 text-center text-gray-400 text-sm">
                            {activeTab === 'READY' ? '当前没有待收货的订单' : '暂无收货历史'}
                        </div>
                    ) : (
                        <div className="divide-y">
                            {displayedOrders.map(order => (
                                <div
                                    key={order.id}
                                    onClick={() => setSelectedOrderId(order.id)}
                                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${selectedOrderId === order.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'border-l-4 border-l-transparent'
                                        }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-gray-800 text-sm">{order.id}</span>
                                        {order.status === OrderStatus.APPROVED && (
                                            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                                                可收货
                                            </span>
                                        )}
                                        {order.status === OrderStatus.RECEIVED && (
                                            <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                                已完成
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-gray-600 mb-1">{order.supplierName}</div>
                                    <div className="text-xs text-gray-500 flex items-center gap-1">
                                        <span className="bg-gray-100 px-1.5 rounded">{order.partNumber}</span>
                                        <span className="truncate">{order.partName}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Detail Area */}
            <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
                {selectedOrder ? (
                    <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className={`p-6 text-center border-b ${selectedOrder.status === OrderStatus.APPROVED ? 'bg-green-50/50' :
                            selectedOrder.status === OrderStatus.RECEIVED ? 'bg-gray-50' : 'bg-red-50'
                            }`}>
                            {selectedOrder.status === OrderStatus.APPROVED && (
                                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                                    <CheckCircle2 className="w-8 h-8" />
                                </div>
                            )}
                            {selectedOrder.status === OrderStatus.RECEIVED && (
                                <div className="w-16 h-16 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <PackageCheck className="w-8 h-8" />
                                </div>
                            )}

                            <h1 className="text-2xl font-bold text-gray-800 mb-2">
                                {selectedOrder.status === OrderStatus.APPROVED ? '资料审核通过 - 允许收货' : selectedOrder.status}
                            </h1>
                            <p className="text-gray-500">PO: {selectedOrder.id}</p>
                        </div>

                        <div className="p-8">
                            <div className="grid grid-cols-2 gap-6 mb-8 p-4 bg-gray-50 rounded-lg border border-gray-100">
                                <div>
                                    <label className="text-xs text-gray-400 uppercase font-bold tracking-wider">供应商</label>
                                    <p className="font-medium text-gray-800">{selectedOrder.supplierName}</p>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 uppercase font-bold tracking-wider">物料信息</label>
                                    <p className="font-medium text-gray-800">{selectedOrder.partName}</p>
                                    <p className="text-sm text-gray-500">{selectedOrder.partNumber}</p>
                                </div>
                            </div>

                            {/* 文件列表 */}
                            <div className="mb-8">
                                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4" />
                                    供应商上传文件
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    {Object.values(selectedOrder.documents).map((doc: any) => (
                                        <div key={doc.type} className="border rounded-lg p-3 flex items-center justify-between group hover:border-blue-400 hover:shadow-sm transition-all">
                                            <div className="flex items-center gap-3 flex-1 overflow-hidden">
                                                <div className="p-2 bg-blue-50 text-blue-600 rounded">
                                                    <FileText className="w-5 h-5" />
                                                </div>
                                                <div className="overflow-hidden flex-1">
                                                    <p className="font-medium text-sm text-gray-700">{doc.type}</p>
                                                    <p className="text-xs text-gray-400 truncate" title={doc.fileName}>
                                                        {doc.fileName || '未上传'}
                                                    </p>
                                                </div>
                                            </div>
                                            {doc.url && (
                                                <div className="flex gap-1">
                                                    <a
                                                        href={doc.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-blue-500 hover:bg-blue-50 p-1.5 rounded transition-colors"
                                                        title="在新窗口中查看"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </a>
                                                    <a
                                                        href={doc.downloadUrl || doc.url}
                                                        className="text-green-500 hover:bg-green-50 p-1.5 rounded transition-colors"
                                                        title="下载文件"
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </a>
                                                </div>
                                            )}
                                            {!doc.url && (
                                                <span className="text-xs text-gray-300 px-2 py-1 bg-gray-50 rounded">未上传</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {selectedOrder.status === OrderStatus.APPROVED && (
                                <div className="mb-8">
                                    <button
                                        onClick={handleReceive}
                                        className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 transform active:scale-95"
                                    >
                                        <PackageCheck className="w-6 h-6" />
                                        确认实物收货 (Confirm Receipt)
                                    </button>
                                    <p className="text-center text-xs text-gray-400 mt-3">
                                        点击确认即表示您已收到实物且数量无误。
                                    </p>
                                </div>
                            )}

                            <div className="border-t pt-6">
                                <Timeline logs={selectedOrder.logs} />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <Truck className="w-16 h-16 text-gray-200 mb-4" />
                        <p>请从左侧列表选择一个订单进行作业</p>
                    </div>
                )}
            </div>
        </div>
    );
};
