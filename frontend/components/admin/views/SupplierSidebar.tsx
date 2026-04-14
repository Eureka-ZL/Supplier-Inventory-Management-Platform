import React from 'react';
import { Supplier, SupplierCategory, SupplierStats } from '../../../types';
import {
    Search, Filter, Plus, CheckCircle, X,
    Building2, Trash2, Recycle, Users
} from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/EmptyState';

interface SupplierSidebarProps {
    isSuperAdmin: boolean;
    isBatchMode: boolean;
    setIsBatchMode: (mode: boolean) => void;
    selectedSupplierIds: Set<number>;
    setSelectedSupplierIds: (ids: Set<number>) => void;
    suppliersList: Supplier[];
    handleSelectAll: (suppliers: Supplier[]) => void;
    triggerBatchSoftDelete: () => void;
    handleOpenRecycleBin: () => void;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    setSearchQuery: (query: string) => void;
    setSelectedSupplierName: (name: string | null) => void;
    setIsCreating: (creating: boolean) => void;
    filterCategory: string;
    setFilterCategory: (category: string) => void;
    stats: SupplierStats | null;
    filterStatus: string;
    onFilterChange: (status: 'all' | 'active' | 'pending' | 'incomplete') => void;
    selectedSupplierName: string | null;
    toggleSelect: (id: number) => void;
    triggerSoftDelete: (id: number, name: string) => void;
}

