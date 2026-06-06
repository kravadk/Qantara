import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function TerminalLog({ logs }: { logs: string[] }) {
  const [visibleLogs, setVisibleLogs] = useState<string[]>([]);

  useEffect(() => {
    setVisibleLogs([]);
    let i = 0;
    const interval = setInterval(() => {
      if (i < logs.length) {
        setVisibleLogs((prev) => [...prev, logs[i]]);
        i++;
      } else {
        clearInterval(interval);
      }
    }, 800);
    return () => clearInterval(interval);
  }, [logs]);

  return (
    <div className="w-full max-w-[480px] bg-black border border-border-default rounded-xl p-6 font-mono text-xs text-primary shadow-2xl">
      <div className="flex gap-1.5 mb-4">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
      </div>
      <div className="space-y-2">
        {visibleLogs.map((log, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex gap-2"
          >
            <span className="text-text-muted">{'>'}</span>
            <span className="flex-1">{log}</span>
          </motion.div>
        ))}
        {visibleLogs.length < logs.length && (
          <motion.div
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="w-2 h-4 bg-primary"
          />
        )}
      </div>
    </div>
  );
}
