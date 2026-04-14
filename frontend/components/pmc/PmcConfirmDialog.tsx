import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArchiveRestore, Trash2, ShieldAlert, X } from 'lucide-react';

interface PmcConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  intent?: 'warning' | 'danger' | 'restore';
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
}

export const PmcConfirmDialog: React.FC<PmcConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  intent = 'warning',
  confirmLabel = '确认',
  cancelLabel = '取消',
  confirmDisabled = false,
  cancelDisabled = false,
}) => {
  if (!isOpen || typeof document === 'undefined') return null;

  const iconMap = {
    warning: AlertTriangle,
    danger: ShieldAlert,
    restore: ArchiveRestore,
  };

  const toneMap = {
    warning: {
      iconBg: 'bg-amber-100/50 text-amber-600',
      confirm: 'bg-slate-900 hover:bg-slate-800 text-white shadow-sm',
    },
    danger: {
      iconBg: 'bg-rose-100/50 text-rose-600',
      confirm: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm',
    },
    restore: {
      iconBg: 'bg-emerald-100/50 text-emerald-600',
      confirm: 'bg-slate-900 hover:bg-slate-800 text-white shadow-sm',
    },
  }[intent];

  const Icon = iconMap[intent];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      {/* Backdrop with Fade In animation */}
      <div 
        className="absolute inset-0 bg-slate-950/20 backdrop-blur-[4px] animate-in fade-in duration-500 ease-out"
        onClick={cancelDisabled ? undefined : onClose}
      />
      
      {/* Premium Dialog Container with Scale and Slide Up animation */}
      <div className="relative w-full max-w-[480px] bg-white rounded-[28px] shadow-[0_20px_50px_rgba(15,23,42,0.15)] border border-slate-100 overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 fade-in duration-300 ease-out fill-mode-forwards">
        
        {/* Main Content Area: Side-by-Side Layout */}
        <div className="p-8 flex gap-6">
          <div className={`shrink-0 w-12 h-12 rounded-2xl ${toneMap.iconBg} flex items-center justify-center shadow-inner`}>
            <Icon className="w-6 h-6" />
          </div>
          
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <h3 className="text-[19px] font-bold text-slate-900 tracking-tight leading-7">
                {title}
              </h3>
              <button 
                onClick={cancelDisabled ? undefined : onClose}
                disabled={cancelDisabled}
                className="mt-1 p-1.5 rounded-full text-slate-300 hover:bg-slate-50 hover:text-slate-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="mt-2 text-[14px] leading-relaxed text-slate-500 font-medium whitespace-pre-wrap">
              {message}
            </p>
          </div>
        </div>

        {/* Action Footer: Modern Aligned Design */}
        <div className="px-8 pb-8 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={cancelDisabled}
            className="h-10 px-5 rounded-xl text-slate-500 text-[13px] font-bold hover:bg-slate-50 transition-all border border-transparent hover:border-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`h-10 px-6 rounded-xl text-[13px] font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${toneMap.confirm}`}
          >
            {intent === 'danger' && <Trash2 className="w-3.5 h-3.5 inline-block mr-2 relative -top-px" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PmcConfirmDialog;