export const SupplierSidebar: React.FC<SupplierSidebarProps> = ({
    isSuperAdmin,
    isBatchMode, setIsBatchMode,
    selectedSupplierIds, setSelectedSupplierIds,
    suppliersList, handleSelectAll,
    triggerBatchSoftDelete, handleOpenRecycleBin,
    activeTab, setActiveTab, setSearchQuery,
    setSelectedSupplierName, setIsCreating,
    filterCategory, setFilterCategory,
    stats, filterStatus, onFilterChange,
    selectedSupplierName, toggleSelect,
    triggerSoftDelete
}) => {
    return (
        <div className="w-[340px] h-full min-h-0 bg-white rounded-3xl border border-slate-200/60 shadow-sm flex flex-col z-20 flex-shrink-0 overflow-hidden self-stretch">
            <div className="p-4 border-b bg-white">
                {isBatchMode ? (
                    <div className="flex items-center justify-between mb-4 bg-blue-50/50 p-2.5 rounded-xl border border-blue-100/50">
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                            <div className="relative flex items-center">
                                <input
                                    type="checkbox"
                                    className="peer sr-only"
                                    checked={selectedSupplierIds.size === suppliersList.length && suppliersList.length > 0}
                                    onChange={() => handleSelectAll(suppliersList)}
                                    title="全选"
                                />
                                <div className="w-5 h-5 border-2 border-slate-300 rounded-[6px] transition-colors peer-checked:border-blue-600 peer-checked:bg-blue-600 group-hover:border-blue-400 bg-white shadow-sm"></div>
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 text-white transition-opacity pointer-events-none">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </div>
                            </div>
                            <span className="font-bold text-blue-700 text-[14px] select-none">
                                已选 {selectedSupplierIds.size}
                            </span>
                        </label>
                        <div className="flex gap-2 items-center">
                            <button
                                onClick={triggerBatchSoftDelete}
                                disabled={selectedSupplierIds.size === 0}
                                className={`px-3 py-1.5 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-all shadow-sm ${selectedSupplierIds.size > 0
                                    ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 shadow-[0_2px_8px_rgba(239,68,68,0.15)] focus:ring-2 focus:ring-red-500/30 outline-none'
                                    : 'bg-slate-50/80 border border-slate-200/60 text-slate-400 cursor-not-allowed shadow-none'
                                    }`}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> 删除
                            </button>
                            <button
                                onClick={() => {
                                    setIsBatchMode(false);
                                    setSelectedSupplierIds(new Set());
                                }}
                                className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-800 rounded-lg text-slate-500 text-[13px] font-bold transition-all shadow-sm focus:ring-2 focus:ring-slate-200/50 outline-none"
                            >
                                完成
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="font-bold text-slate-800 flex items-center justify-between mb-3 h-6">
                        <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-slate-500" />
                            供应商列表
                        </div>
                        <div className="flex gap-2">
                            {isSuperAdmin && (
                                <button
                                    onClick={() => setIsBatchMode(true)}
                                    className="p-1 rounded transition-colors hover:bg-slate-200 text-slate-500 hover:text-blue-600"
                                    title="批量管理"
                                >
                                    <span className="relative">
                                        <CheckCircle className="w-4 h-4" />
                                    </span>
                                </button>
                            )}
                            {isSuperAdmin && (
                                <button
                                    onClick={handleOpenRecycleBin}
                                    className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600 transition-colors"
                                    title="打开回收站"
                                >
                                    <Recycle className="w-4 h-4" />
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setActiveTab('search');
                                    setSelectedSupplierName(null);
                                }}
                                className={`p-1.5 rounded-lg transition-colors ${activeTab === 'search'
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'hover:bg-slate-200 text-slate-500 hover:text-blue-600'}`}
                                title="全局订单查询"
                            >
                                <Search className="w-4 h-4" />
                            </button>
                            {isSuperAdmin && (
                                <button
                                    onClick={() => {
                                        setActiveTab('accounts');
                                        setSelectedSupplierName(null);
                                    }}
                                    className={`p-1.5 rounded-lg transition-colors ${activeTab === 'accounts'
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : 'hover:bg-slate-200 text-slate-500 hover:text-indigo-600'}`}
                                    title="账户管理"
                                >
                                    <Users className="w-4 h-4" />
                                </button>
                            )}
                            {isSuperAdmin && (
                                <button
                                    onClick={() => setIsCreating(true)}
                                    className="p-1.5 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                                    title="新增供应商"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-3">
                    <select
                        value={filterCategory}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterCategory(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm transition-colors hover:border-blue-300 focus:border-blue-500 outline-none truncate"
                    >
                        <option value="">全部类别 ({stats?.total_suppliers || 0})</option>
                        {Object.entries(SupplierCategory).map(([key, value]) => (
                            <option key={key} value={key}>
                                {value} ({stats?.category_counts?.[value as string] || 0})
                            </option>
                        ))}
                    </select>
                </div>

                {/* Status Filter Indicator */}
                {filterStatus !== 'all' && (
                    <div className="flex items-center justify-between px-3 py-2 mt-2 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-100">
                        <div className="flex items-center gap-1.5">
                            <Filter className="w-3.5 h-3.5" />
                            <span>
                                已过滤: {filterStatus === 'pending' ? '待审核订单' : filterStatus === 'incomplete' ? '资料缺失' : '在线业务'}
                            </span>
                        </div>
                        <button
                            onClick={() => onFilterChange('all')}
                            className="hover:bg-blue-200 p-1 rounded-full transition-colors"
                            title="清除筛选"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 p-2 space-y-2">
                {suppliersList.length === 0 ? (
                    <EmptyState
                        icon={<Search className="w-8 h-8 text-slate-300" />}
                        title="此分类/状态下查无记录"
                        description="请尝试切换或清除筛选条件"
                        className="py-12"
                    />
                ) : suppliersList.map(sup => (
                    <div
                        key={sup.id}
                        onClick={() => {
                            setSelectedSupplierName(sup.name);
                            if (activeTab === 'search') {
                                setSearchQuery('');
                                setActiveTab(sup.hasPending ? 'orders' : 'overview');
                            } else if (activeTab === 'accounts') {
                                setActiveTab(sup.hasPending ? 'orders' : 'overview');
                            }
                        }}
                        className={`rounded-2xl p-4 cursor-pointer transition-all duration-200 group relative border ${selectedSupplierName === sup.name
                            ? 'border-transparent bg-slate-100 shadow-sm'
                            : 'border-transparent hover:bg-slate-50/80 hover:border-slate-100'
                            }`}
                    >
                        <div className="flex gap-3">
                            {isBatchMode && (
                                <div
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleSelect(sup.id);
                                    }}
                                    className="pt-1.5 animate-in fade-in zoom-in duration-200 group/checkbox cursor-pointer"
                                >
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="peer sr-only"
                                            checked={selectedSupplierIds.has(sup.id)}
                                            readOnly
                                        />
                                        <div className={`w-5 h-5 border-2 rounded-[6px] transition-colors bg-white shadow-sm ${selectedSupplierIds.has(sup.id) ? 'border-blue-600 bg-blue-600' : 'border-slate-300 group-hover/checkbox:border-blue-400'}`}></div>
                                        <div className={`absolute inset-0 flex items-center justify-center transition-opacity pointer-events-none ${selectedSupplierIds.has(sup.id) ? 'opacity-100 text-white' : 'opacity-0'}`}>
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="flex-1 min-w-0 pr-1">
                                <div className="flex justify-between items-start mb-1 gap-2">
                                    <span className={`font-bold text-[15px] leading-snug break-words ${selectedSupplierName === sup.name ? 'text-blue-700' : 'text-slate-800'}`}>
                                        {sup.name}
                                    </span>
                                    <div className="flex gap-2 items-center flex-shrink-0 pt-0.5">
                                        {isSuperAdmin && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    triggerSoftDelete(sup.id, sup.name);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded text-slate-400 hover:text-red-600 transition-all"
                                                title="删除供应商"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                        {sup.hasPending && (
                                            <div className="flex items-center">
                                                <Badge status="待办" className="px-2 py-0.5 text-[10px] leading-none whitespace-nowrap" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex justify-between items-center mt-2.5">
                                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md font-medium border border-slate-200/60 truncate max-w-[120px]" title={sup.category[0]}>{sup.category[0]}</span>
                                    <span className="text-xs text-slate-400 font-medium">{sup.total_orders} 任务</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
