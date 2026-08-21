import { useId, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import type { Priority, RequirementStatus } from '../api/types';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
  const variants = {
    primary: 'bg-accent text-white hover:opacity-90',
    secondary:
      'border border-border-subtle bg-surface-raised text-ink hover:bg-accent-soft',
    ghost: 'text-ink-muted hover:bg-accent-soft hover:text-ink',
    danger: 'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950',
  };
  return <button className={cx(base, sizes[size], variants[variant], className)} {...props} />;
}

const fieldClass =
  'w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm ' +
  'text-ink placeholder:text-ink-muted/60 focus:border-accent';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldClass, 'min-h-24 resize-y', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(fieldClass, 'pr-8', className)} {...props} />;
}

/** NFR-USE-005: a field says what is wrong with it, next to it. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-ink-muted">{hint}</span>}
      {error && (
        <span role="alert" className="block text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-lg border border-border-subtle bg-surface-raised shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

const STATUS_STYLES: Record<RequirementStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  proposed: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  implemented: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  verified: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  obsolete: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
};

const PRIORITY_STYLES: Record<Priority, string> = {
  must: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  should: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  could: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  wont: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const badgeBase =
  'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide';

export function StatusBadge({ status }: { status: RequirementStatus }) {
  return <span className={cx(badgeBase, STATUS_STYLES[status])}>{status}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={cx(badgeBase, PRIORITY_STYLES[priority])}>{priority}</span>;
}

export function TagChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-ink">
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${name}`}
          className="text-ink-muted hover:text-ink"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'warning' | 'success';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-border-subtle bg-accent-soft text-ink',
    error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    warning:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
    success:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  };
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cx('rounded-md border px-3 py-2 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  );
}

/**
 * NFR-USE-002/008: a section that hides secondary controls behind a toggle. The whole
 * header row is the toggle target — the label button carries a stretched overlay, so the
 * row is one keyboard-reachable control rather than a strip of separate hit areas.
 * `actions` sits above that overlay and stays independently clickable; `badge` keeps
 * whatever is hidden inside discoverable while collapsed.
 */
export function Disclosure({
  label,
  badge,
  defaultOpen = false,
  actions,
  children,
}: {
  label: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
      <div className="relative flex items-center gap-2 px-3 py-2 hover:bg-accent-soft">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
          className={cx(
            'cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink',
            "after:absolute after:inset-0 after:content-['']",
          )}
        >
          {label}
        </button>
        {badge}
        <div className="ml-auto flex items-center gap-2">
          {actions && <div className="relative z-10">{actions}</div>}
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={cx(
              'size-3 shrink-0 text-ink-muted transition-transform',
              open && 'rotate-180',
            )}
          >
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
      <div id={contentId} hidden={!open} className="space-y-2 border-t border-border-subtle px-3 py-3">
        {children}
      </div>
    </div>
  );
}
