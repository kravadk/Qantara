import { MessageSquare, ShieldCheck, Wallet } from 'lucide-react';
import { useAccount } from 'wagmi';
import { isAddress, type Address, type Hex } from 'viem';
import { Button } from './Button';
import { useDealRoom } from '../hooks/useDealRoom';
import type { DealSenderRole } from '../lib/dealRoom';
import { ResolutionCenter } from './ResolutionCenter';
import { ChatPanelOnchain } from './ChatPanelOnchain';
import { useSiweAuth } from '../lib/auth';

/**
 * Invoice deal room. The chat thread itself is fully on-chain (QantaraChat /
 * QantaraChat2771): messages are encrypted ciphertext in `Message` events, attributed
 * on-chain to the signer, not stored in a backend or browser. The conversation is keyed by
 * the two wallet addresses, so both parties must have a connected wallet — there is no
 * anonymous guest chat. The Resolution center below (refund / dispute state) stays backend,
 * because that is invoice lifecycle state, not chat.
 */
export function DealRoomPanel({
  invoiceHash,
  role,
  counterparty,
  title = 'Deal room',
  compact = false,
}: {
  invoiceHash: string;
  role: DealSenderRole;
  /** The other party's wallet address (merchant for a payer, payer for a merchant). */
  counterparty?: string;
  title?: string;
  compact?: boolean;
}) {
  const { events, refresh } = useDealRoom(invoiceHash, role);
  const { address } = useAccount();
  const { isAuthenticated, login, status: authStatus } = useSiweAuth();

  const cp = counterparty && isAddress(counterparty) ? (counterparty as Address) : undefined;
  const onchainReady = Boolean(address && cp);
  // Resolution actions (merchant side) are backend-authenticated via a SIWE session.
  const needsSignIn = role === 'merchant' && !isAuthenticated;

  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-default px-4 py-3">
        <MessageSquare className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white truncate">{title}</h3>
          <p className="text-[10px] uppercase tracking-widest text-text-muted">On-chain invoice chat · encrypted</p>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {onchainReady ? (
          <div className={compact ? 'h-72' : 'h-80'}>
            <ChatPanelOnchain counterparty={cp!} invoiceHash={invoiceHash as Hex} />
          </div>
        ) : (
          <div className="rounded-xl border border-border-default bg-surface-2 p-6 text-center space-y-1">
            <Wallet className="mx-auto mb-1 h-6 w-6 text-text-dim" />
            <p className="text-sm font-bold text-text-secondary">
              {!address
                ? 'Connect your wallet to chat on-chain'
                : 'On-chain chat opens once the other party is known'}
            </p>
            <p className="text-xs text-text-muted">
              {!address
                ? 'Messages are encrypted and written to the chain, attributed to your wallet — not stored locally.'
                : role === 'merchant'
                  ? 'The payer address is needed. It is known once the payer connects their wallet or pays this invoice.'
                  : 'Reconnect your wallet to resume the encrypted on-chain thread with the merchant.'}
            </p>
          </div>
        )}

        {needsSignIn ? (
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3 text-center space-y-2">
            <p className="text-xs text-text-muted">Sign in with your merchant wallet to approve refunds or resolve disputes.</p>
            <Button
              size="sm"
              className="gap-2"
              loading={authStatus === 'signing' || authStatus === 'verifying'}
              onClick={() => void login()}
            >
              <ShieldCheck className="h-4 w-4" /> Sign in with wallet
            </Button>
          </div>
        ) : (
          <ResolutionCenter invoiceHash={invoiceHash} role={role} events={events} onResolved={refresh} compact={compact} />
        )}
      </div>
    </div>
  );
}
