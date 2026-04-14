import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    description?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
    hideCloseButton?: boolean;
    contentClassName?: string;
    headerClassName?: string;
}

export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    description,
    children,
    footer,
    maxWidth = 'md',
    hideCloseButton = false,
    contentClassName = '',
    headerClassName = ''
}) => {
    if (!isOpen) return null;
    if (typeof document === 'undefined') return null;

    const maxWidthClass = {
        'sm': 'max-w-sm',
        'md': 'max-w-md',
        'lg': 'max-w-lg',
        'xl': 'max-w-xl',
        '2xl': 'max-w-2xl',
        '3xl': 'max-w-3xl',
        '4xl': 'max-w-4xl',
        '5xl': 'max-w-5xl',
    }[maxWidth];

    return createPortal(
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="min-h-full flex items-center justify-center p-4">
                <div className={`bg-white rounded-2xl shadow-xl ${maxWidthClass} w-full max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200`}>
                    
                    {/* Header */}
                    {(title || !hideCloseButton) && (
                        <div className={`px-6 py-5 border-b flex justify-between items-start bg-slate-50/50 rounded-t-2xl backdrop-blur-md ${headerClassName}`}>
                            <div className="flex-1 pr-8">
                                {title && (
                                    typeof title === 'string' ? (
                                        <h3 className="text-xl font-bold text-slate-800">{title}</h3>
                                    ) : title
                                )}
                                {description && (
                                    typeof description === 'string' ? (
                                        <p className="text-sm text-slate-500 mt-1">{description}</p>
                                    ) : description
                                )}
                            </div>
                            {!hideCloseButton && (
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-700 mt--1"
                                    aria-label="关闭"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Content */}
                    <div className={`flex-1 overflow-y-auto p-6 ${contentClassName}`}>
                        {children}
                    </div>

                    {/* Footer */}
                    {footer && (
                        <div className="p-5 border-t bg-slate-50/80 flex justify-end gap-3 rounded-b-2xl">
                            {footer}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
