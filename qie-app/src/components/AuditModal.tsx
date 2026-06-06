import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Globe, ExternalLink, Copy, CheckCircle, Shield, Info } from 'lucide-react';
import { useState } from 'react';
import { Invoice } from '../store/useInvoiceStore';
import { Button } from './Button';

export function AuditModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState('');
  const [expiry, setExpiry] = useState('24h');
  const [scope, setScope] = useState<string[]>(['amount']);

  const handleGenerate = () => {
    setStep(3);
  };

  const toggleScope = (s: string) => {
    setScope((prev) => (prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]));
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-[520px] bg-surface-1 border border-border-default rounded-[32px] p-8 shadow-2xl overflow-hidden"
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-surface-2 text-text-secondary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 bg-secondary/10 rounded-2xl flex items-center justify-center mb-6">
                <Shield className="w-8 h-8 text-secondary" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Generate Audit Package</h2>
              <p className="text-text-secondary text-sm">
                Grant selective disclosure access to specific invoice data for auditors.
              </p>
            </div>

            <div className="space-y-6">
              {step === 1 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Select Invoice</label>
                    <select
                      value={selectedInvoice}
                      onChange={(e) => setSelectedInvoice(e.target.value)}
                      className="w-full bg-surface-2 border border-border-default rounded-xl p-4 text-sm text-white focus:outline-none focus:border-secondary transition-colors"
                    >
                      <option value="">Choose an invoice...</option>
                      <option value="1">Invoice #cx8f...3a2</option>
                      <option value="2">Invoice #ax1e...9w0</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Access Expiry</label>
                    <div className="grid grid-cols-3 gap-3">
                      {['24h', '7d', '30d'].map((t) => (
                        <button
                          key={t}
                          onClick={() => setExpiry(t)}
                          className={`py-3 rounded-xl border text-sm font-bold transition-all ${
                            expiry === t ? 'bg-secondary text-white border-secondary' : 'bg-surface-2 border-border-default text-text-secondary hover:border-secondary/40'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button variant="primary" className="w-full bg-secondary text-white shadow-secondary/20" onClick={() => setStep(2)}>
                    Next Step →
                  </Button>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Selective Disclosure Scope</label>
                    <div className="space-y-3">
                      {['amount', 'recipient', 'memo', 'all'].map((s) => (
                        <button
                          key={s}
                          onClick={() => toggleScope(s)}
                          className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${
                            scope.includes(s) ? 'bg-secondary/10 border-secondary text-white' : 'bg-surface-2 border-border-default text-text-secondary'
                          }`}
                        >
                          <span className="text-sm font-bold capitalize">{s}</span>
                          {scope.includes(s) ? <CheckCircle className="w-5 h-5 text-secondary" /> : <div className="w-5 h-5 rounded-full border border-border-default" />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="ghost" className="flex-1" onClick={() => setStep(1)}>Back</Button>
                    <Button variant="primary" className="flex-[2] bg-secondary text-white shadow-secondary/20" onClick={handleGenerate}>
                      Generate Package
                    </Button>
                  </div>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  <div className="bg-surface-2 border border-border-default rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-3 text-primary mb-2">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-bold uppercase tracking-widest">Package Generated</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted uppercase tracking-widest">Audit Key</p>
                      <div className="flex items-center justify-between p-3 bg-black rounded-lg border border-border-default">
                        <p className="text-xs font-mono text-white truncate">ak_QIE_3f8a...2c1b</p>
                        <Copy className="w-4 h-4 text-text-muted cursor-pointer hover:text-white transition-colors" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-text-muted uppercase tracking-widest">Package JSON</p>
                      <div className="p-3 bg-black rounded-lg border border-border-default h-24 overflow-y-auto">
                        <pre className="text-xs font-mono text-text-secondary">
                          {`{
  "invoice": "cx8f...3a2",
  "scope": ["amount"],
  "expiry": "2026-03-19T15:18:57Z",
  "signature": "0x3f...a2c1"
}`}
                        </pre>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-secondary/5 border border-secondary/20 rounded-xl">
                    <Info className="w-5 h-5 text-secondary shrink-0" />
                    <p className="text-xs text-text-secondary leading-relaxed">
                      Share this audit package only with trusted parties. Access will automatically expire in {expiry}.
                    </p>
                  </div>
                  <Button variant="primary" className="w-full bg-secondary text-white shadow-secondary/20" onClick={onClose}>
                    Done
                  </Button>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
