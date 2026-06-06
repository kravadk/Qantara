import { randomBytes } from 'node:crypto';
import { type Address } from 'viem';

import { db, nowSeconds } from '../db.js';
import { InvoiceStatus } from './invoices.js';

export interface BillingTokenVolume {
  token: Address;
  paidCount: number;
  /** Sum of paid invoice amounts (human decimal string) for this token. */
  paidVolume: string;
}

export interface BillingSummary {
  merchant: Address;
  total: number;
  byStatus: { created: number; paid: number; cancelled: number; refunded: number; paused: number };
  tokens: BillingTokenVolume[];
}

export interface ExplorerStats {
  paidCount: number;
  activeMerchants: number;
  receiptsCount: number;
  last24hPaidCount: number;
  volume: Array<{ token: Address; paidCount: number; paidVolume: string }>;
}

export interface MerchantProfile {
  merchant: Address;
  displayName?: string;
  website?: string;
  publicListed: boolean;
  walletVerified: boolean;
  domain?: string;
  domainToken?: string;
  domainVerifiedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MerchantPayer {
  payer: Address;
  invoices: number;
  paid: number;
  lastActivityAt: number;
  volume: Array<{ token: Address; paidVolume: string }>;
}

export interface MerchantAnalytics {
  totalInvoices: number;
  paidInvoices: number;
  /** paid / total, 0..1. */
  conversionRate: number;
  /** Average seconds between invoice creation and payment, or null if none paid. */
  avgTimeToPaySeconds: number | null;
  webhook: { total: number; failed: number; failureRate: number };
}

function decimalToMicros(amount: string, scale: bigint): bigint {
  const [whole, frac = ''] = amount.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole || '0') * scale + BigInt(fracPadded || '0');
}

