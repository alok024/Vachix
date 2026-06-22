'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

// Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'upgrade';
type ButtonSize    = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-[10px] ' +
  'transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2';

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-xs',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-7 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = 'primary', size = 'md', loading, leftIcon, rightIcon, children, className, style, ...rest }, ref) {
    const variantStyle: React.CSSProperties =
      variant === 'primary'   ? { background: 'var(--accent-bg)', color: 'var(--accent-text)', boxShadow: '0 0 0 1px var(--accent-border)' } :
      variant === 'secondary' ? { background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border2)' } :
      variant === 'ghost'     ? { background: 'transparent', color: 'var(--text-2)' } :
      variant === 'outline'   ? { background: 'transparent', color: 'var(--text-1)', border: '1px solid var(--border2)' } :
      variant === 'danger'    ? { background: 'var(--error-dim)', color: 'var(--error)', border: '1px solid var(--error-border)' } :
      /* upgrade */             { background: 'var(--blue)', color: '#fff' };

    return (
      <button
        ref={ref}
        className={cn(BTN_BASE, BTN_SIZE[size as ButtonSize], className)}
        style={{ ...variantStyle, ...style }}
        disabled={loading || rest.disabled}
        {...rest}
      >
        {loading ? <Spinner size={size === 'lg' ? 18 : 14} /> : leftIcon}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);
Button.displayName = 'Button';

// Badge

type BadgeVariant = 'default' | 'accent' | 'success' | 'warn' | 'danger' | 'purple' | 'pro' | 'elite' | 'free' | 'starter';

interface BadgeProps {
  variant?: BadgeVariant;
  children?: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  const s: React.CSSProperties =
    variant === 'accent'  ? { background: 'var(--accent-dim)',   color: 'var(--accent)',   border: '1px solid var(--accent-border)' } :
    variant === 'success' ? { background: 'var(--success-dim)',  color: 'var(--success)',  border: '1px solid var(--success-border)' } :
    variant === 'warn'    ? { background: 'var(--warn-dim)',     color: 'var(--warn)',     border: '1px solid var(--warn-border)' } :
    variant === 'danger'  ? { background: 'var(--error-dim)',    color: 'var(--error)',    border: '1px solid var(--error-border)' } :
    variant === 'purple'  ? { background: 'var(--blue-dim)',   color: 'var(--accent)',   border: '1px solid var(--blue-border)' } :
    variant === 'pro'     ? { background: 'var(--warn-dim)',     color: 'var(--warn)',     border: '1px solid var(--warn-border)' } :
    variant === 'elite'   ? { background: 'linear-gradient(135deg,var(--blue-dim),var(--warn-dim))', color: 'var(--text-1)', border: '1px solid var(--blue-border)' } :
    variant === 'free'    ? { background: 'var(--surface-3)',    color: 'var(--text-3)',   border: '1px solid var(--border)' } :
    variant === 'starter' ? { background: 'var(--success-dim)',  color: 'var(--success)',  border: '1px solid var(--success-border)' } :
                            { background: 'var(--surface-2)',    color: 'var(--text-2)',   border: '1px solid var(--border2)' };

  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-0.5', className)}
      style={s}
    >
      {children}
    </span>
  );
}

// Card

interface CardProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, style, hover, onClick }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border transition-all duration-200',
        hover && 'hover:border-[var(--border2)] hover:-translate-y-0.5',
        onClick && 'cursor-pointer',
        className
      )}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow)', ...style }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('px-5 pt-5 pb-3 border-b', className)} style={{ borderColor: 'var(--border)' }}>
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

// Spinner

