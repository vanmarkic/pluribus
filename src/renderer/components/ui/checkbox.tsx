import { cn } from './utils';
import { IconCheck } from 'obra-icons-react';

type CheckboxProps = {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
};

export function Checkbox({ checked = false, onCheckedChange, className }: CheckboxProps) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'w-4 h-4 rounded border flex items-center justify-center transition-colors',
        className
      )}
      style={{
        borderColor: checked ? 'var(--color-accent)' : 'var(--color-border)',
        background: checked ? 'var(--color-accent)' : 'transparent',
      }}
    >
      {checked && <IconCheck className="w-3 h-3 text-white" />}
    </button>
  );
}