function microsToDecimal(micros: bigint, scale: bigint): string {
  const whole = micros / scale;
  const frac = (micros % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function mapMerchantProfile(row: any): MerchantProfile {
  return {
    merchant: row.merchant as Address,
    displayName: row.display_name ?? undefined,
    website: row.website ?? undefined,
    publicListed: !!row.public_listed,
    walletVerified: !!row.wallet_verified,
    domain: row.domain ?? undefined,
    domainToken: row.domain_token ?? undefined,
    domainVerifiedAt: row.domain_verified_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Count settled (paid) invoices for a merchant - public trust signal. */
export function countMerchantPaid(merchant: Address): number {
  const row = db
    .prepare('SELECT count(*) AS count FROM invoices WHERE lower(merchant) = lower(?) AND status = ?')
    .get(merchant, InvoiceStatus.Paid) as { count: number };
  return Number(row.count);
}

/**
 * Per-merchant billing aggregate for the dashboard: invoice counts by status and
 * paid volume grouped by token. Volume is summed from the stored decimal amount
 * strings using fixed-point integer math (no float drift).
 */
export function billingSummary(merchant: Address): BillingSummary {
  const rows = db
    .prepare('SELECT token, status, amount FROM invoices WHERE lower(merchant) = lower(?)')
    .all(merchant) as Array<{ token: string; status: number; amount: string }>;

  const byStatus = { created: 0, paid: 0, cancelled: 0, refunded: 0, paused: 0 };
  const statusKey = ['created', 'paid', 'cancelled', 'refunded', 'paused'] as const;
  const SCALE = 1_000_000n;
  const volumes = new Map<string, { count: number; micros: bigint }>();

  for (const row of rows) {
    const key = statusKey[row.status];
    if (key) byStatus[key] += 1;
    if (row.status === InvoiceStatus.Paid) {
      const token = row.token.toLowerCase();
      const entry = volumes.get(token) ?? { count: 0, micros: 0n };
      entry.count += 1;
      entry.micros += decimalToMicros(row.amount, SCALE);
      volumes.set(token, entry);
    }
  }

  const tokens: BillingTokenVolume[] = Array.from(volumes.entries()).map(([token, { count, micros }]) => ({
    token: token as Address,
    paidCount: count,
    paidVolume: microsToDecimal(micros, SCALE),
  }));

  return { merchant, total: rows.length, byStatus, tokens };
}

/** Network-wide aggregate of settled activity (all amounts are already public on-chain). */
export function explorerStats(): ExplorerStats {
  const SCALE = 1_000_000n;
  const rows = db
    .prepare('SELECT token, amount, merchant, paid_at FROM invoices WHERE status = ?')
    .all(InvoiceStatus.Paid) as Array<{ token: string; amount: string; merchant: string; paid_at: number | null }>;
  const since = nowSeconds() - 86_400;
  const merchants = new Set<string>();
  const volumes = new Map<string, { count: number; micros: bigint }>();
  let last24h = 0;
  for (const r of rows) {
    merchants.add(r.merchant.toLowerCase());
    const token = r.token.toLowerCase();
    const entry = volumes.get(token) ?? { count: 0, micros: 0n };
    entry.count += 1;
    entry.micros += decimalToMicros(r.amount, SCALE);
    volumes.set(token, entry);
    if (r.paid_at && r.paid_at >= since) last24h += 1;
  }
  const receipts = db.prepare('SELECT COUNT(*) AS c FROM receipts').get() as { c: number };
  return {
    paidCount: rows.length,
    activeMerchants: merchants.size,
    receiptsCount: Number(receipts.c),
    last24hPaidCount: last24h,
    volume: Array.from(volumes.entries()).map(([token, { count, micros }]) => ({
      token: token as Address,
      paidCount: count,
      paidVolume: microsToDecimal(micros, SCALE),
    })),
  };
}

export function getMerchantProfile(merchant: Address): MerchantProfile | undefined {
  const row = db.prepare('SELECT * FROM merchant_profiles WHERE lower(merchant) = lower(?)').get(merchant);
  return row ? mapMerchantProfile(row) : undefined;
}

/**
 * Create or update a merchant profile. `walletVerified` is set when the caller
 * proved wallet ownership (a SIWE session). Editable fields: displayName, website,
 * publicListed (opt-in to the public directory).
 */
export function upsertMerchantProfile(
  merchant: Address,
  patch: { displayName?: string; website?: string; publicListed?: boolean; walletVerified?: boolean },
): MerchantProfile {
  const ts = nowSeconds();
  const existing = getMerchantProfile(merchant);
  if (!existing) {
    db.prepare(
      `INSERT INTO merchant_profiles (merchant, display_name, website, public_listed, wallet_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      merchant.toLowerCase(),
      patch.displayName ?? null,
      patch.website ?? null,
      patch.publicListed ? 1 : 0,
      patch.walletVerified ? 1 : 0,
      ts,
      ts,
    );
    return getMerchantProfile(merchant)!;
  }
  db.prepare(
    `UPDATE merchant_profiles SET
       display_name = ?, website = ?, public_listed = ?, wallet_verified = ?, updated_at = ?
     WHERE lower(merchant) = lower(?)`,
  ).run(
    patch.displayName !== undefined ? patch.displayName : existing.displayName ?? null,
    patch.website !== undefined ? patch.website : existing.website ?? null,
    patch.publicListed !== undefined ? (patch.publicListed ? 1 : 0) : existing.publicListed ? 1 : 0,
    patch.walletVerified !== undefined ? (patch.walletVerified ? 1 : 0) : existing.walletVerified ? 1 : 0,
    ts,
    merchant.toLowerCase(),
  );
  return getMerchantProfile(merchant)!;
}

/** Issue a domain-verification challenge token (placed at /.well-known/qantara.txt). */
export function setMerchantDomainChallenge(merchant: Address, domain: string): MerchantProfile {
  const ts = nowSeconds();
  const token = `qantara-domain-${randomBytes(16).toString('hex')}`;
  upsertMerchantProfile(merchant, {});
  db.prepare(
    'UPDATE merchant_profiles SET domain = ?, domain_token = ?, domain_verified_at = NULL, updated_at = ? WHERE lower(merchant) = lower(?)',
  ).run(domain, token, ts, merchant.toLowerCase());
  return getMerchantProfile(merchant)!;
}

export function markMerchantDomainVerified(merchant: Address): MerchantProfile {
  db.prepare('UPDATE merchant_profiles SET domain_verified_at = ?, updated_at = ? WHERE lower(merchant) = lower(?)')
    .run(nowSeconds(), nowSeconds(), merchant.toLowerCase());
  return getMerchantProfile(merchant)!;
}

export function listPublicMerchants(page: { limit?: number; offset?: number } = {}): { merchants: MerchantProfile[]; total: number } {
  const limit = Math.max(1, Math.min(200, page.limit ?? 50));
  const offset = Math.max(0, page.offset ?? 0);
  const rows = db
    .prepare('SELECT * FROM merchant_profiles WHERE public_listed = 1 ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map(mapMerchantProfile);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM merchant_profiles WHERE public_listed = 1').get() as { c: number }).c;
  return { merchants: rows, total: Number(total) };
}

/** Aggregate the merchant's payers into a customer list. */
export function listMerchantPayers(merchant: Address): MerchantPayer[] {
  const SCALE = 1_000_000n;
  const rows = db
    .prepare(
      `SELECT payer, token, status, amount, paid_at, created_at
       FROM invoices WHERE lower(merchant) = lower(?) AND payer IS NOT NULL`,
    )
    .all(merchant) as Array<{ payer: string; token: string; status: number; amount: string; paid_at: number | null; created_at: number }>;

  const byPayer = new Map<string, { invoices: number; paid: number; last: number; volumes: Map<string, bigint> }>();
  for (const r of rows) {
    const key = r.payer.toLowerCase();
    const entry = byPayer.get(key) ?? { invoices: 0, paid: 0, last: 0, volumes: new Map<string, bigint>() };
    entry.invoices += 1;
    entry.last = Math.max(entry.last, r.paid_at ?? r.created_at);
    if (r.status === InvoiceStatus.Paid) {
      entry.paid += 1;
      const token = r.token.toLowerCase();
      entry.volumes.set(token, (entry.volumes.get(token) ?? 0n) + decimalToMicros(r.amount, SCALE));
    }
    byPayer.set(key, entry);
  }

  return Array.from(byPayer.entries())
    .map(([payer, e]) => ({
      payer: payer as Address,
      invoices: e.invoices,
      paid: e.paid,
      lastActivityAt: e.last,
      volume: Array.from(e.volumes.entries()).map(([token, micros]) => ({ token: token as Address, paidVolume: microsToDecimal(micros, SCALE) })),
    }))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function merchantAnalytics(merchant: Address): MerchantAnalytics {
  const invoiceRows = db
    .prepare('SELECT status, created_at, paid_at FROM invoices WHERE lower(merchant) = lower(?)')
    .all(merchant) as Array<{ status: number; created_at: number; paid_at: number | null }>;
  const total = invoiceRows.length;
  let paid = 0;
  let payDeltaSum = 0;
  let payDeltaCount = 0;
  for (const r of invoiceRows) {
    if (r.status === InvoiceStatus.Paid) {
      paid += 1;
      if (r.paid_at && r.paid_at >= r.created_at) {
        payDeltaSum += r.paid_at - r.created_at;
        payDeltaCount += 1;
      }
    }
  }

  const deliveries = db
    .prepare(
      `SELECT w.status AS status FROM webhook_deliveries w
       JOIN invoices i ON lower(w.invoice_hash) = lower(i.hash)
       WHERE lower(i.merchant) = lower(?)`,
    )
    .all(merchant) as Array<{ status: number }>;
  const whTotal = deliveries.length;
  const whFailed = deliveries.filter((d) => d.status < 200 || d.status >= 300).length;

  return {
    totalInvoices: total,
    paidInvoices: paid,
    conversionRate: total > 0 ? paid / total : 0,
    avgTimeToPaySeconds: payDeltaCount > 0 ? Math.round(payDeltaSum / payDeltaCount) : null,
    webhook: { total: whTotal, failed: whFailed, failureRate: whTotal > 0 ? whFailed / whTotal : 0 },
  };
}
