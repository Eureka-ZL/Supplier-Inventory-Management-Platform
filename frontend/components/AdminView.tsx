import React, { useEffect, useState } from 'react';
import { useAdminData } from './admin/hooks/useAdminData';
import { CreateSupplierModal } from './admin/CreateSupplierModal';
import { EditSupplierModal } from './admin/EditSupplierModal';
import { RecycleBinModal } from './admin/RecycleBinModal';
import { ConfirmModal } from './admin/ConfirmModal';
import { AccountManagementPanel } from './admin/views/AccountManagementPanel';
import { Building2, X } from 'lucide-react';
import { SupplierSidebar } from './admin/views/SupplierSidebar';
import { GlobalSearchPanel } from './admin/views/GlobalSearchPanel';
import { AdminDataImportPanel } from './admin/views/AdminDataImportPanel';
import { SupplierOverviewTab } from './admin/views/SupplierOverviewTab';
import { SupplierOrdersTab } from './admin/views/SupplierOrdersTab';
import { SupplierStatsTab } from './admin/views/SupplierStatsTab';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';

import { AuthUser, SupplierStats } from '../types';

interface AdminViewProps {
    currentUser: AuthUser;
    onCurrentUserUpdate: (user: AuthUser, accessToken?: string) => void;
    onStatsUpdate: (stats: SupplierStats | null) => void;
    filterStatus: 'all' | 'active' | 'pending' | 'incomplete';
    onFilterChange: (status: 'all' | 'active' | 'pending' | 'incomplete') => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ currentUser, onCurrentUserUpdate, onStatsUpdate, filterStatus, onFilterChange }) => {
    // Top-level UI state that isn't strictly business data
    const [isCreating, setIsCreating] = useState(false);
    const [isBatchMode, setIsBatchMode] = useState(false);
    const isSuperAdmin = currentUser.is_super_admin === true;

    const {
        suppliersList, matchedSuppliers, selectedSupplier, stats,
        activeTab, setActiveTab,
        selectedSupplierIds, setSelectedSupplierIds,
        filterCategory, setFilterCategory,
        searchQuery, setSearchQuery, searchedOrders,
        isRecycleBinOpen, setIsRecycleBinOpen,
        recycleBinSuppliers, fetchRecycleBin,
        confirmAction, setConfirmAction, executeConfirmAction,
        approvingOrderId, setApprovingOrderId, confirmApprove,
        deletingSupplier, setDeletingSupplier, confirmDeleteSupplier,
        selectedSupplierName, setSelectedSupplierName,
        isEditing, setIsEditing,
        editingSupplier,
        editFormData, setEditFormData,
        selectedOrderId, setSelectedOrderId,
        aiAnalysis, setAiAnalysis, isGeneratingAI,
        rejectReason, setRejectReason,
        handleSelectAll, toggleSelect,
        triggerBatchSoftDelete, handleRestore, triggerPermanentDelete,
        handleOpenRecycleBin, triggerSoftDelete,
        handleCreate, handleEditSupplier, handleUpdateSupplier,
        handleGenerateAccount, handleResetPassword,
        handleViewDocument, handleDownloadDocument,
        handleRunAnalysis, handleGenerateRejectText,
        handleReject, handleApprove,
        groupedOrders, expandedMonths, toggleMonth,
        filterDocType, setFilterDocType
    } = useAdminData(filterStatus, onStatsUpdate);

    useEffect(() => {
        if (!isSuperAdmin && activeTab === 'accounts') {
            setActiveTab(selectedSupplier ? 'orders' : 'search');
        }
    }, [activeTab, isSuperAdmin, selectedSupplier, setActiveTab]);

    let mainContent: React.ReactNode;
    if (activeTab === 'search') {
        mainContent = (
            <GlobalSearchPanel
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                setActiveTab={setActiveTab}
                searchedOrders={searchedOrders}
                matchedSuppliers={matchedSuppliers}
                suppliersList={suppliersList}
                setSelectedSupplierName={setSelectedSupplierName}
                setSelectedOrderId={setSelectedOrderId}
            />
        );
    } else if (activeTab === 'accounts' && isSuperAdmin) {
        mainContent = (
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <div
                    className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1"
                    style={{ scrollbarGutter: 'stable' }}
                >
                    <div className="shrink-0">
                        <AdminDataImportPanel />
                    </div>
                    <div className="min-h-0">
                        <AccountManagementPanel
                            currentUser={currentUser}
                            onCurrentUserUpdate={onCurrentUserUpdate}
                        />
                    </div>
                </div>
            </div>
        );
    } else if (selectedSupplier) {
        mainContent = (
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-white rounded-[32px] border border-slate-200/60 shadow-sm relative z-10">
                <div className="px-8 pt-8 pb-0 border-b border-slate-100 flex-shrink-0 relative z-20 bg-white/80 backdrop-blur-xl rounded-t-[32px]">
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md flex items-center justify-center border border-white/20">
                                <span className="text-white text-2xl font-bold tracking-wider">
                                    {selectedSupplier.name.substring(0, 1)}
                                </span>
                            </div>
                            <div className="flex flex-col justify-center">
                                <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight flex items-center gap-3">
                                    {selectedSupplier.name}
                                    {selectedSupplier.hasPending && (
                                        <Badge status="待办" className="shadow-sm border border-orange-200" />
                                    )}
                                </h2>
                                <div className="flex items-center gap-3 mt-1.5">
                                    <span className="text-sm font-medium text-slate-500 bg-slate-100/80 px-2.5 py-0.5 rounded-lg border border-slate-200/50">
                                        {selectedSupplier.category.join(', ')}
                                    </span>
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                                    <span className="text-sm font-medium text-slate-500 flex items-center gap-1.5">
                                        <Building2 className="w-4 h-4 text-slate-400" />
                                        供应商代码: <span className="font-mono text-slate-600 bg-slate-50 px-1.5 rounded border border-slate-100 relative -top-[0.5px]">{String(selectedSupplier.id).substring(0, 8).toUpperCase()}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            {isSuperAdmin && !selectedSupplier.has_account && (
                                <button
                                    onClick={() => handleGenerateAccount(selectedSupplier.id, selectedSupplier.name)}
                                    className="h-9 px-4 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-600 rounded-lg text-sm font-semibold transition-all outline-none flex items-center justify-center gap-2 border border-indigo-200/50 hover:border-indigo-300"
                                >
                                    一键开户
                                </button>
                            )}
                            {isSuperAdmin && (
                                <button
                                    onClick={() => handleEditSupplier(selectedSupplier)}
                                    className="h-9 px-4 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium transition-all shadow-sm outline-none flex items-center justify-center gap-2 border border-slate-700 hover:border-slate-800"
                                >
                                    编辑档案
                                </button>
                            )}
                            <button
                                onClick={() => setSelectedSupplierName(null)}
                                className="h-9 w-9 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-600 rounded-lg transition-all outline-none flex items-center justify-center border border-slate-200 shadow-sm"
                                title="关闭详情面板"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-8 border-b-2 border-transparent">
                        {[
                            { id: 'overview', label: '企业档案' },
                            {
                                id: 'orders', label: '交料任务', count: selectedSupplier.total_orders, badge: selectedSupplier.hasPending ? (
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500 text-white shadow-sm border border-orange-600/20">
                                        待办
                                    </span>
                                ) : null
                            },
                            { id: 'stats', label: '行为统计' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`pb-4 relative text-[15px] font-bold transition-all duration-200 flex items-center gap-2 justify-center
                            ${activeTab === tab.id ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                {tab.label}
                                {tab.count !== undefined && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${activeTab === tab.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                        {tab.count}
                                    </span>
                                )}
                                {tab.badge}
                                {activeTab === tab.id && (
                                    <span className="absolute bottom-[-1.5px] left-0 right-0 h-[3px] bg-blue-600 rounded-t-full shadow-[0_0_8px_rgba(37,99,235,0.4)]"></span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50/50 relative z-0 p-6 md:p-8" style={{ scrollbarGutter: 'stable' }}>
                    {activeTab === 'overview' && (
                        <SupplierOverviewTab
                            selectedSupplier={selectedSupplier}
                            isSuperAdmin={isSuperAdmin}
                            handleResetPassword={handleResetPassword}
                        />
                    )}

                    {activeTab === 'orders' && (
                        <SupplierOrdersTab
                            filteredOrders={selectedSupplier.orders || []}
                            supplierDocuments={selectedSupplier.documents || []}
                            selectedOrderId={selectedOrderId}
                            setSelectedOrderId={setSelectedOrderId}
                            setAiAnalysis={setAiAnalysis}
                            handleViewDocument={handleViewDocument}
                            handleDownloadDocument={handleDownloadDocument}
                            handleRunAnalysis={handleRunAnalysis}
                            isGeneratingAI={isGeneratingAI}
                            aiAnalysis={aiAnalysis}
                            handleGenerateRejectText={handleGenerateRejectText}
                            rejectReason={rejectReason}
                            setRejectReason={setRejectReason}
                            handleReject={handleReject}
                            handleApprove={handleApprove}
                        />
                    )}

                    {activeTab === 'stats' && (
                        <SupplierStatsTab
                            selectedSupplier={selectedSupplier}
                            filterDocType={filterDocType}
                            setFilterDocType={setFilterDocType}
                            groupedOrders={groupedOrders}
                            expandedMonths={expandedMonths}
                            toggleMonth={toggleMonth}
                        />
                    )}
                </div>
            </div>
        );
    } else {
        mainContent = (
            <div className="flex-1 bg-white rounded-[32px] border border-slate-200/60 shadow-sm flex items-center justify-center p-12">
                <EmptyState
                    icon={<Building2 className="w-10 h-10 text-slate-300" />}
                    title="请在左侧选择供应商"
                    description="查看档案、交料单详情、处理待办、以及进行供应商活动分析。"
                />
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 bg-slate-50/50 p-0 gap-6 overflow-hidden items-stretch">
            {/* 1. Modals */}
            <CreateSupplierModal
                isOpen={isCreating}
                onClose={() => setIsCreating(false)}
                onSubmit={handleCreate}
            />
            {selectedSupplier && (
                <EditSupplierModal
                    isOpen={isEditing}
                    onClose={() => setIsEditing(false)}
                    editingSupplier={editingSupplier}
                    editFormData={editFormData}
                    setEditFormData={setEditFormData}
                    handleUpdateSupplier={handleUpdateSupplier}
                />
            )}
            <RecycleBinModal
                isOpen={isRecycleBinOpen}
                onClose={() => setIsRecycleBinOpen(false)}
                suppliers={recycleBinSuppliers}
                onRestore={handleRestore}
                onHardDelete={triggerPermanentDelete}
                onRefresh={fetchRecycleBin}
            />
            <ConfirmModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={executeConfirmAction}
                title={
                    confirmAction?.type === 'soft_delete' ? '移至回收站' :
                    confirmAction?.type === 'permanent_delete' ? '彻底删除' :
                    confirmAction?.type === 'batch_soft_delete' ? '批量移至回收站' :
                    '批量彻底删除'
                }
                message={
                    confirmAction?.type === 'soft_delete' ? `确定要将 "${confirmAction?.name}" 移至回收站吗？` :
                    confirmAction?.type === 'permanent_delete' ? `确定要彻底删除 "${confirmAction?.name}" 吗？此操作无法恢复！` :
                    confirmAction?.type === 'batch_soft_delete' ? `确定要将选中的 ${confirmAction?.count} 个供应商移至回收站吗？` :
                    `确定要彻底删除选中的 ${confirmAction?.count} 个供应商吗？此操作无法恢复！`
                }
                type={confirmAction?.type?.includes('permanent') ? 'danger' : 'warning'}
            />
            <ConfirmModal
                isOpen={!!approvingOrderId}
                onClose={() => setApprovingOrderId(null)}
                onConfirm={confirmApprove}
                title="确认通过审核"
                message={approvingOrderId ? `确定要核准订单 ${approvingOrderId} 吗？核准后，IQC 将可以执行收货。` : ''}
                type="warning"
                confirmLabel="确认通过"
            />
            <ConfirmModal
                isOpen={!!deletingSupplier}
                onClose={() => setDeletingSupplier(null)}
                onConfirm={() => { void confirmDeleteSupplier(); }}
                title="确认删除供应商"
                message={
                    deletingSupplier
                        ? `确定要删除供应商“${deletingSupplier.name}”吗？如果该供应商有关联订单将无法删除，删除后会同时移除该供应商的登录账户，且此操作不可恢复。`
                        : ''
                }
                type="danger"
                confirmLabel="确认删除"
            />

            {/* 2. Left Sidebar (Supplier List) */}
            <SupplierSidebar
                isSuperAdmin={isSuperAdmin}
                isBatchMode={isBatchMode}
                setIsBatchMode={setIsBatchMode}
                selectedSupplierIds={selectedSupplierIds}
                setSelectedSupplierIds={setSelectedSupplierIds}
                suppliersList={suppliersList}
                handleSelectAll={handleSelectAll}
                triggerBatchSoftDelete={triggerBatchSoftDelete}
                handleOpenRecycleBin={handleOpenRecycleBin}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                setSearchQuery={setSearchQuery}
                setSelectedSupplierName={setSelectedSupplierName}
                setIsCreating={setIsCreating}
                filterCategory={filterCategory}
                setFilterCategory={setFilterCategory}
                stats={stats}
                filterStatus={filterStatus}
                onFilterChange={onFilterChange}
                selectedSupplierName={selectedSupplierName}
                toggleSelect={toggleSelect}
                triggerSoftDelete={triggerSoftDelete}
            />

            <div className="flex-1 min-h-0 flex flex-col gap-4">{mainContent}</div>
        </div>
    );
};
