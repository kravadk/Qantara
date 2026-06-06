import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchDealEvents,
  fetchDealMessages,
  getGuestToken,
  QANTARA_BACKEND_URL,
  sendDealMessage,
  type DealEvent,
  type DealMessage,
  type DealSenderRole,
} from '../lib/dealRoom';
import { getStoredSiweToken } from '../lib/sessionAuth';

function parseSseEvent(raw: string): { type: string; data: string } | null {
  let type = 'message';
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) type = line.slice(6).trim() || 'message';
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { type, data: data.join('\n') };
}

export function useDealRoom(invoiceHash: string | undefined, role: DealSenderRole) {
  const [messages, setMessages] = useState<DealMessage[]>([]);
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<'disabled' | 'connecting' | 'connected' | 'error'>('disabled');
  const [lastStreamEventAt, setLastStreamEventAt] = useState<number | null>(null);

  const unreadCount = useMemo(
    () => messages.filter((message) => message.senderRole !== role && !message.readAt).length,
    [messages, role],
  );

  const refresh = useCallback(async () => {
    if (!invoiceHash) return;
    setIsLoading(true);
    setError(null);
    try {
      const [nextMessages, nextEvents] = await Promise.all([
        fetchDealMessages(invoiceHash, role),
        fetchDealEvents(invoiceHash, role),
      ]);
      setMessages(nextMessages);
      setEvents(nextEvents);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load deal room');
    } finally {
      setIsLoading(false);
    }
  }, [invoiceHash, role]);

  const sendMessage = useCallback(async (body: string, senderLabel?: string) => {
    if (!invoiceHash) return;
    setIsSending(true);
    setError(null);
    try {
      const message = await sendDealMessage(invoiceHash, {
        senderRole: role,
        senderLabel,
        body,
      });
      setMessages((prev) => [...prev.filter((item) => item.id !== message.id), message]);
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? 'Could not send message');
    } finally {
      setIsSending(false);
    }
  }, [invoiceHash, refresh, role]);

  const addSystemEvent = useCallback(async (body: string) => {
    if (!invoiceHash) return;
    await sendDealMessage(invoiceHash, {
      senderRole: 'system',
      senderLabel: 'Deal room',
      body,
    });
    await refresh();
  }, [invoiceHash, refresh]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), role === 'merchant' ? 15_000 : 2500);
    return () => window.clearInterval(interval);
  }, [refresh, role]);

  useEffect(() => {
    if (!invoiceHash) return;
    const token = getGuestToken(invoiceHash);
    const params = new URLSearchParams();
    if (role === 'payer') {
      if (!token) {
        setStreamStatus('disabled');
        return;
      }
      params.set('guest_token', token);
    }
    setStreamStatus('connecting');
    if (role === 'merchant') {
      const token = getStoredSiweToken();
      if (!token) {
        setStreamStatus('disabled');
        return;
      }
      const controller = new AbortController();
      const onEvent = () => {
        setStreamStatus('connected');
        setLastStreamEventAt(Math.floor(Date.now() / 1000));
        void refresh();
      };
      void fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(invoiceHash)}/events`, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      }).then(async (res) => {
        if (!res.ok || !res.body) throw new Error(`SSE unavailable (${res.status})`);
        setStreamStatus('connected');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const event = parseSseEvent(chunk);
            if (event) onEvent();
          }
        }
      }).catch((err) => {
        if (!controller.signal.aborted) {
          setStreamStatus('error');
          console.warn('[deal-room] merchant SSE failed', err);
        }
      });
      return () => {
        controller.abort();
        setStreamStatus('disabled');
      };
    }
    const source = new EventSource(
      `${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(invoiceHash)}/events?${params}`,
    );
    const onEvent = () => {
      setStreamStatus('connected');
      setLastStreamEventAt(Math.floor(Date.now() / 1000));
      void refresh();
    };
    source.onopen = () => setStreamStatus('connected');
    source.onmessage = onEvent;
    source.addEventListener('message.created', onEvent);
    source.addEventListener('invoice.paid', onEvent);
    source.addEventListener('receipt.created', onEvent);
    source.addEventListener('webhook.failed', onEvent);
    source.addEventListener('invoice.cancelled', onEvent);
    source.onerror = () => {
      setStreamStatus('error');
      source.close();
    };
    return () => {
      source.close();
      setStreamStatus('disabled');
    };
  }, [invoiceHash, refresh, role]);

  return {
    messages,
    events,
    isLoading,
    isSending,
    error,
    unreadCount,
    streamStatus,
    lastStreamEventAt,
    refresh,
    sendMessage,
    addSystemEvent,
  };
}