export function Spinner({ size = 18, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      className={cn('animate-spin', className)}
      style={{ color: 'currentColor', ...style }}
      fill="none"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Input

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, error, hint, leftElement, rightElement, className, id, ...rest }, ref) {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            {label}
          </label>
        )}
        <div className="relative">
          {leftElement && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }}>
              {leftElement}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'w-full h-10 text-sm rounded-[10px] border px-3 transition-all duration-150',
              'focus:outline-none focus:ring-2',
              leftElement && 'pl-9',
              rightElement && 'pr-9',
              className
            )}
            style={{
              background: 'var(--surface-2)',
              border: error ? '1px solid var(--error)' : '1px solid var(--border2)',
              color: 'var(--text-1)',
            }}
            {...rest}
          />
          {rightElement && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }}>
              {rightElement}
            </div>
          )}
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--error)' }}>{error}</p>}
        {hint && !error && <p className="text-xs" style={{ color: 'var(--text-3)' }}>{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

// Textarea

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, error, className, id, ...rest }, ref) {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            {label}
          </label>
        )}
        <textarea
          id={inputId}
          ref={ref}
          className={cn(
            'w-full text-sm rounded-[10px] border px-3 py-2.5 transition-all duration-150 resize-none',
            'focus:outline-none focus:ring-2',
            className
          )}
          style={{
            background: 'var(--surface-2)',
            border: error ? '1px solid var(--error)' : '1px solid var(--border2)',
            color: 'var(--text-1)',
          }}
          {...rest}
        />
        {error && <p className="text-xs" style={{ color: 'var(--error)' }}>{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

// ProgressBar

export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  className?: string;
  label?: string;
  showValue?: boolean;
  animated?: boolean;
}

export function ProgressBar({ value, max = 100, color, className, label, showValue, animated }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const fill = color ?? 'var(--accent)';

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</span>}
          {showValue && <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>{Math.round(pct)}</span>}
        </div>
      )}
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
        <div
          className={cn('h-full rounded-full', animated && 'transition-all duration-700 ease-out')}
          style={{ width: `${pct}%`, background: fill }}
        />
      </div>
    </div>
  );
}

// ScoreBadge

export function ScoreBadge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  // Fix (#24): scores are 0-10 everywhere this component is used, but the
  // thresholds here were written for a 0-100 scale — every badge rendered
  // red regardless of actual performance. Match scoreColor's convention.
  const color =
    score >= 7 ? 'var(--success)' : score >= 4 ? 'var(--warn)' : 'var(--error)';
  const dim =
    score >= 7 ? 'var(--success-dim)' : score >= 4 ? 'var(--warn-dim)' : 'var(--error-dim)';
  const border =
    score >= 7 ? 'var(--success-border)' : score >= 4 ? 'var(--warn-border)' : 'var(--error-dim)';
  const cls = size === 'sm' ? 'text-sm w-9 h-9' : size === 'lg' ? 'text-xl w-14 h-14' : 'text-base w-11 h-11';

  return (
    <div
      className={cn('rounded-xl font-bold flex items-center justify-center tabular-nums', cls)}
      style={{ background: dim, color, border: `1px solid ${border}` }}
    >
      {score}
    </div>
  );
}

// ScoreRing

export function ScoreRing({ score, size = 80, label }: { score: number; size?: number; label?: string }) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color =
    score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warn)' : 'var(--error)';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s var(--ease-spring)' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-bold tabular-nums" style={{ fontSize: size * 0.26, color }}>{score}</span>
        </div>
      </div>
      {label && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</span>}
    </div>
  );
}

// SectionLabel

export function SectionLabel({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn('text-[10px] font-bold uppercase tracking-widest px-3 mb-1', className)}
      style={{ color: 'var(--text-3)', letterSpacing: '0.1em' }}
    >
      {children}
    </p>
  );
}

// ChipGroup

interface ChipOption { label: string; value: string; icon?: React.ReactNode }

interface ChipGroupProps {
  options: ChipOption[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

export function ChipGroup({ options, value, onChange, className }: ChipGroupProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200"
            style={
              active
                ? { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }
                : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }
            }
          >
            {opt.icon}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

// EmptyState

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16 text-center', className)}>
      {icon && (
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>{title}</p>
        {description && <p className="text-sm max-w-xs" style={{ color: 'var(--text-3)' }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

// UpgradeStrip

interface UpgradeStripProps {
  message: string;
  onUpgrade: () => void;
  className?: string;
}

export function UpgradeStrip({ message, onUpgrade, className }: UpgradeStripProps) {
  return (
    <div
      className={cn('flex items-center justify-between gap-4 rounded-xl px-4 py-3', className)}
      style={{ background: 'var(--blue-dim)', border: '1px solid var(--blue-border)' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-base">✦</span>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>{message}</p>
      </div>
      <button
        onClick={onUpgrade}
        className="flex-shrink-0 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-opacity hover:opacity-80"
        style={{ background: 'var(--blue)', color: '#fff' }}
      >
        Upgrade →
      </button>
    </div>
  );
}
