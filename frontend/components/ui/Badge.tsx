import React from 'react';
import { OrderStatus } from '../../types';

interface BadgeProps {
    status?: OrderStatus | 'gray' | 'danger' | 'warning' | 'success' | string;
    children?: React.ReactNode;
    className?: string;
    pulse?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
    status = 'gray',
    children,
    className = '',
    pulse = false
}) => {
    let colorClass = 'bg-slate-100 border-slate-200 text-slate-600'; // default gray

    if (status === 'success' || status === OrderStatus.APPROVED || status === '已审核' || status === '已核准') {
        colorClass = 'bg-emerald-50 border-emerald-200 text-emerald-700';
    } else if (status === 'warning' || status === OrderStatus.READY_FOR_REVIEW || status === '待审核') {
        colorClass = 'bg-amber-50 border-amber-200 text-amber-700';
    } else if (status === 'danger' || status === OrderStatus.REJECTED || status === '已驳回') {
        colorClass = 'bg-rose-50 border-rose-200 text-rose-700';
    } else if (status === 'info' || status === OrderStatus.RECEIVED || status === '已接收') {
        colorClass = 'bg-blue-50 border-blue-200 text-blue-700';
    } else if (status === 'highlight') {
        colorClass = 'bg-indigo-50 border-indigo-200 text-indigo-700';
    }

    const pulseClass = pulse ? 'animate-pulse' : '';

    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClass} ${pulseClass} ${className}`}>
            {children || status}
        </span>
    );
};
