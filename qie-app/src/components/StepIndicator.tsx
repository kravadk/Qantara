import { motion } from 'framer-motion';

export function StepIndicator({ currentStep, totalSteps, labels }: { currentStep: number; totalSteps: number; labels: string[] }) {
  return (
    <div className="w-full space-y-4">
      <div className="flex justify-between items-center px-2">
        {labels.map((label, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
              currentStep > i + 1 ? 'bg-primary text-black' : 
              currentStep === i + 1 ? 'bg-primary/20 text-primary border border-primary/40' : 
              'bg-surface-2 text-text-muted border border-border-default'
            }`}>
              {currentStep > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-bold uppercase tracking-widest ${
              currentStep >= i + 1 ? 'text-white' : 'text-text-muted'
            }`}>{label}</span>
          </div>
        ))}
      </div>
      <div className="h-1 bg-surface-2 rounded-full overflow-hidden relative">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
          className="h-full bg-primary shadow-[0_0_12px_#F02C78]"
        />
      </div>
    </div>
  );
}
