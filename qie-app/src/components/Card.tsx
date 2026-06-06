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
          "bg-surface-1 rounded-2xl border border-border-default p-6 transition-colors",
          hoverable && "hover:border-primary/20",
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
