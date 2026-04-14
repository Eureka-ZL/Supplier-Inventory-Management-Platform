import React from 'react';

interface EmptyStateProps {
    icon: React.ReactNode;
    title: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon,
    title,
    description,
    action,
    className = ''
}) => {
    return (
        <div className={`flex flex-col items-center justify-center p-12 text-center h-full ${className}`}>
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-inner border border-slate-100">
                {icon}
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">
                {title}
            </h3>
            {description && (
                <div className="text-sm font-medium text-slate-500 max-w-sm mb-6">
                    {description}
                </div>
            )}
            {action && (
                <div className="mt-2">
                    {action}
                </div>
            )}
        </div>
    );
};
