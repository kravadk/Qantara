import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { isAddress } from 'viem';
import { ChatPanelOnchain } from '../../components/ChatPanelOnchain';
import { UsernameInput } from '../../components/UsernameInput';
import type { ResolveResult } from '../../lib/resolver';

/**
 * Full-page on-chain chat thread. Route: /app/chat/:counterparty
 * `:counterparty` is a 0x address or a username that resolves to one.
 */
export function ChatThread() {
  const { counterparty: routeCp = '' } = useParams();
  const [input, setInput] = useState(routeCp);
  const [resolved, setResolved] = useState<ResolveResult | null>(
    isAddress(routeCp) ? { address: routeCp as `0x${string}`, source: 'address', displayName: routeCp } : null,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold text-slate-100">On-chain chat</h1>
      <UsernameInput
        value={input}
        onChange={setInput}
        onResolved={setResolved}
        label="Talk to"
        placeholder="vitalik.eth or 0x…"
      />
      <div className="h-[60vh]">
        {resolved ? (
          <ChatPanelOnchain counterparty={resolved.address} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 text-sm text-slate-500">
            Resolve a recipient to start chatting.
          </div>
        )}
      </div>
    </div>
  );
}
