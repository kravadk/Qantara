import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Wallet, X, CheckCircle, Loader2, AlertTriangle, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from './Button';
import { useNavigate, useLocation } from 'react-router-dom';
import { useConnect, useAccount, useSwitchChain } from 'wagmi';
import { qieMainnet } from '../config/wagmi';
import { QIE_LINKS } from '../lib/qieResources';
import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * QIE Wallet is identified either by an explicit injected flag
 * (`window.ethereum?.isQieWallet`) or by name. We prefer flag-based detection
 * since names can collide across forks.
 */
function isQieWalletConnector(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('qie')) return true;
  if (typeof window !== 'undefined') {
    const eth = (window as any).ethereum;
    if (eth?.isQieWallet && n.includes('injected')) return true;
  }
  return false;
}

export function WalletModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { connectors, connect, isPending, error } = useConnect();
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const navigate = useNavigate();
  const location = useLocation();
  const [connectError, setConnectError] = useState<string | null>(null);
  const didRedirect = useRef(false);

  const needsSwitch = isConnected && chainId !== qieMainnet.id;

  // Sort connectors so QIE Wallet is always first.
  const sortedConnectors = useMemo(() => {
    const list = [...connectors];
    return list.sort((a, b) => {
      const aIsQie = isQieWalletConnector(a.name);
      const bIsQie = isQieWalletConnector(b.name);
      if (aIsQie && !bIsQie) return -1;
      if (!aIsQie && bIsQie) return 1;
      return 0;
    });
  }, [connectors]);

  // Detect if QIE Wallet is available among the connectors.
  const hasQieWallet = useMemo(() => sortedConnectors.some((c) => isQieWalletConnector(c.name)), [sortedConnectors]);

  // Redirect when connected successfully — but NOT if already on /pay or /profile page
  useEffect(() => {
    if (isOpen && isConnected && !needsSwitch && !didRedirect.current) {
      didRedirect.current = true;
      const isPublicPage = location.pathname.startsWith('/pay') || location.pathname.startsWith('/profile') || location.pathname.startsWith('/shared');
      setTimeout(() => {
        onClose();
        if (!isPublicPage) {
          navigate('/app/dashboard');
        }
        // If on public page — just close modal, stay on page
      }, 800);
    }
  }, [isConnected, needsSwitch, isOpen]);

  // Reset redirect flag when modal closes
  useEffect(() => {
    if (!isOpen) didRedirect.current = false;
  }, [isOpen]);

  const handleConnect = async (connectorIndex: number) => {
    setConnectError(null);
    const connector = connectors[connectorIndex];
    if (!connector) return;

    try {
      connect(
        { connector, chainId: qieMainnet.id },
        {
          onError: (err) => {
            setConnectError(err.message?.includes('rejected') ? 'Connection rejected by user' : err.message || 'Connection failed');
          },
        }
      );
    } catch (e: any) {
      setConnectError(e.message || 'Connection failed');
    }
  };

  const handleSwitchNetwork = () => {
    switchChain({ chainId: qieMainnet.id });
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
            initial={{ scale: 0.9, opacity: 0, rotate: 0 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0, rotate: 15 }}
            transition={{ type: 'spring', damping: 20, stiffness: 150 }}
            className="relative w-full max-w-[400px] bg-surface-1 border border-border-default rounded-[24px] p-8 shadow-2xl overflow-hidden"
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-surface-2 text-text-secondary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Connect to Qantara</h2>
              <p className="text-text-secondary text-sm">
                Connect your wallet to QIE Mainnet to create or pay invoices.
              </p>
            </div>

            {needsSwitch ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl">
                  <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                  <p className="text-sm text-yellow-200">Wrong network. Please switch to QIE Mainnet.</p>
                </div>
                <Button className="w-full" onClick={handleSwitchNetwork}>
                  Switch to QIE Mainnet
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedConnectors.map((connector) => {
                  const originalIndex = connectors.findIndex((c) => c.uid === connector.uid);
                  const isQie = isQieWalletConnector(connector.name);
                  const isMm = connector.name.toLowerCase().includes('metamask');
                  return (
                    <button
                      key={connector.uid}
                      disabled={isPending || isConnected}
                      onClick={() => handleConnect(originalIndex)}
                      className={`w-full group relative flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                        isQie
                          ? 'bg-primary/5 border-primary/40 hover:bg-primary/10 hover:border-primary/60 shadow-[0_0_30px_-12px_rgba(255,130,0,0.45)]'
                          : 'bg-surface-2 border-border-default hover:border-primary/40 hover:bg-surface-3'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                          isQie ? 'bg-primary/15 border-primary/40' : 'bg-black border-border-default'
                        }`}>
                          {isQie ? (
                            <Sparkles className="w-6 h-6 text-primary" />
                          ) : isMm ? (
                            <Wallet className="w-6 h-6 text-secondary" />
                          ) : (
                            <Shield className="w-6 h-6 text-primary" />
                          )}
                        </div>
                        <div className="text-left">
                          <p className="font-bold text-white flex items-center gap-2">
                            {isQie ? 'QIE Wallet' : connector.name}
                            {isQie && (
                              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary">
                                Recommended
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-text-muted">
                            {isQie ? 'Native to chain 1990' : 'QIE Mainnet'}
                          </p>
                        </div>
                      </div>
                      {isPending ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      ) : isConnected ? (
                        <CheckCircle className="w-5 h-5 text-primary" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-primary/20 group-hover:bg-primary transition-colors" />
                      )}
                    </button>
                  );
                })}

                {!hasQieWallet && (
                  <a
                    href={QIE_LINKS.wallet}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between p-3 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      <span className="text-text-secondary">Don't have QIE Wallet yet?</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                      Get it <ExternalLink className="w-3 h-3" />
                    </span>
                  </a>
                )}
              </div>
            )}

            {isPending && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 flex flex-col items-center gap-3"
              >
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      className="w-1.5 h-1.5 rounded-full bg-primary"
                    />
                  ))}
                </div>
                <p className="text-xs font-mono text-primary uppercase tracking-widest">Approve in wallet...</p>
              </motion.div>
            )}

            {isConnected && !needsSwitch && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-8 flex flex-col items-center gap-3"
              >
                <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-primary" />
                </div>
                <p className="text-xs font-mono text-primary uppercase tracking-widest">? Connected Successfully</p>
              </motion.div>
            )}

            {(connectError || error) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl"
              >
                <p className="text-xs text-red-400">{connectError || error?.message}</p>
              </motion.div>
            )}

            <div className="mt-8 pt-6 border-t border-border-default text-center">
              <p className="text-xs text-text-muted uppercase tracking-widest">
                By connecting, you agree to the Qantara Manifesto.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
