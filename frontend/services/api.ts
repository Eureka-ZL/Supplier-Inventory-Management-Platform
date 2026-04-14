/**
 * API Service for Backend Communication
 * 
 * This service handles all HTTP requests to the FastAPI backend.
 * Base URL is configured via environment variable VITE_API_URL.
 * Default uses same-origin path so LAN clients can work with Vite proxy.
 */

import { AuthUser, InternalUserAccount, PurchaseOrder, UserRole } from '../types';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

const getSessionStorage = () => (typeof window !== 'undefined' ? window.sessionStorage : null);
const getLocalStorage = () => (typeof window !== 'undefined' ? window.localStorage : null);

// Store auth token
let authToken: string | null = getSessionStorage()?.getItem('authToken') || null;

export const setAuthToken = (token: string | null) => {
    authToken = token;
    const sessionStorage = getSessionStorage();
    const localStorage = getLocalStorage();
    if (token) {
        sessionStorage?.setItem('authToken', token);
        localStorage?.removeItem('authToken');
    } else {
        sessionStorage?.removeItem('authToken');
        localStorage?.removeItem('authToken');
    }
};

export const getAuthToken = () => authToken;

// Helper to convert DocType Chinese value to backend enum key
const docTypeToKey = (docType: string): string => {
    const docTypeMap: Record<string, string> = {
        '承认书': 'SPEC',
        'RoHS报告': 'ROHS',
        'REACH报告': 'REACH',
        'MSDS': 'MSDS',
        '进料检验报告': 'REPORT',
        '其他': 'OTHER'
    };
    return docTypeMap[docType] || docType;
};

// Helper function for API calls
async function apiCall<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
        return {} as T;
    }
    return response.json();
}

