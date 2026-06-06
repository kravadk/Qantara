import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  disabled?: boolean;
  minDate?: string;
  placeholder?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DatePicker({ value, onChange, disabled, minDate, placeholder = 'Select date' }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => value ? new Date(value).getFullYear() : new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? new Date(value).getMonth() : new Date().getMonth());
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Position dropdown relative to trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 380;
    setPos({
      top: openUp ? rect.top - 8 : rect.bottom + 8,
      left: rect.left,
      openUp,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const minDateObj = minDate ? new Date(minDate) : null;
  const selectedDate = value ? new Date(value) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isDisabledDay = (day: number) => {
    if (!minDateObj) return false;
    const d = new Date(viewYear, viewMonth, day);
    const min = new Date(minDateObj);
    min.setHours(0, 0, 0, 0);
    return d < min;
  };

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    return selectedDate.getFullYear() === viewYear && selectedDate.getMonth() === viewMonth && selectedDate.getDate() === day;
  };

  const isToday = (day: number) => {
    return today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;
  };

  const handleSelect = (day: number) => {
    if (isDisabledDay(day)) return;
    // Format as YYYY-MM-DD without timezone conversion
    const yyyy = String(viewYear);
    const mm = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${yyyy}-${mm}-${dd}`);
    setIsOpen(false);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const displayValue = value
    ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const dropdown = isOpen ? createPortal(
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: pos.openUp ? undefined : pos.top,
        bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
        left: pos.left,
        zIndex: 99999,
      }}
      className="w-[300px] bg-surface-1 border border-border-default rounded-2xl shadow-2xl p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-white">{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-white transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-0.5">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs font-bold text-text-muted uppercase py-1">{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const dayDisabled = isDisabledDay(day);
          const selected = isSelected(day);
          const todayDay = isToday(day);
          return (
            <button
              key={day}
              type="button"
              disabled={dayDisabled}
              onClick={() => handleSelect(day)}
              className={`w-full aspect-square rounded-xl text-sm font-medium transition-all flex items-center justify-center ${
                selected
                  ? 'bg-primary text-black font-bold'
                  : dayDisabled
                    ? 'text-text-dim cursor-not-allowed'
                    : todayDay
                      ? 'text-primary bg-primary/10 hover:bg-primary/20'
                      : 'text-text-secondary hover:bg-surface-2 hover:text-white'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 pt-2 border-t border-border-default">
        <button type="button" onClick={() => { onChange(''); setIsOpen(false); }}
          className="flex-1 py-1.5 text-xs text-text-muted hover:text-white hover:bg-surface-2 rounded-lg transition-colors">
          Clear
        </button>
        <button type="button"
          onClick={() => { const t = new Date(); handleSelect(t.getDate()); }}
          className="flex-1 py-1.5 text-xs text-primary hover:bg-primary/10 rounded-lg transition-colors font-medium"
          disabled={viewMonth !== today.getMonth() || viewYear !== today.getFullYear() || isDisabledDay(today.getDate())}>
          Today
        </button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { updatePosition(); setIsOpen(!isOpen); } }}
        className={`w-full h-14 px-6 bg-surface-2 border border-border-default rounded-2xl text-left flex items-center justify-between transition-colors ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-primary/30'
        } ${isOpen ? 'border-primary/40' : ''}`}
      >
        <span className={displayValue ? 'text-white' : 'text-text-muted'}>{displayValue || placeholder}</span>
        <Calendar className="w-4 h-4 text-text-muted" />
      </button>
      {dropdown}
    </div>
  );
}
