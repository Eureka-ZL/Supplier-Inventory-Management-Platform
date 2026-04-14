import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type NotificationTone = 'success' | 'error' | 'info' | 'warning';

interface NotificationItem {
    id: number;
    message: string;
    tone: NotificationTone;
    duration: number;
}

type NotificationInput = {
    message: string;
    tone?: NotificationTone;
    duration?: number;
};

type Listener = (items: NotificationItem[]) => void;

const listeners = new Set<Listener>();
let notifications: NotificationItem[] = [];
let notificationId = 0;

const broadcast = () => {
    listeners.forEach((listener) => listener(notifications));
};

const dismissNotification = (id: number) => {
    notifications = notifications.filter((item) => item.id !== id);
    broadcast();
};

const showNotification = ({
    message,
    tone = 'info',
    duration = 4000,
}: NotificationInput) => {
    const item: NotificationItem = {
        id: ++notificationId,
        message,
        tone,
        duration,
    };

    notifications = [...notifications, item];
    broadcast();

    window.setTimeout(() => {
        dismissNotification(item.id);
    }, duration);

    return item.id;
};

export const notify = {
    success: (message: string, duration?: number) =>
        showNotification({ message, tone: 'success', duration }),
    error: (message: string, duration?: number) =>
        showNotification({ message, tone: 'error', duration }),
    info: (message: string, duration?: number) =>
        showNotification({ message, tone: 'info', duration }),
    warning: (message: string, duration?: number) =>
        showNotification({ message, tone: 'warning', duration }),
    dismiss: dismissNotification,
};

export const NotificationCenter: React.FC = () => {
    const [items, setItems] = useState<NotificationItem[]>(notifications);

    useEffect(() => {
        const listener: Listener = (nextItems) => setItems(nextItems);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    if (typeof document === 'undefined') return null;

    const toneMap = {
        success: {
            icon: CheckCircle2,
            panel: 'border-emerald-200 bg-emerald-50/95 text-emerald-900',
            iconBox: 'bg-emerald-100 text-emerald-600',
        },
        error: {
            icon: AlertTriangle,
            panel: 'border-rose-200 bg-rose-50/95 text-rose-900',
            iconBox: 'bg-rose-100 text-rose-600',
        },
        warning: {
            icon: AlertTriangle,
            panel: 'border-amber-200 bg-amber-50/95 text-amber-900',
            iconBox: 'bg-amber-100 text-amber-600',
        },
        info: {
            icon: Info,
            panel: 'border-sky-200 bg-sky-50/95 text-sky-900',
            iconBox: 'bg-sky-100 text-sky-600',
        },
    } as const;

    return createPortal(
        <div className="fixed top-4 right-4 z-[140] flex w-[min(92vw,420px)] flex-col gap-3 pointer-events-none">
            {items.map((item) => {
                const tone = toneMap[item.tone];
                const Icon = tone.icon;
                return (
                    <div
                        key={item.id}
                        className={`pointer-events-auto rounded-2xl border shadow-lg backdrop-blur-sm ${tone.panel} animate-in slide-in-from-top-2 fade-in duration-200`}
                    >
                        <div className="flex items-start gap-3 p-4">
                            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.iconBox}`}>
                                <Icon className="h-4 w-4" strokeWidth={2.2} />
                            </div>
                            <div className="min-w-0 flex-1 pr-2 text-sm font-medium leading-6">
                                {item.message}
                            </div>
                            <button
                                type="button"
                                onClick={() => dismissNotification(item.id)}
                                className="rounded-full p-1 text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-600"
                                aria-label="关闭提示"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>,
        document.body
    );
};
