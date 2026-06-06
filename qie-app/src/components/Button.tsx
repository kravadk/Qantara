import { motion, HTMLMotionProps } from 'framer-motion';
import { twMerge } from 'tailwind-merge';

interface ButtonProps extends HTMLMotionProps<'button'> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const variants = {
    // QIE signature: purple → pink gradient (matches qiewallet.me CTA)
    primary:   'qie-btn-primary hover:shadow-[0_0_28px_rgba(240,44,120,0.45)] focus-visible:shadow-[0_0_0_3px_rgba(240,44,120,0.4)]',
    secondary: 'bg-surface-2 border border-border-default text-text-primary hover:border-primary/40 hover:bg-surface-3',
    outline:   'bg-transparent border border-border-default text-text-primary hover:border-primary/40 hover:bg-primary/4',
    ghost:     'bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-2',
    danger:    'bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50',
  };

  const sizes = {
    sm: 'h-9 px-4 text-xs gap-1.5',
    md: 'h-11 px-6 text-sm gap-2',
    lg: 'h-14 px-8 text-base gap-2.5',
  };

  return (
    <motion.button
      whileHover={isDisabled ? {} : { scale: 1.03 }}
      whileTap={isDisabled ? {} : { scale: 0.97 }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      disabled={isDisabled}
      className={twMerge(
        'inline-flex items-center justify-center rounded-full font-bold transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <>
          <svg
            className="animate-spin shrink-0"
            style={{ width: size === 'sm' ? 12 : size === 'lg' ? 18 : 14, height: size === 'sm' ? 12 : size === 'lg' ? 18 : 14 }}
            viewBox="0 0 24 24" fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v2a6 6 0 100 12v2a8 8 0 01-8-8z" />
          </svg>
          {children}
        </>
      ) : children}
    </motion.button>
  );
}
