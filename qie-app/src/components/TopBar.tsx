import { Bell, Menu, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';
import { useAccount } from 'wagmi';
import { useState } from 'react';
import { Button } from './Button';
import { WalletModal } from './WalletModal';

interface TopBarProps {
  /** Mobile: opens the sidebar drawer. Hidden on desktop. */
  onOpenSidebar?: () => void;
}

export function TopBar({ onOpenSidebar }: TopBarProps) {
  const { unreadCount, setupRequired, walletRequired } = useNotifications();
  const { address, isConnected } = useAccount();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const requiresSetup = setupRequired || walletRequired;
  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-5 py-3 border-b border-border-default bg-bg-base/90 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              className="md:hidden p-2 rounded-xl bg-surface-1 border border-border-default text-text-secondary hover:text-primary hover:border-border-active transition-all"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
          <span className="text-sm font-bold text-white md:hidden">Qantara</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={isConnected ? 'secondary' : 'primary'}
            className="gap-2"
            onClick={() => setWalletModalOpen(true)}
          >
            <Wallet className="h-4 w-4" />
            <span className="hidden sm:inline">{isConnected ? shortAddress : 'Connect wallet'}</span>
            <span className="sm:hidden">{isConnected ? 'Wallet' : 'Connect'}</span>
          </Button>
          <Link
            to="/app/notifications"
            className="relative p-2 rounded-xl bg-surface-1 border border-border-default text-text-secondary hover:text-primary hover:border-primary/30 transition-all"
            aria-label="Notifications"
            title={setupRequired ? 'Notifications require merchant wallet sign-in' : walletRequired ? 'Connect wallet to load merchant notifications' : 'Notifications'}
          >
            <Bell className="w-4 h-4" />
            {requiresSetup ? (
              <span className="absolute -top-1 -right-1 h-[10px] w-[10px] rounded-full bg-yellow-300 ring-2 ring-bg-base" />
            ) : unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-bg-base text-[10px] font-bold flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </div>
      <WalletModal isOpen={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </>
  );
}
