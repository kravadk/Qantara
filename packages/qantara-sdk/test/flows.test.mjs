import test from 'node:test';
import assert from 'node:assert/strict';
import { Qantara } from '../dist/index.mjs';

const INVOICE_HASH = `0x${'1'.repeat(64)}`;
const TX_HASH = `0x${'2'.repeat(64)}`;
const RECEIPT_HASH = `0x${'3'.repeat(64)}`;
const CREATE_TX = `0x${'4'.repeat(64)}`;
const ANCHOR_TX = `0x${'5'.repeat(64)}`;
const MERCHANT = '0x0000000000000000000000000000000000000123';
const PAYER = '0x0000000000000000000000000000000000000456';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function withRouter(routes, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const { pathname } = new URL(String(url));
    for (const [match, body] of routes) {
      if (pathname.includes(match)) return jsonResponse(body);
    }
    return jsonResponse({ error: 'not_found' }, { status: 404 });
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = previous;
    });
}

const paidInvoice = {
  hash: INVOICE_HASH,
  status: 1,
  payer: PAYER,
  paidTxHash: TX_HASH,
  paidAt: 1700000000,
  metadata: { chain_tx_hash: CREATE_TX },
};

const anchoredReceipt = {
  id: 'rcpt_1',
  invoiceHash: INVOICE_HASH,
  txHash: TX_HASH,
  payer: PAYER,
  merchant: MERCHANT,
  amount: '1',
  token: '0x0000000000000000000000000000000000000000',
  issuedAt: 1700000001,
  receiptHash: RECEIPT_HASH,
  verification: {
    source: 'backend_sqlite_rpc_verified',
    policy: 'issued_after_verified_payment',
    anchored: true,
    onChainAnchor: {
      enabled: true,
      configured: true,
      ready: true,
      registryAddress: '0x0000000000000000000000000000000000000789',
      status: 'anchored',
      mode: 'optional_receipt_registry',
      anchorTxHash: ANCHOR_TX,
      anchoredAt: 1700000002,
      anchorStatus: 'anchored',
    },
  },
};

test('flows.verifyPaymentChain aggregates the full proof chain from backend reads', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example' });
  // Order matters: '/events' and '/receipts' must be matched before bare '/invoices/'.
  const routes = [
    ['/events', { count: 1, limit: 50, offset: 0, events: [{ id: 'evt_1', invoiceHash: INVOICE_HASH, type: 'invoice.paid', payload: {}, createdAt: 1700000000 }] }],
    ['/receipts/', anchoredReceipt],
    ['/webhooks/deliveries', { count: 1, total: 1, limit: 50, offset: 0, deliveries: [{ id: 'whd_1', invoiceHash: INVOICE_HASH, eventType: 'invoice.paid', targetUrl: 'https://merchant.example/hook', status: 200, attempts: 1, createdAt: 1, updatedAt: 1 }] }],
    ['/invoices/', paidInvoice],
  ];

  await withRouter(routes, async () => {
    const chain = await sdk.flows.verifyPaymentChain(INVOICE_HASH);
    assert.equal(chain.invoiceHash, INVOICE_HASH);
    assert.equal(chain.paid, true);
    const byKey = Object.fromEntries(chain.steps.map((s) => [s.key, s]));
    assert.equal(byKey.create_tx.status, 'confirmed');
    assert.equal(byKey.create_tx.detail, CREATE_TX);
    assert.equal(byKey.payment_tx.status, 'confirmed');
    assert.equal(byKey.payment_tx.detail, TX_HASH);
    assert.equal(byKey.indexed_event.status, 'confirmed');
    assert.equal(byKey.rpc_verification.status, 'confirmed');
    assert.equal(byKey.receipt.status, 'confirmed');
    assert.equal(byKey.receipt.detail, RECEIPT_HASH);
    assert.equal(byKey.webhook.status, 'confirmed');
    assert.equal(byKey.onchain_anchor.status, 'confirmed');
    assert.equal(byKey.onchain_anchor.detail, ANCHOR_TX);
  });
});

test('flows.verifyPaymentChain degrades missing steps without throwing', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example' });
  // Unpaid invoice, no receipt/events/webhooks available (all 404 -> caught).
  const routes = [['/invoices/', { hash: INVOICE_HASH, status: 0, metadata: {} }]];

  await withRouter(routes, async () => {
    const chain = await sdk.flows.verifyPaymentChain(INVOICE_HASH);
    assert.equal(chain.paid, false);
    const byKey = Object.fromEntries(chain.steps.map((s) => [s.key, s]));
    assert.equal(byKey.create_tx.status, 'missing');
    assert.equal(byKey.payment_tx.status, 'missing');
    assert.equal(byKey.rpc_verification.status, 'missing');
    assert.equal(byKey.receipt.status, 'missing');
    assert.equal(byKey.onchain_anchor.status, 'missing');
  });
});

test('flows.awaitPayment returns immediately when the invoice is already paid', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example' });
  const routes = [
    ['/receipts/', anchoredReceipt],
    ['/invoices/', paidInvoice],
  ];

  await withRouter(routes, async () => {
    const result = await sdk.flows.awaitPayment(INVOICE_HASH, { pollMs: 1000, timeoutMs: 5000 });
    assert.equal(result.invoice?.status, 1);
    assert.equal(result.receipt?.receiptHash, RECEIPT_HASH);
  });
});

test('flows.preparePayment combines invoice, routes, and requirements', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example' });
  const routes = [
    ['/payment-routes/', { invoiceHash: INVOICE_HASH, routes: [], recommendedRouteId: null }],
    ['/payment-requirements/', { invoiceHash: INVOICE_HASH, requirement: { scheme: 'qantara' }, source: 'backend' }],
    ['/invoices/', paidInvoice],
  ];

  await withRouter(routes, async () => {
    const plan = await sdk.flows.preparePayment(INVOICE_HASH);
    assert.equal(plan.invoiceHash, INVOICE_HASH);
    assert.equal(plan.invoice?.status, 1);
    assert.ok(plan.routes);
    assert.ok(plan.requirements);
  });
});
