import { cn } from './utils';

type BadgeVariant = 'default' | 'secondary' | 'outline';

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const baseStyles = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium';

  const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
    default: {
      background: 'var(--color-accent)',
      color: 'white',
    },
    secondary: {
      background: 'var(--color-bg-tertiary)',
      color: 'var(--color-text-secondary)',
    },
    outline: {
      background: 'transparent',
      border: '1px solid var(--color-border)',
      color: 'var(--color-text-secondary)',
    },
  };

  return (
    <span
      className={cn(baseStyles, className)}
      style={variantStyles[variant]}
      {...props}
    />
  );
}
