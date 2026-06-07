import { motion, AnimatePresence } from 'framer-motion';
import { AppSidebar } from '../components/AppSidebar';
import { TopBar } from '../components/TopBar';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useState, useEffect } from 'react';
import { Button } from '../components/Button';

export function AppLayout() {
  const { isConnected } = useAccount();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const walletOptionalRoutes = [
    '/app/start',
    '/app/settings',
    '/app/telegram-bot',
    '/app/tg-bot',
    '/app/developer',
    '/app/build',
    '/app/webhooks',
    '/app/guide',
    '/app/checkout-api',
    '/app/explorer',
    '/app/sdk',
  ];
  const requiresWallet = !isConnected && !walletOptionalRoutes.includes(location.pathname);

  // Close sidebar + scroll to top on route change
  useEffect(() => {
    setSidebarOpen(false);
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  return (
    <div className="relative min-h-screen bg-bg-base flex overflow-hidden font-body">
      {/* Subtle static atmosphere — premium depth without the landing's animated mesh. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(48%_38%_at_10%_-4%,rgba(240,44,120,0.10),transparent_60%),radial-gradient(42%_38%_at_106%_4%,rgba(126,34,206,0.10),transparent_62%)]" />
        <div className="ledger-grid absolute inset-0 opacity-25" />
      </div>
      <div className="noise-overlay pointer-events-none" />

      {/* Mobile overlay backdrop */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar — always visible on md+, drawer on mobile */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      {/* Mobile sidebar drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar-mobile"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="fixed left-0 top-0 z-[10001] md:hidden"
          >
            <AppSidebar onClose={() => setSidebarOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 h-screen overflow-y-auto">
        <TopBar onOpenSidebar={() => setSidebarOpen(true)} />

        <div className="max-w-6xl mx-auto px-5 py-7 md:px-10 md:py-10">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              {requiresWallet ? <WalletRequired /> : <Outlet />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function WalletRequired() {
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-border-default bg-surface-1 p-8 text-center shadow-glow-soft">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-xl font-bold text-primary">
        Q
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-white">Connect merchant wallet</h1>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        Operational pages use wallet session auth for invoice, receipt, notification, and webhook actions. Open Start to connect your wallet and continue the workspace flow.
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Link to="/app/start">
          <Button variant="primary">Open Start</Button>
        </Link>
        <Link to="/app/settings">
          <Button variant="secondary">Check setup</Button>
        </Link>
      </div>
    </section>
  );
}
