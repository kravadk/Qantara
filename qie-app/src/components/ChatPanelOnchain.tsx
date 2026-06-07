import { useEffect, useMemo, useState } from 'react';
import { useAccount, useWatchContractEvent, useWriteContract, useReadContract, usePublicClient, useSignTypedData } from 'wagmi';
import { keccak256, encodePacked, encodeFunctionData, type Address, type Hex } from 'viem';
import { Loader2, Send, Zap } from 'lucide-react';
import { qantaraChatAbi, QANTARA_CHAT_ADDRESS, QANTARA_CHAT2771_ADDRESS } from '../lib/chatAbi';
import { encryptMessage, decryptMessage } from '../lib/chatClient';
import { signAndSponsor, gaslessChatConfigured, type SignTypedDataFn } from '../lib/relayClient';
import { qieMainnet } from '../config/wagmi';

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

interface ChatPanelOnchainProps {
  /** The other party in the conversation. */
  counterparty: Address;
  /** Optional invoice hash to bind the conversation to a specific invoice. */
  invoiceHash?: Hex;
}

interface Msg {
  id: bigint;
  from: Address;
  to: Address;
  timestamp: number;
  body: string;
  txHash?: Hex;
}

function deriveConversationId(a: Address, b: Address): Hex {
  const lo = a.toLowerCase() < b.toLowerCase() ? a : b;
  const hi = a.toLowerCase() < b.toLowerCase() ? b : a;
  return keccak256(encodePacked(['address', 'address'], [lo as Address, hi as Address]));
}

/**
 * On-chain ciphertext chat panel.
 *
 * Two modes, both real on-chain:
 *  - Self-paid: each Send = wallet popup + 1 tx (~50-80k gas) to QantaraChat.
 *  - Gasless (⚡): the user signs an EIP-712 ForwardRequest (no gas) and the
 *    backend relayer sponsors the tx to QantaraChat2771. The message is still
 *    attributed on-chain to the signer (ERC-2771), not to the relayer.
 */
