import { motion } from 'framer-motion';

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-6 py-4 border-b border-border-default">
      <div className="w-1/4 h-4 bg-surface-2 rounded-md animate-pulse" />
      <div className="w-1/6 h-4 bg-surface-2 rounded-md animate-pulse" />
      <div className="w-1/6 h-4 bg-surface-2 rounded-md animate-pulse" />
      <div className="w-1/4 h-4 bg-surface-2 rounded-md animate-pulse" />
      <div className="w-1/12 h-4 bg-surface-2 rounded-md animate-pulse ml-auto" />
    </div>
  );
}
