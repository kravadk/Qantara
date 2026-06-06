import type { Address } from 'viem';
import { getStoredSiweToken } from './sessionAuth';

export type DealSenderRole = 'merchant' | 'payer' | 'system';

export interface DealMessage {
  id: string;
  invoiceHash: string;
  senderRole: DealSenderRole;
  senderAddress?: Address;
  senderLabel?: string;
  body: string;
  createdAt: number;
  readAt?: number;
  source?: 'backend';
}

export interface DealEvent {
  id: string;
  invoiceHash: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
  source?: 'backend';
}

export interface BackendInvoice {
  hash: `0x${string}`;
  merchant: Address;
  payer: Address | null;
  token: Address;
  amount: string;
  invoiceType: 0 | 1 | 2 | 3 | 4;
  status: 0 | 1 | 2 | 3 | 4;
  createdAt: number;
  expiresAt: number;
  metadataHash: `0x${string}`;
  title?: string;
  memo?: string;
  paidAt?: number;
  paidTxHash?: string;
  metadata?: Record<string, unknown>;
  webhookEvents?: Array<{ type: string; deliveredAt: number; status: number; error?: string }>;
  /** Present on public reads: merchant configured a success/cancel return URL (URL itself stays server-side). */
  has_success_url?: boolean;
  has_cancel_url?: boolean;
}

export const QANTARA_BACKEND_URL =
  (import.meta.env.VITE_QANTARA_BACKEND_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const QUSDC_ADDRESS = import.meta.env.VITE_QUSDC_ADDRESS as `0x${string}` | undefined;

export const QANTARA_ADDRESS = import.meta.env.VITE_QANTARA_ADDRESS as `0x${string}` | undefined;
export const QANTARA_MULTIPAY_ADDRESS = import.meta.env.VITE_QANTARA_MULTIPAY_ADDRESS as `0x${string}` | undefined;
export const QANTARA_SUPPORTS_EIP3009 = import.meta.env.VITE_QANTARA_SUPPORTS_EIP3009 === 'true';
export const QUSDC_EIP3009_VERSION = (import.meta.env.VITE_QUSDC_EIP3009_VERSION as string | undefined) || '1';

// V1.5 contracts
export const MILESTONE_ESCROW_ADDRESS = import.meta.env.VITE_MILESTONE_ESCROW_ADDRESS as `0x${string}` | undefined;
export const RECURRING_SCHEDULER_ADDRESS = import.meta.env.VITE_RECURRING_SCHEDULER_ADDRESS as `0x${string}` | undefined;
export const BATCH_PAYOUT_ADDRESS = import.meta.env.VITE_BATCH_PAYOUT_ADDRESS as `0x${string}` | undefined;

const guestTokens = new Map<string, string>();
const GUEST_TOKEN_STORAGE_PREFIX = 'qantara:guest-token:';

function guestTokenStorageKey(hash: string): string {
  return `${GUEST_TOKEN_STORAGE_PREFIX}${hash.toLowerCase()}`;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function sanitizeDealMessageBody(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function getGuestToken(hash: string): string | null {
  const key = hash.toLowerCase();
  const cached = guestTokens.get(key);
  if (cached) return cached;
  if (!canUseLocalStorage()) return null;
  try {
    const stored = window.localStorage.getItem(guestTokenStorageKey(key));
    if (!stored) return null;
    guestTokens.set(key, stored);
    return stored;
  } catch {
    return null;
  }
}

export function setGuestToken(hash: string, token: string): void {
  const key = hash.toLowerCase();
  guestTokens.set(key, token);
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(guestTokenStorageKey(key), token);
  } catch {
    // Guest continuation remains best-effort; the current tab still keeps the token.
  }
}

export function listGuestInvoiceSessions(): Array<{ invoiceHash: string; guestToken: string }> {
  if (!canUseLocalStorage()) return [];
  try {
    const sessions: Array<{ invoiceHash: string; guestToken: string }> = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(GUEST_TOKEN_STORAGE_PREFIX)) continue;
      const guestToken = window.localStorage.getItem(key);
      const invoiceHash = key.slice(GUEST_TOKEN_STORAGE_PREFIX.length);
      if (guestToken && /^0x[a-fA-F0-9]{64}$/.test(invoiceHash)) {
        sessions.push({ invoiceHash, guestToken });
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

function backendHeaders(hash: string, role?: DealSenderRole): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getGuestToken(hash);
  if (token) headers['x-qantara-guest-token'] = token;
  const merchantToken = getStoredSiweToken();
  if (role === 'merchant' && merchantToken) headers.Authorization = `Bearer ${merchantToken}`;
  return headers;
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any).message || (body as any).error || `HTTP ${res.status}`);
  }
  return body as T;
}

export async function fetchBackendInvoice(hash: string): Promise<BackendInvoice | null> {
  try {
    const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}`);
    if (res.status === 404) return null;
    return parseJson<BackendInvoice>(res);
  } catch {
    return null;
  }
}

export async function fetchDealMessages(hash: string, role: DealSenderRole): Promise<DealMessage[]> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}/messages`, {
    headers: backendHeaders(hash, role),
  });
  const body = await parseJson<{ messages: DealMessage[] }>(res);
  return body.messages.map((message) => ({ ...message, source: 'backend' as const }));
}

export async function fetchDealEvents(hash: string, role: DealSenderRole): Promise<DealEvent[]> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}/events`, {
    headers: backendHeaders(hash, role),
  });
  const body = await parseJson<{ events: DealEvent[] }>(res);
  return body.events.map((event) => ({ ...event, source: 'backend' as const }));
}

export async function sendDealMessage(
  hash: string,
  input: Pick<DealMessage, 'senderRole' | 'senderAddress' | 'senderLabel' | 'body'>,
): Promise<DealMessage> {
  const res = await fetch(`${QANTARA_BACKEND_URL}/v1/invoices/${encodeURIComponent(hash)}/messages`, {
    method: 'POST',
    headers: backendHeaders(hash, input.senderRole),
    body: JSON.stringify({
      sender_role: input.senderRole,
      sender_address: input.senderAddress,
      sender_label: input.senderLabel,
      body: input.body,
    }),
  });
  const body = await parseJson<{ message: DealMessage; guest_token?: string }>(res);
  if (body.guest_token) setGuestToken(hash, body.guest_token);
  return { ...body.message, source: 'backend' };
}
