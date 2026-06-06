import { useEffect, useMemo, useState } from 'react';
import { useAccount, useWatchContractEvent, useWriteContract, useReadContract } from 'wagmi';
import { keccak256, encodePacked, type Address, type Hex } from 'viem';
import { Loader2, Send, Zap } from 'lucide-react';
import { qantaraChatAbi, QANTARA_CHAT_ADDRESS } from '../lib/chatAbi';
import { encryptMessage, decryptMessage } from '../lib/chatClient';
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
 * Each `Send` = wallet popup + 1 tx (~50-80k gas). The expensive UX is the point:
 * real messages, real chain, real cost.
 */
export function ChatPanelOnchain({ counterparty, invoiceHash }: ChatPanelOnchainProps) {
  const { address } = useAccount();
  const { writeContract, isPending, error: writeError } = useWriteContract();

  const conversationId = useMemo(() => {
    if (!address) return undefined;
    return deriveConversationId(address, counterparty);
  }, [address, counterparty]);

  const [draft, setDraft] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);

  const { data: count } = useReadContract({
    address: QANTARA_CHAT_ADDRESS,
    abi: qantaraChatAbi,
    functionName: 'messageCount',
    args: conversationId ? [conversationId] : undefined,
    query: { enabled: !!conversationId, refetchInterval: 8000 },
  });

  useWatchContractEvent({
    address: QANTARA_CHAT_ADDRESS,
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

  useEffect(() => {
    setMsgs([]);
  }, [counterparty, address]);

  const send = async () => {
    if (!address || !draft.trim()) return;
    const ciphertext = encryptMessage(draft.trim(), address, counterparty);
    const meta = invoiceHash ?? ZERO_HASH;
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
        <Zap className="h-3 w-3 text-amber-400" />
        <span>On-chain chat with</span>
        <code className="text-slate-200">{counterparty.slice(0, 6)}…{counterparty.slice(-4)}</code>
        <span className="ml-auto text-slate-500">{count ? `${count.toString()} msgs` : ''}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {msgs.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-8">
            No messages yet. The first one is on you — costs ~$0.0001 in QIE gas.
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
          Each message ≈ $0.0001 gas — real talk, real chain.
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={!address || isPending}
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!address || !draft.trim() || isPending}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        {writeError ? (
          <div className="mt-2 text-xs text-red-400">{writeError.message.slice(0, 120)}</div>
        ) : null}
      </div>
    </div>
  );
}
