import { motion, HTMLMotionProps } from 'framer-motion';
import React, { forwardRef } from 'react';
import { cn } from '../utils/cn';

interface CardProps extends HTMLMotionProps<'div'> {
  hoverable?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, hoverable, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        whileHover={hoverable ? { y: -6 } : {}}
        className={cn(
          "rounded-2xl border border-white/[0.08] bg-surface-1/70 p-6 backdrop-blur-xl transition-all",
          "shadow-[0_20px_60px_-32px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.04)]",
          hoverable && "hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_28px_80px_-32px_rgba(240,44,120,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]",
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
Card.displayName = 'Card';
