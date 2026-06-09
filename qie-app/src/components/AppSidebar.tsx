import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Plus,
  Settings, Code, ChevronDown, Copy, Inbox,
  LogOut, X, Webhook, Shield, KeyRound, BarChart3, Wallet, Compass,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState, useCallback } from 'react';
import { useAccount, useDisconnect, useBalance } from 'wagmi';
import { RefreshCw } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import { BuyQieRail } from './BuyQieRail';
import { WalletModal } from './WalletModal';

function BalanceDisplay() {
  const { address } = useAccount();
  const { data: balanceData, error, isLoading, refetch } = useBalance({ address });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!address) return;
    setIsRefreshing(true);
    await refetch();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const formatted = !address
    ? 'Connect wallet'
    : isLoading
      ? 'Checking'
      : error
        ? 'Unavailable'
        : balanceData
          ? (Number(balanceData.value) / 10 ** balanceData.decimals).toFixed(4)
          : 'Unavailable';

  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-surface-2 rounded-xl border border-border-default hover:border-border-active/40 transition-all duration-300">
      <div className="flex items-center gap-2">
        <motion.span
          key={formatted}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm font-bold text-primary tabular-nums"
        >
          {formatted}
        </motion.span>
        {balanceData?.symbol && <span className="text-xs text-text-muted">{balanceData.symbol}</span>}
      </div>
      <button
        onClick={handleRefresh}
        aria-label="Refresh balance"
        disabled={!address}
        className="p-1 rounded-lg hover:bg-surface-3 text-text-muted hover:text-primary transition-all duration-200"
      >
        <RefreshCw className={`w-3.5 h-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}

interface SidebarItemProps {
  icon: any;
  label: string;
  path: string;
  isActive?: boolean;
  isComingSoon?: boolean;
  badge?: string;
  badgeColor?: string;
  onNavigate?: () => void;
}

function SidebarItem({ icon: Icon, label, path, isActive, isComingSoon, badge, badgeColor, onNavigate }: SidebarItemProps) {
  return (
    <Link
      to={isComingSoon ? '#' : path}
      onClick={onNavigate}
      style={isActive ? { background: 'linear-gradient(90deg, #7e22ce 0%, #F02C78 60%, #f97316 100%)' } : undefined}
      className={`group relative flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all duration-200 ${
        isActive
          ? 'text-white font-bold shadow-[0_0_18px_rgba(240,44,120,0.35)]'
          : isComingSoon
            ? 'text-text-dim cursor-not-allowed pointer-events-none'
            : 'text-text-secondary hover:text-white hover:bg-surface-2 hover:translate-x-0.5'
      }`}
    >
      {/* Active left indicator */}
      {isActive && (
        <motion.div
          layoutId="sidebar-active-bar"
          className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full"
          style={{ background: 'linear-gradient(180deg, #7e22ce 0%, #F02C78 60%, #f97316 100%)' }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      )}

      <div className="flex items-center gap-3 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-white' : 'text-inherit group-hover:text-primary/80'}`} />
        <span className="text-[13px] truncate leading-none">{label}</span>
      </div>

      {badge && (
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${badgeColor || 'bg-surface-3 text-text-muted'}`}>
          {badge}
        </span>
      )}
    </Link>
  );
}

interface SidebarSectionProps {
  label: string;
  children: React.ReactNode;
  badge?: string;
  defaultOpen?: boolean;
}

function SidebarSection({ label, children, badge, defaultOpen = true }: SidebarSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-3.5 py-1.5 text-[10px] font-bold text-text-dim uppercase tracking-widest hover:text-text-muted transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          {label}
          {badge && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
              badge === 'FEATURED' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'
            }`}>
              {badge}
            </span>
          )}
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 0 : -90 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        >
          <ChevronDown className="w-3 h-3" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden space-y-0.5 pl-1"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface AppSidebarProps {
  onClose?: () => void;
}

