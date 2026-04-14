import React, { useState } from 'react';
import { Trash2, RotateCcw } from 'lucide-react';
import { Supplier } from '../../types';
import { Modal } from '../ui/Modal';
import { EmptyState } from '../ui/EmptyState';

interface RecycleBinModalProps {
    isOpen: boolean;
    onClose: () => void;
    suppliers: Supplier[];
    onRestore: (id: number) => Promise<void>;
    onHardDelete: (id: number, name: string) => void;
    onRefresh: () => void;
}

export const RecycleBinModal: React.FC<RecycleBinModalProps> = ({
    isOpen, onClose, suppliers,
    onRestore, onHardDelete, onRefresh
}) => {
    // Internal batch selection state
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    if (!isOpen) return null;

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSelectAll = () => {
        if (selectedIds.size === suppliers.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(suppliers.map(s => s.id)));
        }
    };

    const handleBatchRestore = async () => {
        for (const id of selectedIds) {
            await onRestore(id);
        }
        setSelectedIds(new Set());
        onRefresh();
    };

    const handleBatchHardDelete = () => {
        for (const id of selectedIds) {
            const supplier = suppliers.find(s => s.id === id);
            if (supplier) onHardDelete(id, supplier.name);
        }
        setSelectedIds(new Set());
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Trash2 className="w-4 h-4 text-slate-500" />
                    </div>
                    回收站
                </div>
            }
            maxWidth="4xl"
            contentClassName="p-0 flex flex-col h-[600px] overflow-hidden bg-slate-50/30"
            footer={
                <button
                    onClick={onClose}
                    className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors"
                >
                    关闭
                </button>
            }
        >
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10 shadow-sm shrink-0">
                <div className="flex-1 flex items-center justify-between mr-8">
                    {selectedIds.size > 0 ? (
                        <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-2">
                            <span className="font-bold text-blue-700 text-lg">已选 {selectedIds.size} 项</span>
                            <div className="h-6 w-px bg-slate-200"></div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleBatchRestore}
                                    className="px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 hover:border-blue-300 font-medium flex items-center gap-2 transition-all shadow-sm"
                                >
                                    <RotateCcw className="w-4 h-4" /> 批量恢复
                                </button>
                                <button
                                    onClick={handleBatchHardDelete}
                                    className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 hover:border-red-300 font-medium flex items-center gap-2 transition-all shadow-sm"
                                >
                                    <Trash2 className="w-4 h-4" /> 批量彻底删除
                                </button>
                                <button
                                    onClick={() => setSelectedIds(new Set())}
                                    className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-red-600">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800">供应商回收站</h3>
                                <p className="text-sm text-slate-500 mt-1">管理已删除的供应商</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-auto p-8">
                {suppliers.length === 0 ? (
                    <EmptyState
                        icon={<Trash2 className="w-10 h-10 text-slate-300" />}
                        title="回收站为空"
                        description="暂时没有已删除的供应商"
                        className="h-full"
                    />
                ) : (
                    <table className="w-full text-sm text-left border rounded-lg overflow-hidden">
                        <thead className="bg-slate-50 text-slate-700 font-medium border-b">
                            <tr>
                                <th className="p-4 pl-6 w-16">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                                        checked={suppliers.length > 0 && selectedIds.size === suppliers.length}
                                        onChange={handleSelectAll}
                                    />
                                </th>
                                <th className="p-4">供应商名称</th>
                                <th className="p-4">删除时间</th>
                                <th className="p-4">备注</th>
                                <th className="p-4 text-right pr-6">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {suppliers.map(s => (
                                <tr key={s.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(s.id) ? 'bg-blue-50/50' : ''}`}>
                                    <td className="p-4 pl-6">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(s.id)}
                                            onChange={() => toggleSelect(s.id)}
                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                                        />
                                    </td>
                                    <td className="p-4 font-medium text-slate-900 flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-500 font-bold ${selectedIds.has(s.id) ? 'bg-blue-100 text-blue-600' : 'bg-slate-100'}`}>
                                            {s.name.charAt(0)}
                                        </div>
                                        {s.name}
                                    </td>
                                    <td className="p-4 text-slate-500">
                                        {s.deleted_at ? new Date(s.deleted_at).toLocaleString() : '-'}
                                    </td>
                                    <td className="p-4 text-slate-500 max-w-xs truncate">
                                        {s.notes || '-'}
                                    </td>
                                    <td className="p-4 text-right pr-6 space-x-2">
                                        <button
                                            onClick={() => onRestore(s.id)}
                                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:border-blue-500 hover:text-blue-600 transition-all font-medium shadow-sm hover:shadow"
                                        >
                                            恢复
                                        </button>
                                        <button
                                            onClick={() => onHardDelete(s.id, s.name)}
                                            className="px-3 py-1.5 bg-red-50 border border-red-100 text-red-600 rounded-lg hover:bg-red-100 hover:border-red-200 transition-all font-medium"
                                        >
                                            彻底删除
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </Modal>
    );
};
