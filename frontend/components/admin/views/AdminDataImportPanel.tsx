import React, { useRef, useState } from 'react';
import { Database, FileArchive, FileSpreadsheet, Loader2, Upload } from 'lucide-react';

import { pmcAdminApi } from '../../../services/api';

type ImportFeedback = {
    type: 'success' | 'error';
    title: string;
    description: string;
    details?: string[];
};

interface AdminDataImportPanelProps {
    onBomImported?: () => void | Promise<void>;
}

export const AdminDataImportPanel: React.FC<AdminDataImportPanelProps> = ({
    onBomImported,
}) => {
    const bomInputRef = useRef<HTMLInputElement>(null);
    const supplierInputRef = useRef<HTMLInputElement>(null);

    const [uploadingBom, setUploadingBom] = useState(false);
    const [uploadingSupplier, setUploadingSupplier] = useState(false);
    const [feedback, setFeedback] = useState<ImportFeedback | null>(null);

    const triggerBomUpload = () => bomInputRef.current?.click();
    const triggerSupplierUpload = () => supplierInputRef.current?.click();

    const handleBomChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setUploadingBom(true);
        setFeedback(null);
        try {
            const result = await pmcAdminApi.uploadBomZip(file);
            const summary = result.summary || {};
            setFeedback({
                type: 'success',
                title: 'BOM 压缩包导入完成',
                description: `${result.file_name || file.name} 已写入数据库，生产环境后续将直接使用数据库 BOM。`,
                details: [
                    `Excel 文件数：${summary.file_count ?? 0}`,
                    `BOM 产品数：${summary.product_count ?? 0}`,
                    `成品机数量：${summary.finished_product_count ?? 0}`,
                    `物料总数：${summary.part_count ?? 0}`,
                ],
            });
            await onBomImported?.();
        } catch (error: any) {
            setFeedback({
                type: 'error',
                title: 'BOM 压缩包导入失败',
                description: error?.message || '请检查压缩包结构后重试。',
            });
        } finally {
            setUploadingBom(false);
        }
    };

    const handleSupplierChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setUploadingSupplier(true);
        setFeedback(null);
        try {
            const result = await pmcAdminApi.uploadSupplierExcel(file);
            const summary = result.summary || {};
            setFeedback({
                type: 'success',
                title: '供应商资料导入完成',
                description: `${result.file_name || file.name} 已全量覆盖当前有效供应商清单。`,
                details: [
                    `当前有效供应商：${summary.active_supplier_count ?? 0}`,
                    `联系人总数：${summary.contact_count ?? 0}`,
                    `本次新建供应商：${summary.created_supplier_count ?? 0}`,
                    `本次更新供应商：${summary.updated_supplier_count ?? 0}`,
                    `本次归档供应商：${summary.archived_supplier_count ?? 0}`,
                    `本次重建联系人：${summary.replaced_contact_count ?? 0}`,
                ],
            });
        } catch (error: any) {
            setFeedback({
                type: 'error',
                title: '供应商资料导入失败',
                description: error?.message || '请检查 Excel 格式后重试。',
            });
        } finally {
            setUploadingSupplier(false);
        }
    };

    return (
        <div className="rounded-[28px] border border-slate-200/70 bg-white/90 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-6 px-6 py-5 border-b border-slate-100">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shadow-sm">
                        <Database className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-[22px] font-bold text-slate-900 tracking-tight">基础资料导入</h3>
                        <p className="text-sm text-slate-500 mt-1">上传 BOM 压缩包和供应商资料后，系统会直接写入数据库作为正式基础数据。</p>
                    </div>
                </div>
                <div className="hidden xl:flex items-center gap-3 text-sm text-slate-500">
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                        <FileArchive className="w-4 h-4 text-slate-400" />
                        BOM ZIP
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                        <FileSpreadsheet className="w-4 h-4 text-slate-400" />
                        供应商 Excel
                    </span>
                </div>
            </div>

            <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
                <button
                    type="button"
                    onClick={triggerBomUpload}
                    disabled={uploadingBom || uploadingSupplier}
                    className="group rounded-3xl border border-slate-200 bg-slate-50/80 px-5 py-5 text-left transition-all hover:border-indigo-300 hover:bg-indigo-50/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-xs font-semibold tracking-[0.18em] text-slate-400">BOM 数据包</div>
                            <div className="mt-2 text-xl font-bold text-slate-900">上传 BOM 压缩包</div>
                            <div className="mt-2 text-sm leading-6 text-slate-500">支持 `.zip`，系统会自动解压并递归导入其中的 BOM Excel。</div>
                        </div>
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-indigo-600 shadow-sm transition-transform group-hover:scale-105">
                            {uploadingBom ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                        </div>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={triggerSupplierUpload}
                    disabled={uploadingBom || uploadingSupplier}
                    className="group rounded-3xl border border-slate-200 bg-slate-50/80 px-5 py-5 text-left transition-all hover:border-emerald-300 hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-xs font-semibold tracking-[0.18em] text-slate-400">供应商资料</div>
                            <div className="mt-2 text-xl font-bold text-slate-900">上传供应商 Excel</div>
                            <div className="mt-2 text-sm leading-6 text-slate-500">支持 `.xls / .xlsx`，会按上传表全量覆盖当前有效供应商与联系人资料。</div>
                        </div>
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-emerald-600 shadow-sm transition-transform group-hover:scale-105">
                            {uploadingSupplier ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                        </div>
                    </div>
                </button>
            </div>

            {feedback && (
                <div
                    className={`mx-6 mb-6 rounded-3xl border px-5 py-4 ${
                        feedback.type === 'success'
                            ? 'border-emerald-200 bg-emerald-50/70'
                            : 'border-rose-200 bg-rose-50/70'
                    }`}
                >
                    <div className={`text-base font-bold ${feedback.type === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {feedback.title}
                    </div>
                    <div className={`mt-1 text-sm ${feedback.type === 'success' ? 'text-emerald-700/80' : 'text-rose-700/80'}`}>
                        {feedback.description}
                    </div>
                    {feedback.details && feedback.details.length > 0 && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {feedback.details.map((detail) => (
                                <div
                                    key={detail}
                                    className="rounded-2xl border border-white/70 bg-white/70 px-4 py-3 text-sm font-medium text-slate-700"
                                >
                                    {detail}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <input
                ref={bomInputRef}
                type="file"
                accept=".zip"
                onChange={handleBomChange}
                className="hidden"
            />
            <input
                ref={supplierInputRef}
                type="file"
                accept=".xls,.xlsx"
                onChange={handleSupplierChange}
                className="hidden"
            />
        </div>
    );
};
