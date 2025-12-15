import { cn } from './utils';

type ProgressProps = {
  value: number;
  className?: string;
  indicatorClassName?: string;
};

export function Progress({ value, className, indicatorClassName }: ProgressProps) {
  return (
    <div
      className={cn('h-2 w-full rounded-full overflow-hidden', className)}
      style={{ background: 'var(--color-bg-tertiary)' }}
    >
      <div
        className={cn('h-full transition-all duration-500 ease-out', indicatorClassName)}
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: 'var(--color-accent)',
        }}
      />
    </div>
  );
}
