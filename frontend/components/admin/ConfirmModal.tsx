import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    type?: 'warning' | 'danger';
    confirmLabel?: string;
    cancelLabel?: string;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    type = 'warning',
    confirmLabel,
    cancelLabel = '取消',
}) => {
    const isDanger = type === 'danger';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            maxWidth="md"
            hideCloseButton
            contentClassName="p-6"
            footer={
                <div className="flex gap-3 w-full">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors font-medium shadow-sm hover:shadow-md ${isDanger
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-orange-500 hover:bg-orange-600'
                            }`}
                    >
                        {confirmLabel || (isDanger ? '确认永久删除' : '确认删除')}
                    </button>
                </div>
            }
        >
            <div className="flex flex-col items-center text-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDanger ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                    <AlertTriangle className="w-6 h-6" />
                </div>

                <h3 className="text-xl font-bold text-slate-800 mb-2">
                    {title}
                </h3>

                <p className="text-slate-500">
                    {isDanger && <span className="text-red-600 font-medium">此操作极其危险且不可恢复！<br /></span>}
                    {message}
                </p>
            </div>
        </Modal>
    );
};