export function ChatPanelOnchain({ counterparty, invoiceHash }: ChatPanelOnchainProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContract, isPending, error: writeError } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const gaslessAvailable = gaslessChatConfigured(QANTARA_CHAT2771_ADDRESS);
  const [gasless, setGasless] = useState(gaslessAvailable);
  const [relayPending, setRelayPending] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);

  const activeChat = (gasless && gaslessAvailable ? QANTARA_CHAT2771_ADDRESS : QANTARA_CHAT_ADDRESS) as Address;
  const busy = isPending || relayPending;

  const conversationId = useMemo(() => {
    if (!address) return undefined;
    return deriveConversationId(address, counterparty);
  }, [address, counterparty]);

  const [draft, setDraft] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);

  const { data: count } = useReadContract({
    address: activeChat,
    abi: qantaraChatAbi,
    functionName: 'messageCount',
    args: conversationId ? [conversationId] : undefined,
    query: { enabled: !!conversationId, refetchInterval: 8000 },
  });

  useWatchContractEvent({
    address: activeChat,
    abi: qantaraChatAbi,
    eventName: 'Message',
    args: conversationId ? { conversationId } : undefined,
    enabled: !!conversationId,
    onLogs: (logs) => {
      const next: Msg[] = logs.map((l: any) => {
        const a = l.args ?? {};
        const from = a.from as Address;
        const to = a.to as Address;
        const cipher = a.ciphertext as Hex;
        const body = address ? decryptMessage(cipher, from, to) : '⟨connect wallet⟩';
        return {
          id: a.id as bigint,
          from,
          to,
          timestamp: Number(a.timestamp ?? 0n) * 1000,
          body,
          txHash: l.transactionHash as Hex,
        };
      });
      setMsgs((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of next) if (!seen.has(m.id)) merged.push(m);
        merged.sort((a, b) => Number(a.id - b.id));
        return merged;
      });
    },
  });

  // Reset the thread when the counterparty, account, or chat contract (mode) changes.
  useEffect(() => {
    setMsgs([]);
  }, [counterparty, address, activeChat]);

  const send = async () => {
    if (!address || !draft.trim() || busy) return;
    const ciphertext = encryptMessage(draft.trim(), address, counterparty);
    const meta = invoiceHash ?? ZERO_HASH;

    if (gasless && gaslessAvailable) {
      if (!publicClient) {
        setRelayError('Network client unavailable — try again.');
        return;
      }
      setRelayError(null);
      setRelayPending(true);
      try {
        const data = encodeFunctionData({
          abi: qantaraChatAbi,
          functionName: 'sendMessage',
          args: [counterparty, ciphertext, meta],
        });
        await signAndSponsor(publicClient, signTypedDataAsync as unknown as SignTypedDataFn, {
          from: address,
          to: QANTARA_CHAT2771_ADDRESS as Address,
          data,
          nowMs: Date.now(),
        });
        setDraft('');
        // The Message event watcher picks up the new message once mined.
      } catch (e: any) {
        setRelayError((e?.message ?? 'Gasless send failed').slice(0, 160));
      } finally {
        setRelayPending(false);
      }
      return;
    }

    writeContract({
      address: QANTARA_CHAT_ADDRESS,
      abi: qantaraChatAbi,
      functionName: 'sendMessage',
      args: [counterparty, ciphertext, meta],
      account: address,
      chain: qieMainnet,
    });
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-700 bg-slate-900/60">
      <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-2 text-xs text-slate-400">
        <Zap className={`h-3 w-3 ${gasless && gaslessAvailable ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span>On-chain chat with</span>
        <code className="text-slate-200">{counterparty.slice(0, 6)}…{counterparty.slice(-4)}</code>
        {gaslessAvailable ? (
          <button
            type="button"
            onClick={() => setGasless((g) => !g)}
            disabled={busy}
            className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
              gasless ? 'bg-emerald-600/30 text-emerald-200' : 'bg-slate-700/50 text-slate-300'
            } disabled:opacity-50`}
            title="Toggle gasless: sign once, the relayer pays the gas"
          >
            {gasless ? '⚡ Gasless on' : 'Gasless off'}
          </button>
        ) : (
          <span className="ml-auto text-slate-500">{count ? `${count.toString()} msgs` : ''}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {msgs.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-8">
            {gasless && gaslessAvailable
              ? 'No messages yet. Gasless: you sign, the relayer pays the gas.'
              : 'No messages yet. The first one is on you — costs ~$0.0001 in QIE gas.'}
          </div>
        ) : (
          msgs.map((m) => {
            const mine = address && m.from.toLowerCase() === address.toLowerCase();
            return (
              <div
                key={`${m.id.toString()}-${m.txHash ?? ''}`}
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  mine
                    ? 'ml-auto bg-emerald-600/30 text-emerald-50'
                    : 'bg-slate-700/40 text-slate-100'
                }`}
              >
                <div>{m.body || '⟨empty⟩'}</div>
                <div className="mt-1 text-[10px] text-slate-400">
                  {new Date(m.timestamp).toLocaleTimeString()}
                  {m.txHash ? (
                    <>
                      {' · '}
                      <a
                        href={`https://mainnet.qie.digital/tx/${m.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-slate-200"
                      >
                        tx
                      </a>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="border-t border-slate-700 p-3">
        <div className="mb-2 text-[10px] text-slate-500">
          {gasless && gaslessAvailable
            ? 'Gasless: sign once in your wallet — the relayer submits and pays gas. You stay the on-chain author.'
            : 'Each message ≈ $0.0001 gas — real talk, real chain.'}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={gasless && gaslessAvailable ? 'Type a gasless message…' : 'Type a message…'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={!address || busy}
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!address || !draft.trim() || busy}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        {writeError && !(gasless && gaslessAvailable) ? (
          <div className="mt-2 text-xs text-red-400">{writeError.message.slice(0, 120)}</div>
        ) : null}
        {relayError ? <div className="mt-2 text-xs text-red-400">{relayError}</div> : null}
      </div>
    </div>
  );
}
