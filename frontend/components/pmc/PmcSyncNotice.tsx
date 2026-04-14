import React from 'react';
import { X } from 'lucide-react';

interface PmcSyncNoticeProps {
  manualSyncResult: {
    status: string;
    message: string;
    email?: {
      subject?: string;
      sender?: string;
      received_at?: string | null;
    };
    attachment?: {
      file_name?: string;
    };
    inventory?: {
      part_count?: number;
    };
    parse_error?: string;
  } | null;
  dismissed: boolean;
  onDismiss: () => void;
}

const PmcSyncNotice = ({ manualSyncResult, dismissed, onDismiss }: PmcSyncNoticeProps) => {
  if (!manualSyncResult || dismissed) return null;

  const isSuccess = manualSyncResult.status === 'imported' || manualSyncResult.status === 'imported_fallback';
  const isInvalid = manualSyncResult.status === 'invalid';

  return (
    <div className={`mb-6 m-panel p-5 ${
      isSuccess ? 'bg-slate-50 border-slate-200' : isInvalid ? 'bg-rose-50/40 border-rose-100' : 'bg-amber-50/40 border-amber-100'
    }`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSuccess ? 'bg-slate-900' : isInvalid ? 'bg-rose-500' : 'bg-amber-500'}`}></div>
          <span className="text-[14px] font-semibold text-slate-900 truncate">{manualSyncResult.message}</span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/80 hover:text-slate-700"
          title="关闭提示"
          aria-label="关闭提示"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-8">
        <div className="flex flex-col">
          <span className="text-label mb-0.5">邮件主题</span>
          <span className="text-[12px] text-slate-700 truncate">{manualSyncResult.email?.subject || '-'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-label mb-0.5">发件人</span>
          <span className="text-[12px] text-slate-700 truncate">{manualSyncResult.email?.sender || '-'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-label mb-0.5">接收时间</span>
          <span className="text-[12px] text-slate-700">
            {manualSyncResult.email?.received_at ? new Date(manualSyncResult.email.received_at).toLocaleString('zh-CN') : '-'}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-label mb-0.5">附件信息</span>
          <span className="text-[12px] text-slate-700 truncate">
            {manualSyncResult.attachment?.file_name || '-'}
            {manualSyncResult.inventory?.part_count !== undefined && ` (${manualSyncResult.inventory.part_count} 物料)`}
          </span>
        </div>
      </div>

      {manualSyncResult.parse_error && (
        <div className="mt-4 pt-3 border-t border-slate-200/50 text-[12px] text-rose-600 font-medium">
          识别详情：{manualSyncResult.parse_error}
        </div>
      )}
    </div>
  );
};

export default PmcSyncNotice;
