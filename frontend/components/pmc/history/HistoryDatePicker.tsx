import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

interface HistoryDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  align?: 'start' | 'end';
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const parseDateValue = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

const toDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toDisplayValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year} / ${month} / ${day}`;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date: Date, offset: number) => new Date(date.getFullYear(), date.getMonth() + offset, 1);

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const getCalendarDays = (viewMonth: Date) => {
  const monthStart = startOfMonth(viewMonth);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    date.setHours(0, 0, 0, 0);
    return {
      key: toDateValue(date),
      date,
      isCurrentMonth: date.getMonth() === viewMonth.getMonth(),
    };
  });
};

export const HistoryDatePicker: React.FC<HistoryDatePickerProps> = ({
  value,
  onChange,
  placeholder = '年 / 月 / 日',
  align = 'start',
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = useMemo(() => parseDateValue(value), [value]);
  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const base = selectedDate ?? today;
    return startOfMonth(base);
  });

  useEffect(() => {
    if (!isOpen) return;

    const syncMonth = selectedDate ?? today;
    setViewMonth(startOfMonth(syncMonth));
  }, [isOpen, selectedDate, today]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const calendarDays = useMemo(() => getCalendarDays(viewMonth), [viewMonth]);
  const displayValue = selectedDate ? toDisplayValue(selectedDate) : placeholder;

  return (
    <div ref={rootRef} className={`pmc-date-field ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className={`pmc-date-trigger ${selectedDate ? 'has-value' : ''}`}
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className={`pmc-date-trigger-text ${selectedDate ? 'has-value' : ''}`}>{displayValue}</span>
        <CalendarDays className="pmc-date-trigger-icon" />
      </button>

      {isOpen && (
        <div className={`pmc-date-popover ${align === 'end' ? 'align-end' : 'align-start'}`} role="dialog" aria-label="选择日期">
          <div className="pmc-date-popover-header">
            <div className="pmc-date-month-label">{`${viewMonth.getFullYear()}年${String(viewMonth.getMonth() + 1).padStart(2, '0')}月`}</div>
            <div className="pmc-date-nav">
              <button
                type="button"
                className="pmc-date-nav-button"
                onClick={() => setViewMonth((current) => addMonths(current, -1))}
                aria-label="上个月"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="pmc-date-nav-button"
                onClick={() => setViewMonth((current) => addMonths(current, 1))}
                aria-label="下个月"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="pmc-date-weekdays">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label} className="pmc-date-weekday">{label}</span>
            ))}
          </div>

          <div className="pmc-date-grid">
            {calendarDays.map((item) => {
              const isSelected = selectedDate ? isSameDay(item.date, selectedDate) : false;
              const isToday = isSameDay(item.date, today);
              const className = [
                'pmc-date-day',
                item.isCurrentMonth ? '' : 'is-outside',
                isToday ? 'is-today' : '',
                isSelected ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={item.key}
                  type="button"
                  className={className}
                  onClick={() => {
                    onChange(item.key);
                    setIsOpen(false);
                  }}
                >
                  {item.date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="pmc-date-actions">
            <button
              type="button"
              className="pmc-date-action is-muted"
              onClick={() => {
                onChange('');
                setIsOpen(false);
              }}
            >
              清除
            </button>
            <button
              type="button"
              className="pmc-date-action"
              onClick={() => {
                onChange(toDateValue(today));
                setViewMonth(startOfMonth(today));
                setIsOpen(false);
              }}
            >
              今天
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryDatePicker;