export function AppSidebar({ onClose }: AppSidebarProps) {
  const location = useLocation();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { unreadCount, setupRequired, walletRequired } = useNotifications();
  const [copied, setCopied] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(address || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  const isAt = (path: string) => location.pathname === path;
  const nav = onClose;

  return (
    <aside className="w-64 h-screen bg-surface-1/55 backdrop-blur-2xl border-r border-white/[0.08] flex flex-col select-none">
      {/* Logo */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 group min-w-0" onClick={nav}>
          <img
            src="/logo.png"
            alt="Qantara"
            className="h-8 w-8 shrink-0 rounded-xl shadow-[0_0_16px_rgba(240,44,120,0.4)] transition-transform duration-200 group-hover:scale-105"
          />
          <span className="font-display text-[17px] font-semibold text-white tracking-tight whitespace-nowrap">
            <span className="qie-gradient-text">Qantara</span>
          </span>
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-lg text-text-muted hover:text-white hover:bg-surface-2 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav — structured per PLAN.md V1/V1.5/V2 scope */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4 no-scrollbar">
        {/* Core payment links */}
        <SidebarSection label="Payments" badge="FEATURED">
          <SidebarItem icon={Plus} label="Create invoice" path="/app/new-cipher" isActive={isAt('/app/new-cipher')} badge="NEW" badgeColor="bg-primary/15 text-primary" onNavigate={nav} />
          <SidebarItem icon={LayoutDashboard} label="Dashboard" path="/app/dashboard" isActive={isAt('/app/dashboard')} onNavigate={nav} />
          <SidebarItem
            icon={Inbox}
            label="Activity"
            path="/app/inbox"
            isActive={isAt('/app/inbox') || isAt('/app/proofs')}
            badge={setupRequired ? 'SETUP' : walletRequired ? 'WALLET' : unreadCount > 0 ? String(unreadCount) : undefined}
            badgeColor={setupRequired || walletRequired ? 'bg-yellow-400/10 text-yellow-300' : 'bg-primary/15 text-primary'}
            onNavigate={nav}
          />
        </SidebarSection>

        <SidebarSection label="Operations">
          <SidebarItem icon={Shield} label="Advanced" path="/app/advanced" isActive={isAt('/app/advanced') || isAt('/app/escrow') || isAt('/app/subscription') || isAt('/app/installment') || isAt('/app/batch') || isAt('/app/multipay')} badge="V1.5" badgeColor="bg-primary/15 text-primary" onNavigate={nav} />
          <SidebarItem icon={Webhook} label="Distribution" path="/app/distribute" isActive={isAt('/app/distribute') || isAt('/app/checkout-api') || isAt('/app/tg-bot') || isAt('/app/telegram-bot')} onNavigate={nav} />
          <SidebarItem icon={Webhook} label="Webhooks" path="/app/webhooks" isActive={isAt('/app/webhooks')} onNavigate={nav} />
        </SidebarSection>

        <SidebarSection label="Resources" defaultOpen={false}>
          <SidebarItem icon={Code} label="Developer" path="/app/developer" isActive={isAt('/app/developer') || isAt('/app/build') || isAt('/app/guide')} onNavigate={nav} />
          <SidebarItem icon={Compass} label="Explorer" path="/app/explorer" isActive={isAt('/app/explorer')} onNavigate={nav} />
          <SidebarItem icon={KeyRound} label="API keys" path="/app/api-keys" isActive={isAt('/app/api-keys')} onNavigate={nav} />
          <SidebarItem icon={BarChart3} label="Billing" path="/app/billing" isActive={isAt('/app/billing')} onNavigate={nav} />
          <SidebarItem icon={Inbox} label="Customers" path="/app/customers" isActive={isAt('/app/customers')} onNavigate={nav} />
          <SidebarItem icon={Settings} label="Settings" path="/app/settings" isActive={isAt('/app/settings')} onNavigate={nav} />
        </SidebarSection>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/[0.08] space-y-3">
        {!(isConnected && address) ? (
          <button
            type="button"
            onClick={() => setWalletModalOpen(true)}
            className="qie-btn-primary w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm"
          >
            <Wallet className="w-4 h-4" /> Connect wallet
          </button>
        ) : (
        <>
        <BalanceDisplay />
        <BuyQieRail />

        {/* Account row */}
        <div className="flex items-center justify-between px-1 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 border border-border-default flex items-center justify-center text-[10px] font-bold text-white">
              {address?.slice(2, 4)?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{address?.slice(0, 6)}…{address?.slice(-4)}</p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider">Connected</p>
            </div>
          </div>

          <button
            onClick={handleCopy}
            aria-label="Copy address"
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-primary transition-all duration-200"
          >
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="block w-3.5 h-3.5 text-primary text-[10px] font-bold">?</motion.span>
              ) : (
                <motion.div key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <Copy className="w-3.5 h-3.5" />
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>

        <button
          onClick={() => { disconnect(); onClose?.(); }}
          className="w-full flex items-center justify-center gap-2 py-2 text-[11px] font-bold text-red-500/70 hover:text-red-400 hover:bg-red-500/8 rounded-xl transition-all duration-200"
        >
          <LogOut className="w-3.5 h-3.5" />
          Disconnect
        </button>
        </>
        )}
      </div>

      <WalletModal isOpen={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </aside>
  );
}
