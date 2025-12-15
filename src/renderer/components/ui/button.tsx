import { cn } from './utils';

type ButtonVariant = 'default' | 'outline' | 'ghost';
type ButtonSize = 'default' | 'sm' | 'icon';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ className, variant = 'default', size = 'default', ...props }: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';

  const sizeStyles: Record<ButtonSize, string> = {
    default: 'px-4 py-2 text-sm',
    sm: 'px-3 py-1.5 text-xs',
    icon: 'p-2',
  };

  const variantStyles: Record<ButtonVariant, string> = {
    default: 'bg-[var(--color-accent)] text-white hover:opacity-90',
    outline: 'border border-[var(--color-border)] bg-transparent hover:bg-[var(--color-bg-hover)]',
    ghost: 'bg-transparent hover:bg-[var(--color-bg-hover)]',
  };

  return (
    <button
      className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)}
      style={{ color: variant === 'default' ? undefined : 'var(--color-text-secondary)' }}
      {...props}
    />
  );
}
