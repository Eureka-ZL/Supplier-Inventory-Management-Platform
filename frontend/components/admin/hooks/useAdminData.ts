import { useState, useMemo, useEffect } from 'react';
import { Supplier, SupplierCategory, SupplierStats, PurchaseOrder, OrderStatus } from '../../../types';
import { supplierApi, storageApi, orderApi } from '../../../services/api';
import { generateRejectionEmail, analyzeDocumentStatus } from '../../../services/geminiService';
import { notify } from '../../ui/NotificationCenter';

export function useAdminData(filterStatus: 'all' | 'active' | 'pending' | 'incomplete', onStatsUpdate?: (stats: SupplierStats) => void) {
    // Data state
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [stats, setStats] = useState<SupplierStats | null>(null);
    const [allOrders, setAllOrders] = useState<PurchaseOrder[]>([]);

    // UI state for 2-column layout
    const [selectedSupplierName, setSelectedSupplierName] = useState<string | null>(null);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'stats' | 'history' | 'search' | 'accounts'>('overview');

    // Search
    const [searchQuery, setSearchQuery] = useState('');
    const [searchedOrders, setSearchedOrders] = useState<PurchaseOrder[]>([]);

    // Detail view state
    const [rejectReason, setRejectReason] = useState('');
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

    // Create form state
    const [isCreating, setIsCreating] = useState(false);
    const [filterCategory, setFilterCategory] = useState<string>('');

    // Edit form state
    const [isEditing, setIsEditing] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [editFormData, setEditFormData] = useState<any>({});

    // History Tab State
    const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
    const [filterDocType, setFilterDocType] = useState<string | null>(null);

    // Recycle Bin State
    const [isRecycleBinOpen, setIsRecycleBinOpen] = useState(false);
    const [recycleBinSuppliers, setRecycleBinSuppliers] = useState<Supplier[]>([]);

    // Batch Selection State
    const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<number>>(new Set());
    const [isBatchMode, setIsBatchMode] = useState(false);

    // Confirmation Modal State
    const [confirmAction, setConfirmAction] = useState<{
        type: 'soft_delete' | 'permanent_delete' | 'batch_soft_delete' | 'batch_permanent_delete';
        id?: number;
        name?: string;
        ids?: number[];
        count?: number;
    } | null>(null);
    const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null);
    const [deletingSupplier, setDeletingSupplier] = useState<{ id: number; name: string } | null>(null);

    const [formData, setFormData] = useState<any>({
        name: '',
        code: '',
        category: [SupplierCategory.ELECTRONICS],
        address: '',
        contacts: [{ name: '', position: '', phone: '', email: '', is_primary: true }],
        business_license: '',
        notes: '',
        is_new: false,
        is_site_inspected: false,
        create_account: true,
    });

    const fetchRecycleBin = async () => {
        try {
            const data = await supplierApi.getRecycleBin();
            setRecycleBinSuppliers(data);
        } catch (error: any) {
            notify.error('无法获取回收站数据: ' + error.message);
        }
    };

    const handleOpenRecycleBin = () => {
        setIsRecycleBinOpen(true);
        fetchRecycleBin();
        setSelectedSupplierIds(new Set());
    };

    const triggerSoftDelete = (supplierId: number, name: string) => {
        setConfirmAction({ type: 'soft_delete', id: supplierId, name });
    };

    const triggerPermanentDelete = (supplierId: number, name: string) => {
        setConfirmAction({ type: 'permanent_delete', id: supplierId, name });
    };

    const triggerBatchSoftDelete = () => {
        const ids = Array.from(selectedSupplierIds);
        if (ids.length === 0) return;
        setConfirmAction({ type: 'batch_soft_delete', ids, count: ids.length });
    };

    const triggerBatchPermanentDelete = () => {
        const ids = Array.from(selectedSupplierIds);
        if (ids.length === 0) return;
        setConfirmAction({ type: 'batch_permanent_delete', ids, count: ids.length });
    };

    const executeConfirmAction = async () => {
        if (!confirmAction) return;

        try {
            if (confirmAction.type === 'soft_delete' && confirmAction.id) {
                await supplierApi.softDeleteSupplier(confirmAction.id);
                loadData();
            } else if (confirmAction.type === 'permanent_delete' && confirmAction.id) {
                await supplierApi.permanentDeleteSupplier(confirmAction.id);
                fetchRecycleBin();
            } else if (confirmAction.type === 'batch_soft_delete' && confirmAction.ids) {
                await supplierApi.batchSoftDelete(confirmAction.ids);
                loadData();
                setSelectedSupplierIds(new Set());
            } else if (confirmAction.type === 'batch_permanent_delete' && confirmAction.ids) {
                await supplierApi.batchPermanentDelete(confirmAction.ids);
                fetchRecycleBin();
                setSelectedSupplierIds(new Set());
            }
            setConfirmAction(null);
        } catch (error: any) {
            notify.error('操作失败: ' + error.message);
        }
    };

    const handleRestore = async (supplierId: number) => {
        try {
            await supplierApi.restoreSupplier(supplierId);
            fetchRecycleBin();
            loadData();
        } catch (error: any) {
            notify.error('恢复失败: ' + error.message);
        }
    };

    const handleBatchRestore = async () => {
        const ids = Array.from(selectedSupplierIds) as number[];
        if (ids.length === 0) return;
        try {
            await supplierApi.batchRestore(ids);
            fetchRecycleBin();
            loadData();
            setSelectedSupplierIds(new Set());
            notify.success(`成功恢复 ${ids.length} 个供应商`);
        } catch (error: any) {
            notify.error('恢复失败: ' + error.message);
        }
    };

    const toggleSelect = (id: number) => {
        const newSelected = new Set(selectedSupplierIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedSupplierIds(newSelected);
    };

    const handleSelectAll = (items: Supplier[]) => {
        if (selectedSupplierIds.size === items.length && items.length > 0) {
            setSelectedSupplierIds(new Set());
        } else {
            setSelectedSupplierIds(new Set(items.map(s => s.id)));
        }
    };

    const toggleMonth = (month: string) => {
        setExpandedMonths(prev => ({
            ...prev,
            [month]: !prev[month]
        }));
    };

    useEffect(() => {
        loadData();
    }, [filterCategory]);

    useEffect(() => {
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            const results = allOrders.filter(order => {
                const idMatch = order.id?.toLowerCase().includes(query) ?? false;
                const partNumMatch = order.partNumber?.toLowerCase().includes(query) ?? false;
                const supplierMatch = order.supplierName?.toLowerCase().includes(query) ?? false;
                const partNameMatch = order.partName?.toLowerCase().includes(query) ?? false;
                return idMatch || partNumMatch || supplierMatch || partNameMatch;
            });
            setSearchedOrders(results);
        } else {
            setSearchedOrders([]);
        }
    }, [searchQuery, allOrders]);

    const loadData = async () => {
        try {
            const [suppliersData, statsData, ordersData] = await Promise.all([
                supplierApi.listSuppliers(filterCategory || undefined),
                supplierApi.getStats(),
                orderApi.getOrders(),
            ]);
            setSuppliers(suppliersData);
            setStats(statsData);
            setAllOrders(ordersData);
            if (onStatsUpdate && statsData) {
                onStatsUpdate(statsData as SupplierStats);
            }
        } catch (error: any) {
            notify.error('加载失败: ' + error.message);
        }
    };

    const suppliersList = useMemo(() => {
        let result = suppliers.map(supplier => ({
            ...supplier,
            hasPending: supplier.orders.some(o => o.status === '待审核' || o.status === OrderStatus.READY_FOR_REVIEW),
            hasMissingDocuments: !supplier.documents?.some(
                (doc) => (doc.doc_type || '').toUpperCase().includes('REACH') && !!doc.file_name
            ),
        }));

        if (filterStatus === 'active') {
            result = result.filter(s => s.is_active);
        } else if (filterStatus === 'pending') {
            result = result.filter(s => s.hasPending);
        } else if (filterStatus === 'incomplete') {
            result = result.filter(s => s.hasMissingDocuments);
        }

        return result.sort((a, b) => (b.hasPending ? 1 : 0) - (a.hasPending ? 1 : 0));
    }, [suppliers, filterStatus]);

    const matchedSuppliers = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        if (!query) return suppliersList;
        return suppliersList.filter(
            (supplier) =>
                supplier.name.toLowerCase().includes(query)
                || (supplier.code && supplier.code.toLowerCase().includes(query))
        );
    }, [suppliersList, searchQuery]);

    const selectedSupplier = suppliers.find(s => s.name === selectedSupplierName);

    const groupedOrders = useMemo(() => {
        if (!selectedSupplier?.orders) return {};
        const groups: Record<string, typeof selectedSupplier.orders> = {};

        const getDocLabel = (type: string) => {
            const t = type.toUpperCase();
            if (t.includes('ROHS')) return 'RoHS';
            if (t.includes('REACH')) return 'REACH';
            if (t.includes('MSDS')) return 'MSDS';
            if (t.includes('承认书') || t.includes('SPEC')) return 'SPEC';
            if (t.includes('报告') || t.includes('REPORT')) return 'REPORT';
            return 'OTHER';
        };

        let ordersToProcess = selectedSupplier.orders;
        if (filterDocType) {
            ordersToProcess = ordersToProcess.filter(order =>
                order.documents?.some(d => getDocLabel(d.document_type || d.doc_type) === filterDocType)
            );
        }

        ordersToProcess.forEach(order => {
            if (!order) return;
            const date = new Date(order.createdAt);
            const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(order);
        });

        return groups;
    }, [selectedSupplier, filterDocType]);

    useEffect(() => {
        if (activeTab === 'stats' && Object.keys(groupedOrders).length > 0) {
            const sortedMonths = Object.keys(groupedOrders).sort((a, b) => b.localeCompare(a, 'zh-CN'));
            if (sortedMonths.length > 0) {
                setExpandedMonths(prev => {
                    if (Object.keys(prev).length === 0) {
                        return { [sortedMonths[0]]: true };
                    }
                    return prev;
                });
            }
        }
    }, [activeTab, groupedOrders]);

    const filteredOrders = selectedSupplier?.orders || [];
    const activeOrder = filteredOrders.find(o => o.id === selectedOrderId);

    // Remove the aggressive auto-select so that when a user cliks the X button,
    // the value successfully becomes null and shows the EmptyState.
    // We only auto-select on initial data load if nothing is selected.
    useEffect(() => {
        if (!selectedSupplierName && suppliersList.length > 0 && !sessionStorage.getItem('hasInitialSupplierSelected')) {
            const prioritySupplier = suppliersList.find(s => s.hasPending) || suppliersList[0];
            setSelectedSupplierName(prioritySupplier.name);
            sessionStorage.setItem('hasInitialSupplierSelected', 'true');
        }
    }, [suppliersList, selectedSupplierName]);

    useEffect(() => {
        setSelectedOrderId(null);
    }, [selectedSupplierName]);

    useEffect(() => {
        if (!selectedSupplierName) return;
        if (!['overview', 'orders', 'stats'].includes(activeTab)) return;
        loadData();
    }, [selectedSupplierName, activeTab]);

    const getDocumentTypeLabel = (docType: string) => {
        const labels: Record<string, string> = {
            'MSDS': 'MSDS',
            'RoHS报告': 'RoHS',
            'REACH报告': 'REACH',
            '承认书': 'SPEC',
            '进料检验报告': 'REPORT',
            '其他': 'OTHER',
            '产品规格书': 'SPEC',
            'ROHS报告': 'ROHS',
            'MSDS报告': 'MSDS',
            '检测报告': 'REPORT',
        };
        return labels[docType] || docType;
    };

    const handleCreate = async () => {
        if (!formData.name.trim()) {
            notify.warning('请填写供应商名称');
            return;
        }
        try {
            await supplierApi.createSupplier(formData);
            notify.success('创建成功!');
            setIsCreating(false);
            setFormData({
                name: '',
                code: '',
                category: [SupplierCategory.ELECTRONICS],
                address: '',
                contacts: [{ name: '', position: '', phone: '', email: '', is_primary: true }],
                business_license: '',
                notes: '',
                is_new: false,
                is_site_inspected: false,
                create_account: true,
            });
            loadData();
        } catch (error: any) {
            notify.error('创建失败: ' + error.message);
        }
    };

    const handleViewDocument = async (orderId: string, docType: string) => {
        try {
            const url = await storageApi.getViewUrl(orderId, docType);
            window.open(url, '_blank');
        } catch (error: any) {
            notify.error('预览失败: ' + error.message);
        }
    };

    const handleDownloadDocument = async (orderId: string, docType: string) => {
        try {
            const url = await storageApi.getDownloadUrl(orderId, docType);
            const link = document.createElement('a');
            link.href = url;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error: any) {
            notify.error('下载失败: ' + error.message);
        }
    };

    const handleApprove = async () => {
        if (!activeOrder) return;
        setApprovingOrderId(activeOrder.id);
    };

    const confirmApprove = async () => {
        if (!approvingOrderId) return;
        try {
            await orderApi.approveOrder(approvingOrderId);
            setRejectReason('');
            setAiAnalysis(null);
            setApprovingOrderId(null);
            loadData();
        } catch (error: any) {
            notify.error('审核失败: ' + error.message);
        }
    };

    const handleGenerateRejectText = async () => {
        if (!activeOrder) return;
        setIsGeneratingAI(true);
        const missingOrBad = ["文件内容模糊/过期 (示例)"];
        const text = await generateRejectionEmail(
            activeOrder.id,
            selectedSupplierName || '',
            missingOrBad,
            rejectReason
        );
        setRejectReason(text);
        setIsGeneratingAI(false);
    };

    const handleRunAnalysis = async () => {
        if (!activeOrder) return;
        setIsGeneratingAI(true);
        const logs = activeOrder.documents
            .filter(d => d.uploaded_at)
            .map(d => ({
                timestamp: d.uploaded_at!,
                action: `上传${getDocumentTypeLabel(d.document_type)}`,
                actor: 'Supplier',
                details: d.file_name || ''
            }));
        const text = await analyzeDocumentStatus(
            activeOrder.status,
            logs,
            Object.values(activeOrder.documents || {}).filter((d: any) => d.fileName)
        );
        setAiAnalysis(text);
        setIsGeneratingAI(false);
    };

    const handleReject = async () => {
        if (!activeOrder) return;
        if (!rejectReason.trim()) {
            notify.warning("驳回必须填写原因");
            return;
        }
        try {
            await orderApi.rejectOrder(activeOrder.id, rejectReason);
            notify.success('订单已驳回');
            setRejectReason('');
            setAiAnalysis(null);
            loadData();
        } catch (error: any) {
            notify.error('驳回失败: ' + error.message);
        }
    };

    const handleDeleteSupplier = async (supplierId: number, supplierName: string) => {
        setDeletingSupplier({ id: supplierId, name: supplierName });
    };

    const confirmDeleteSupplier = async () => {
        if (!deletingSupplier) return;
        try {
            await supplierApi.deleteSupplier(deletingSupplier.id);
            notify.success('供应商已成功删除');
            setSelectedSupplierName(null);
            setSelectedOrderId(null);
            setDeletingSupplier(null);
            loadData();
        } catch (error: any) {
            notify.error('删除失败: ' + error.message);
        }
    };

    const handleEditSupplier = (supplier: Supplier) => {
        setEditingSupplier(supplier);
        setEditFormData({
            name: supplier.name,
            code: supplier.code || '',
            category: supplier.category,
            address: supplier.address || '',
            office_phone: supplier.office_phone || '',
            fax: supplier.fax || '',
            website: supplier.website || '',
            business_license: supplier.business_license || '',
            notes: supplier.notes || '',
            is_new: supplier.is_new,
            is_site_inspected: supplier.is_site_inspected,
            is_active: supplier.is_active,
            contacts: supplier.contacts || [],
        });
        setIsEditing(true);
    };

    const handleUpdateSupplier = async () => {
        if (!editingSupplier) return;
        if (!editFormData.name.trim()) {
            notify.warning('请填写供应商名称');
            return;
        }
        try {
            await supplierApi.updateSupplier(editingSupplier.id, editFormData);
            notify.success('更新成功!');
            setIsEditing(false);
            setEditingSupplier(null);
            setEditFormData({});
            loadData();
        } catch (error: any) {
            notify.error('更新失败: ' + error.message);
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditingSupplier(null);
        setEditFormData({});
    };

    const handleGenerateAccount = async (supplierId: number, _supplierName: string) => {
        const supplier = suppliers.find(s => s.id === supplierId);
        if (!supplier) return;

        try {
            if (!supplier.has_account) {
                await supplierApi.generateAccount(supplierId);
                await loadData();
                setActiveTab('overview');
            } else {
                setActiveTab('overview');
            }
        } catch (error: any) {
            notify.error('操作失败: ' + error.message);
        }
    };

    const handleResetPassword = async (supplierId: number, _supplierName: string) => {
        try {
            await supplierApi.generateAccount(supplierId);
            await loadData();
            setActiveTab('overview');
        } catch (error: any) {
            notify.error('重置密码失败: ' + error.message);
        }
    };

    return {
        // State
        suppliers, stats, allOrders,
        selectedSupplierName, setSelectedSupplierName,
        selectedOrderId, setSelectedOrderId,
        activeTab, setActiveTab,
        searchQuery, setSearchQuery,
        searchedOrders, setSearchedOrders,
        rejectReason, setRejectReason,
        isGeneratingAI, setIsGeneratingAI,
        aiAnalysis, setAiAnalysis,
        isCreating, setIsCreating,
        filterCategory, setFilterCategory,
        isEditing, setIsEditing,
        editingSupplier, setEditingSupplier,
        editFormData, setEditFormData,
        expandedMonths, setExpandedMonths,
        filterDocType, setFilterDocType,
        isRecycleBinOpen, setIsRecycleBinOpen,
        recycleBinSuppliers, setRecycleBinSuppliers,
        selectedSupplierIds, setSelectedSupplierIds,
        isBatchMode, setIsBatchMode,
        confirmAction, setConfirmAction,
        approvingOrderId, setApprovingOrderId,
        deletingSupplier, setDeletingSupplier,
        formData, setFormData,

        // Computed
        suppliersList, matchedSuppliers, selectedSupplier, groupedOrders, filteredOrders, activeOrder,

        // Actions
        fetchRecycleBin, handleOpenRecycleBin, triggerSoftDelete, triggerPermanentDelete,
        triggerBatchSoftDelete, triggerBatchPermanentDelete, executeConfirmAction,
        handleRestore, handleBatchRestore, toggleSelect, handleSelectAll, toggleMonth,
        loadData, getDocumentTypeLabel, handleCreate, handleViewDocument, handleDownloadDocument,
        handleApprove, handleGenerateRejectText, handleRunAnalysis, handleReject, handleDeleteSupplier,
        handleEditSupplier, handleUpdateSupplier, handleCancelEdit, handleGenerateAccount, handleResetPassword,
        confirmApprove, confirmDeleteSupplier
    };
}