// Auth APIs
export const authApi = {
    login: async (username: string, password: string, role: UserRole) => {
        const response = await apiCall<{ access_token: string; token_type: string; user: AuthUser }>(
            '/api/auth/login',
            {
                method: 'POST',
                body: JSON.stringify({ username, password, role }),
            }
        );
        setAuthToken(response.access_token);
        return response;
    },

    getCurrentUser: async () => {
        return apiCall<AuthUser>('/api/auth/me', { method: 'GET' });
    },

    listInternalUsers: async () => {
        return apiCall<InternalUserAccount[]>('/api/auth/users', { method: 'GET' });
    },

    createInternalUser: async (payload: {
        username: string;
        password: string;
        role: UserRole.ADMIN | UserRole.IQC | UserRole.PMC;
        is_super_admin?: boolean;
    }) => {
        return apiCall<InternalUserAccount>('/api/auth/users', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    updateInternalUser: async (userId: number, payload: {
        username: string;
        is_super_admin?: boolean;
    }) => {
        return apiCall<InternalUserAccount>(`/api/auth/users/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    },

    updateInternalUserPassword: async (userId: number, payload: {
        new_password: string;
        confirm_password: string;
    }) => {
        return apiCall<{ success: boolean; message: string }>(`/api/auth/users/${userId}/password`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    },

    deleteInternalUser: async (userId: number) => {
        return apiCall<{ success: boolean; message: string }>(`/api/auth/users/${userId}`, {
            method: 'DELETE',
        });
    },

    updateMyProfile: async (payload: { username: string }) => {
        const response = await apiCall<{ access_token: string; token_type: string; user: AuthUser }>(
            '/api/auth/me/profile',
            {
                method: 'PUT',
                body: JSON.stringify(payload),
            }
        );
        setAuthToken(response.access_token);
        return response;
    },

    updateMyPassword: async (payload: {
        new_password: string;
        confirm_password: string;
    }) => {
        return apiCall<{ success: boolean; message: string }>('/api/auth/me/password', {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    },
};

// Order APIs
export const orderApi = {
    getOrders: async () => {
        return apiCall('/api/orders/', { method: 'GET' });
    },

    getOrder: async (orderId: string) => {
        return apiCall(`/api/orders/${orderId}`, { method: 'GET' });
    },

    createOrder: async (orderData: {
        id: string;
        partNumber: string;
        partName: string;
        supplierName: string;
    }) => {
        return apiCall<PurchaseOrder>('/api/orders/', {
            method: 'POST',
            body: JSON.stringify(orderData),
        });
    },

    getDocumentHistory: async (docType: string) => {
        // Convert DocType to enum key
        const typeKey = docTypeToKey(docType);
        return apiCall<any[]>(`/api/orders/history/documents?doc_type=${encodeURIComponent(typeKey)}`, { method: 'GET' });
    },

    reuseDocument: async (orderId: string, sourceDocId: number, docType: string) => {
        const typeKey = docTypeToKey(docType);
        return apiCall(`/api/orders/${orderId}/documents/reuse`, {
            method: 'POST',
            body: JSON.stringify({ sourceDocId, docType: typeKey }),
        });
    },

    uploadDocument: async (orderId: string, docType: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);

        const headers: HeadersInit = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(
            `${API_BASE_URL}/api/orders/${orderId}/upload/${encodeURIComponent(docTypeToKey(docType))}`,
            {
                method: 'POST',
                headers,
                body: formData,
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        return response.json();
    },

    deleteDocument: async (orderId: string, docType: string) => {
        return apiCall(
            `/api/orders/${orderId}/upload/${encodeURIComponent(docTypeToKey(docType))}`,
            {
                method: 'DELETE',
            }
        );
    },

    submitForReview: async (orderId: string) => {
        return apiCall(`/api/orders/${orderId}/submit`, {
            method: 'POST',
        });
    },

    approveOrder: async (orderId: string) => {
        return apiCall(`/api/orders/${orderId}/approve`, {
            method: 'POST',
        });
    },

    rejectOrder: async (orderId: string, reason: string) => {
        const formData = new FormData();
        formData.append('reason', reason);

        const headers: HeadersInit = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(
            `${API_BASE_URL}/api/orders/${orderId}/reject`,
            {
                method: 'POST',
                headers,
                body: formData,
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Reject failed' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        return response.json();
    },

    receiveOrder: async (orderId: string) => {
        return apiCall(`/api/orders/${orderId}/receive`, {
            method: 'POST',
        });
    },
};

// Supplier APIs
export const supplierApi = {
    getStats: async () => {
        return apiCall('/api/suppliers/stats', { method: 'GET' });
    },

    listSuppliers: async (category?: string, isActive?: boolean) => {
        const params = new URLSearchParams();
        if (category) params.append('category', category);
        if (isActive !== undefined) params.append('is_active', String(isActive));
        const query = params.toString();
        return apiCall(`/api/suppliers/${query ? '?' + query : ''}`, { method: 'GET' });
    },

    getSupplier: async (supplierId: number) => {
        return apiCall(`/api/suppliers/${supplierId}`, { method: 'GET' });
    },

    createSupplier: async (supplierData: any) => {
        return apiCall('/api/suppliers/', {
            method: 'POST',
            body: JSON.stringify(supplierData),
        });
    },

    updateSupplier: async (supplierId: number, supplierData: any) => {
        return apiCall(`/api/suppliers/${supplierId}`, {
            method: 'PUT',
            body: JSON.stringify(supplierData),
        });
    },

    deleteSupplier: async (supplierId: number) => {
        return apiCall(`/api/suppliers/${supplierId}`, {
            method: 'DELETE',
        });
    },

    generateAccount: async (supplierId: number) => {
        return apiCall<{ success: boolean; message: string; username: string; password: string }>(
            `/api/suppliers/${supplierId}/account`,
            {
                method: 'POST',
            }
        );
    },

    uploadDocument: async (docType: string, file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const headers: HeadersInit = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        const response = await fetch(
            `${API_BASE_URL}/api/suppliers/documents?doc_type=${encodeURIComponent(docType)}`,
            {
                method: 'POST',
                headers,
                body: formData,
            }
        );
        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }
        return response.json();
    },

    getDocuments: async () => {
        return apiCall<any[]>('/api/suppliers/documents', { method: 'GET' });
    },

    getRecycleBin: async () => {
        return apiCall<any[]>('/api/suppliers/recycle/bin', { method: 'GET' });
    },

    softDeleteSupplier: async (id: number) => {
        return apiCall(`/api/suppliers/${id}`, { method: 'DELETE' });
    },

    restoreSupplier: async (id: number) => {
        return apiCall(`/api/suppliers/${id}/restore`, { method: 'POST' });
    },

    permanentDeleteSupplier: async (id: number) => {
        return apiCall(`/api/suppliers/${id}/permanent`, { method: 'DELETE' });
    },

    batchSoftDelete: async (ids: number[]) => {
        return apiCall('/api/suppliers/batch/delete', {
            method: 'POST',
            body: JSON.stringify({ ids }),
        });
    },

    batchRestore: async (ids: number[]) => {
        return apiCall('/api/suppliers/batch/restore', {
            method: 'POST',
            body: JSON.stringify({ ids }),
        });
    },

    batchPermanentDelete: async (ids: number[]) => {
        return apiCall('/api/suppliers/batch/permanent', {
            method: 'DELETE',
            body: JSON.stringify({ ids }),
        });
    },


};

export const pmcAdminApi = {
    uploadBomZip: async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const headers: HeadersInit = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        const response = await fetch(`${API_BASE_URL}/api/pmc/admin/import/bom-zip`, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'BOM 导入失败' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }
        return response.json();
    },

    uploadSupplierExcel: async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const headers: HeadersInit = {};
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        const response = await fetch(`${API_BASE_URL}/api/pmc/admin/import/suppliers`, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: '供应商资料导入失败' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }
        return response.json();
    },
};

export interface InventoryAdjustmentEvent {
    id: number;
    gmail_message_id?: string | null;
    gmail_thread_id?: string | null;
    sender?: string | null;
    subject?: string | null;
    body_text?: string | null;
    actor_name?: string | null;
    part_no?: string | null;
    part_name?: string | null;
    change_type: string;
    quantity?: number | null;
    unit?: string | null;
    reason?: string | null;
    parse_confidence: number;
    parse_source: string;
    status: string;
    match_count: number;
    matched_part_no?: string | null;
    matched_part_name?: string | null;
    apply_note?: string | null;
    previous_record_id?: number | null;
    new_record_id?: number | null;
    created_at: string;
    updated_at: string;
    applied_at?: string | null;
    rejected_at?: string | null;
}

export interface InventoryAdjustmentScanResponse {
    success: boolean;
    created_count: number;
    skipped_count: number;
    events: Array<{
        id: number;
        gmail_message_id: string;
        source_message_id?: string;
        sender?: string;
        subject?: string;
        part_no?: string | null;
        part_name?: string | null;
        matched_part_no?: string | null;
        matched_part_name?: string | null;
        match_count: number;
        status: string;
        change_type: string;
        quantity?: number | null;
        confidence: number;
        parse_source?: string;
    }>;
}

export interface InventoryAdjustmentApplyPayload {
    event_id: number;
    part_no?: string;
    quantity?: number;
    apply_note?: string;
}

export interface InventoryAdjustmentRejectPayload {
    event_id: number;
    apply_note?: string;
}

export interface InventoryAdjustmentBulkRejectPayload {
    event_ids: number[];
    apply_note?: string;
}

export interface InventoryAdjustmentRestorePayload {
    event_id: number;
}

export interface InventoryAdjustmentBulkRestorePayload {
    event_ids: number[];
}

export interface InventoryAdjustmentBulkDeletePayload {
    event_ids: number[];
}

export interface InventoryAdjustmentCycleRecordInfo {
    id: number;
    source_email: string;
    file_name?: string | null;
    parsed_at: string;
}

export interface InventoryAdjustmentSummaryRow {
    part_no: string;
    part_name?: string | null;
    base_quantity: number;
    outbound_total: number;
    inbound_total: number;
    return_total: number;
    scrap_total: number;
    net_change: number;
    projected_quantity: number;
    current_quantity: number;
    actual_delta: number;
    variance: number;
    is_aligned: boolean;
    event_count: number;
}

export interface InventoryAdjustmentCycleSummary {
    base_record: InventoryAdjustmentCycleRecordInfo;
    latest_record: InventoryAdjustmentCycleRecordInfo;
    cycle_closed: boolean;
    confirmed_event_count: number;
    pending_event_count: number;
    totals: {
        affected_part_count: number;
        outbound_total: number;
        inbound_total: number;
        return_total: number;
        scrap_total: number;
        net_change: number;
        actual_net_change: number;
        variance_total: number;
        aligned_part_count: number;
        mismatch_part_count: number;
    };
    rows: InventoryAdjustmentSummaryRow[];
}

export const pmcApi = {
    listInventoryAdjustments: async () => {
        return apiCall<InventoryAdjustmentEvent[]>('/api/pmc/inventory-adjustments', { method: 'GET' });
    },

    getInventoryAdjustmentSummary: async () => {
        return apiCall<InventoryAdjustmentCycleSummary>('/api/pmc/inventory-adjustments/summary', { method: 'GET' });
    },

    scanInventoryAdjustments: async () => {
        return apiCall<InventoryAdjustmentScanResponse>('/api/pmc/inventory-adjustments/scan', {
            method: 'POST',
        });
    },

    applyInventoryAdjustment: async (payload: InventoryAdjustmentApplyPayload) => {
        return apiCall<{
            success: boolean;
            event_id: number;
            part_no: string;
            quantity: number;
            change_type: string;
            confirmed_at?: string | null;
        }>('/api/pmc/inventory-adjustments/apply', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    rejectInventoryAdjustment: async (payload: InventoryAdjustmentRejectPayload) => {
        return apiCall<{
            success: boolean;
            event_id: number;
            status: string;
        }>('/api/pmc/inventory-adjustments/reject', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    rejectInventoryAdjustmentsBatch: async (payload: InventoryAdjustmentBulkRejectPayload) => {
        return apiCall<{
            success: boolean;
            rejected_count: number;
            skipped_applied_count: number;
        }>('/api/pmc/inventory-adjustments/reject/batch', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    restoreInventoryAdjustment: async (payload: InventoryAdjustmentRestorePayload) => {
        return apiCall<{
            success: boolean;
            event_id: number;
            status: string;
        }>('/api/pmc/inventory-adjustments/restore', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    restoreInventoryAdjustmentsBatch: async (payload: InventoryAdjustmentBulkRestorePayload) => {
        return apiCall<{
            success: boolean;
            restored_count: number;
        }>('/api/pmc/inventory-adjustments/restore/batch', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    deleteInventoryAdjustment: async (eventId: number) => {
        return apiCall<{
            success: boolean;
            event_id: number;
            deleted_status?: string;
            rolled_back_to_record_id?: number;
            deleted_record_id?: number;
        }>(`/api/pmc/inventory-adjustments/${eventId}`, {
            method: 'DELETE',
        });
    },

    deleteInventoryAdjustmentsBatch: async (payload: InventoryAdjustmentBulkDeletePayload) => {
        return apiCall<{
            success: boolean;
            deleted_count: number;
        }>('/api/pmc/inventory-adjustments/delete/batch', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    getReconciliationStatus: async () => {
        return apiCall<{
            open_cycle: {
                id: number;
                base_record_id: number;
                closing_record_id: number | null;
                has_closing: boolean;
                status: string;
                note: string | null;
                created_at: string | null;
            } | null;
            latest_locked_cycle: {
                id: number;
                base_record_id: number;
                closing_record_id: number | null;
                status: string;
                locked_at: string | null;
                locked_by: string | null;
            } | null;
            available_closing_records: Array<{
                id: number;
                file_name: string | null;
                source_email: string;
                parsed_at: string | null;
            }>;
        }>('/api/pmc/inventory/reconciliation/status', { method: 'GET' });
    },

    lockReconciliationCycle: async (closingRecordId: number, note?: string) => {
        return apiCall<{
            success: boolean;
            message: string;
            locked_cycle: {
                id: number;
                base_record_id: number;
                closing_record_id: number | null;
                status: string;
                locked_at: string | null;
            };
            new_cycle: {
                id: number;
                base_record_id: number;
                status: string;
            };
        }>('/api/pmc/inventory/reconciliation/lock', {
            method: 'POST',
            body: JSON.stringify({ closing_record_id: closingRecordId, note: note || '' }),
        });
    },
};

// Storage APIs for file viewing and downloading
export const storageApi = {
    getViewUrl: async (orderId: string, docType: string): Promise<string> => {
        const response = await apiCall(
            `/api/orders/${orderId}/view/${encodeURIComponent(docTypeToKey(docType))}`,
            { method: 'GET' }
        ) as { url: string };
        return response.url;
    },

    getDownloadUrl: async (orderId: string, docType: string): Promise<string> => {
        const response = await apiCall(
            `/api/orders/${orderId}/download/${encodeURIComponent(docTypeToKey(docType))}`,
            { method: 'GET' }
        ) as { url: string };
        return response.url;
    },

    getSupplierDocViewUrl: async (docId: number): Promise<string> => {
        const response = await apiCall(
            `/api/suppliers/documents/${docId}/view`,
            { method: 'GET' }
        ) as { url: string };
        return response.url;
    },

    getSupplierDocDownloadUrl: async (docId: number): Promise<string> => {
        const response = await apiCall(
            `/api/suppliers/documents/${docId}/download`,
            { method: 'GET' }
        ) as { url: string };
        return response.url;
    },
};

// Generic API Wrapper for shared usage
export const api = {
    get: async <T>(endpoint: string) => apiCall<T>(endpoint, { method: 'GET' }),
    post: async <T>(endpoint: string, data: any) => apiCall<T>(endpoint, { method: 'POST', body: JSON.stringify(data) }),
};
