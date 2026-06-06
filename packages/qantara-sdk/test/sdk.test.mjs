import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { decodeFunctionData, parseAbi } from 'viem';
import { CHAIN_ID, RPC_URL, EXPLORER_URL, ADDRESSES, canonicalInvoiceCreateMessage, Qantara } from '../dist/index.mjs';

const INVOICE_HASH = `0x${'1'.repeat(64)}`;
const TX_HASH = `0x${'2'.repeat(64)}`;
const RECEIPT_HASH = `0x${'3'.repeat(64)}`;
const MERCHANT = '0x0000000000000000000000000000000000000123';
const PAYER = '0x0000000000000000000000000000000000000456';
const REGISTRY = '0x0000000000000000000000000000000000000789';
const receiptRegistryAbi = parseAbi([
  'function anchorReceipt(bytes32 invoiceHash,bytes32 receiptHash,bytes32 paymentTxHash,address merchant,address payer,string uri) external returns ((bytes32 invoiceHash,bytes32 receiptHash,bytes32 paymentTxHash,address merchant,address payer,address issuer,uint64 anchoredAt,string uri))',
]);

function withFetch(handler, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => handler(String(url), init);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = previous;
    });
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

test('exports QIE Mainnet constants', () => {
  assert.equal(CHAIN_ID, 1990);
  assert.equal(RPC_URL, 'https://rpc1mainnet.qie.digital');
  assert.equal(EXPLORER_URL, 'https://mainnet.qie.digital');
  assert.equal(typeof ADDRESSES, 'object');
});

test('canonicalInvoiceCreateMessage is deterministic and lowercases the merchant', () => {
  const base = {
    merchant: '0xAbC0000000000000000000000000000000000123',
    amount: '10',
    token: 'QIE',
    nonce: 'n1',
    signedAt: 1000,
  };
  const a = canonicalInvoiceCreateMessage({ ...base });
  const b = canonicalInvoiceCreateMessage({ ...base });
  assert.equal(a, b, 'message must be deterministic');
  assert.match(a, /^Qantara invoice create\n/);
  assert.match(a, /"merchant":"0xabc0000000000000000000000000000000000123"/);
  // Optional fields default to null, not undefined, so the JSON is stable.
  assert.match(a, /"memo":null/);
});

test('webhooks.verifyWebhook accepts a backend-compatible HMAC and rejects a bad one', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example' });
  const body = JSON.stringify({ type: 'invoice.paid', data: { invoice_hash: '0x' + '1'.repeat(64) } });
  const timestamp = '1700000000';
  const secret = 'whsec_test_value';
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  assert.equal(await sdk.webhooks.verifyWebhook({ body, timestamp, signature, secret }), true);
  assert.equal(await sdk.webhooks.verifyWebhook({ body, timestamp, signature: 'deadbeef', secret }), false);
  assert.equal(
    await sdk.webhooks.verifyWebhook({ body, timestamp, signature, secret: 'wrong_secret' }),
    false,
  );
});

test('constructor applies QIE defaults', () => {
  const sdk = new Qantara({});
  assert.equal(sdk.options.backendUrl, 'https://api.qantara.app');
  assert.equal(sdk.options.frontendUrl, 'https://qantara.app');
  assert.equal(sdk.options.chain, 'mainnet');
});

test('invoice builder returns Qantara calldata target', () => {
  const sdk = new Qantara({});
  const call = sdk.invoices.buildCreateInvoiceCall({
    salt: `0x${'a'.repeat(64)}`,
    amount: '0.001',
    token: 'QIE',
  });
  assert.equal(call.to, ADDRESSES.Qantara);
  assert.match(call.data, /^0x[0-9a-f]+$/i);
});

test('invoice mirror requires merchant and confirmed chain transaction hash', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example' });
  await assert.rejects(
    sdk.invoices.create({ amount: '1', token: 'QIE', chainTxHash: TX_HASH }),
    /merchant is required/,
  );
  await assert.rejects(
    sdk.invoices.create({ amount: '1', token: 'QIE', merchant: MERCHANT }),
    /chainTxHash is required/,
  );
});

test('invoice mirror sends API key as Authorization header and never as URL state', async () => {
  const sdk = new Qantara({
    backendUrl: 'https://api.example',
    frontendUrl: 'https://pay.example',
    apiKey: 'qantara_test_key',
  });
  await withFetch((url, init) => {
    assert.equal(url, 'https://api.example/v1/invoices');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer qantara_test_key');
    const body = JSON.parse(init.body);
    assert.equal(body.merchant, MERCHANT);
    assert.equal(body.chain_tx_hash, TX_HASH);
    assert.equal(body.token, 'QIE');
    return jsonResponse({ hash: INVOICE_HASH });
  }, async () => {
    const invoice = await sdk.invoices.create({
      merchant: MERCHANT,
      amount: '0.001',
      token: 'QIE',
      chainTxHash: TX_HASH,
    });
    assert.equal(invoice.hash, INVOICE_HASH);
    assert.equal(invoice.payUrl, `https://pay.example/pay/${INVOICE_HASH}`);
  });
});

test('SDK rejects API key material in backend query strings', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example?api_key=leaked' });
  await assert.rejects(sdk.ops.health(), /API keys must be sent with Authorization headers/);
});

test('chat sendMessage sends guest token header and message body', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example' });
  await withFetch((url, init) => {
    assert.equal(url, `https://api.example/v1/invoices/${INVOICE_HASH}/messages`);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('x-qantara-guest-token'), 'guest_123');
    const body = JSON.parse(init.body);
    assert.equal(body.sender_role, 'payer');
    assert.equal(body.sender_label, 'Payer');
    assert.equal(body.body, 'Question about delivery');
    return jsonResponse({
      ok: true,
      guest_token: 'guest_123',
      message: {
        id: 'msg_1',
        invoiceHash: INVOICE_HASH,
        senderRole: 'payer',
        body: 'Question about delivery',
        createdAt: 1700000000,
      },
    });
  }, async () => {
    const result = await sdk.chat.sendMessage(INVOICE_HASH, {
      senderRole: 'payer',
      senderLabel: 'Payer',
      body: 'Question about delivery',
      guestToken: 'guest_123',
    });
    assert.equal(result.message.id, 'msg_1');
  });
});

test('receipts status is public and reports receipt anchor readiness', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'server_only_key' });
  await withFetch((url, init) => {
    assert.equal(url, 'https://api.example/v1/receipts/status');
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), null);
    return jsonResponse({
      ok: true,
      source: 'sqlite',
      receipts: { total: 0, issued: 0 },
      verification: {
        source: 'backend_sqlite_rpc_verified',
        policy: 'issued_after_verified_payment',
        anchored: false,
        onChainAnchor: {
          enabled: false,
          configured: false,
          registryAddress: null,
          status: 'not_configured',
          mode: 'backend_receipt_only',
        },
      },
    });
  }, async () => {
    const status = await sdk.receipts.status();
    assert.equal(status.verification.anchored, false);
    assert.equal(status.verification.onChainAnchor.enabled, false);
  });
});

test('receipts.buildAnchorReceiptCall builds explicit registry calldata', () => {
  const sdk = new Qantara({});
  const call = sdk.receipts.buildAnchorReceiptCall(REGISTRY, {
    invoiceHash: INVOICE_HASH,
    receiptHash: RECEIPT_HASH,
    paymentTxHash: TX_HASH,
    merchant: MERCHANT,
    payer: PAYER,
    uri: 'ipfs://bafy-qantara-receipt',
  });

  assert.equal(call.to, REGISTRY);
  const decoded = decodeFunctionData({ abi: receiptRegistryAbi, data: call.data });
  assert.equal(decoded.functionName, 'anchorReceipt');
  assert.deepEqual(decoded.args, [
    INVOICE_HASH,
    RECEIPT_HASH,
    TX_HASH,
    MERCHANT,
    PAYER,
    'ipfs://bafy-qantara-receipt',
  ]);
});

test('payment verification stays public and does not attach merchant API key', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  await withFetch((url, init) => {
    assert.equal(url, `https://api.example/v1/invoices/${INVOICE_HASH}/verify-payment`);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), null);
    const body = JSON.parse(init.body);
    assert.equal(body.payer, PAYER);
    assert.equal(body.tx_hash, TX_HASH);
    return jsonResponse({ ok: true, invoice: { hash: INVOICE_HASH, status: 1 } });
  }, async () => {
    const invoice = await sdk.invoices.verifyPayment(INVOICE_HASH, { payer: PAYER, txHash: TX_HASH });
    assert.equal(invoice.hash, INVOICE_HASH);
  });
});

test('rails list targets the backend rail catalog without local fallback data', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  const response = {
    rails: [
      {
        id: 'qie-native',
        kind: 'invoice',
        network: 'qie-mainnet',
        chainId: 1990,
        tokenSymbol: 'QIE',
      },
    ],
    count: 1,
  };

  await withFetch((url, init) => {
    assert.equal(url, 'https://api.example/v1/rails');
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer merchant_key');
    return jsonResponse(response);
  }, async () => {
    assert.deepEqual(await sdk.rails.list(), response);
  });
});

test('rails.qusdcCapabilities reads backend capability probe without URL key state', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  const response = {
    configured: true,
    ready: true,
    status: 'ready',
    chainId: 1990,
    address: '0x0000000000000000000000000000000000000abc',
    token: { name: 'QIE USD Coin', symbol: 'QUSDC', decimals: 6 },
    capabilities: {
      erc20Transfer: true,
      approveAndPay: true,
      permit: false,
      eip3009: false,
    },
    source: 'rpc',
    checkedAt: 1700000000,
    reasons: [],
  };

  await withFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://api.example/v1/rails/qusdc/capabilities');
    assert.equal(parsed.searchParams.has('api_key'), false);
    assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer merchant_key');
    return jsonResponse(response);
  }, async () => {
    assert.deepEqual(await sdk.rails.qusdcCapabilities(), response);
  });
});

test('paymentRequirements.get calls the backend requirement endpoint without API key query state', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  const response = {
    invoiceHash: INVOICE_HASH,
    requirement: {
      scheme: 'qantara',
      network: 'qie:1990',
      chainId: 1990,
      token: 'QIE',
      amount: '1000000000000000',
      merchant: MERCHANT,
      invoiceHash: INVOICE_HASH,
    },
    source: 'backend',
  };

  await withFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, `https://api.example/v1/payment-requirements/${INVOICE_HASH}`);
    assert.equal(parsed.searchParams.get('payer'), PAYER);
    assert.equal(parsed.searchParams.get('format'), 'qantara');
    assert.equal(parsed.searchParams.has('api_key'), false);
    assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer merchant_key');
    return jsonResponse(response);
  }, async () => {
    assert.deepEqual(await sdk.paymentRequirements.get(INVOICE_HASH, {
      payer: PAYER,
      format: 'qantara',
    }), response);
  });
});

test('paymentRoutes.get calls the backend route planner without API key query state', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  const response = {
    invoiceHash: INVOICE_HASH,
    chainId: 1990,
    network: 'QIE Mainnet',
    state: 'ready',
    payable: true,
    token: { symbol: 'QIE', address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    amount: '0.001',
    merchant: MERCHANT,
    payer: null,
    expiresAt: null,
    recommendedRouteId: 'qie.direct_transfer',
    routes: [
      {
        id: 'qie.direct_transfer',
        rail: 'QIE',
        method: 'native-transfer',
        label: 'Native QIE direct transfer',
        state: 'ready',
        recommended: true,
        reason: 'Native QIE is the QIE chain gas token',
        token: { symbol: 'QIE', address: '0x0000000000000000000000000000000000000000', decimals: 18 },
        settlementContract: null,
        actions: [{ type: 'wallet_sendTransaction', label: 'Send QIE to merchant', target: MERCHANT, value: '0.001' }],
        verifyEndpoint: `/v1/invoices/${INVOICE_HASH}/verify-payment`,
        explorer: {
          merchantUrl: `https://mainnet.qie.digital/address/${MERCHANT}`,
          tokenUrl: null,
          settlementContractUrl: null,
          txUrlTemplate: 'https://mainnet.qie.digital/tx/{txHash}',
        },
        source: 'backend_invoice_and_rail_catalog',
      },
    ],
    dataSources: ['sqlite.invoice', 'backend.rails'],
  };

  await withFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, `https://api.example/v1/payment-routes/${INVOICE_HASH}`);
    assert.equal(parsed.searchParams.has('api_key'), false);
    assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer merchant_key');
    return jsonResponse(response);
  }, async () => {
    assert.deepEqual(await sdk.paymentRoutes.get(INVOICE_HASH), response);
  });
});

test('explorer.activity reads backend real-record activity and does not place API keys in URLs', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  const response = {
    activity: [
      {
        id: 'evt_1',
        type: 'invoice.paid',
        invoiceHash: INVOICE_HASH,
        txHash: TX_HASH,
        merchant: MERCHANT,
        payer: PAYER,
        tokenSymbol: 'QIE',
        amount: '0.001',
        createdAt: 1700000000,
      },
    ],
    count: 1,
    source: 'backend',
  };

  await withFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://api.example/v1/explorer/activity');
    assert.equal(parsed.searchParams.get('merchant'), MERCHANT);
    assert.equal(parsed.searchParams.get('invoice_hash'), INVOICE_HASH);
    assert.equal(parsed.searchParams.get('rail_id'), 'qie-native');
    assert.equal(parsed.searchParams.get('token'), 'QIE');
    assert.equal(parsed.searchParams.get('status'), 'paid');
    assert.equal(parsed.searchParams.get('type'), 'invoice.paid');
    assert.equal(parsed.searchParams.get('limit'), '10');
    assert.equal(parsed.searchParams.get('cursor'), 'evt_0');
    assert.equal(parsed.searchParams.has('api_key'), false);
    assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer merchant_key');
    return jsonResponse(response);
  }, async () => {
    assert.deepEqual(await sdk.explorer.activity({
      merchant: MERCHANT,
      invoiceHash: INVOICE_HASH,
      railId: 'qie-native',
      token: 'QIE',
      status: 'paid',
      type: 'invoice.paid',
      limit: 10,
      cursor: 'evt_0',
    }), response);
  });
});

test('explorer.merchants reads backend merchant directory without URL key state', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  const response = {
    merchants: [
      {
        merchant: MERCHANT,
        displayName: 'Qantara Store',
        website: 'https://merchant.example',
        verifiedDomain: true,
        activeInvoices: 3,
        paidInvoices: 2,
        volume: '0.004',
        tokenSymbols: ['QIE'],
        lastActivityAt: 1700000000,
      },
    ],
    count: 1,
    source: 'backend',
  };

  await withFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://api.example/v1/explorer/merchants');
    assert.equal(parsed.searchParams.get('limit'), '12');
    assert.equal(parsed.searchParams.get('offset'), '6');
    assert.equal(parsed.searchParams.has('api_key'), false);
    assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer merchant_key');
    return jsonResponse(response);
  }, async () => {
    assert.deepEqual(await sdk.explorer.merchants({ limit: 12, offset: 6 }), response);
  });
});

test('reconciliation.status reads backend status and does not place API keys in URLs', async () => {
  const sdk = new Qantara({ backendUrl: 'https://api.example', apiKey: 'merchant_key' });
  const response = {
    ok: true,
    status: 'ok',
    source: 'backend',
    checks: [
      {
        id: 'indexer.cursor',
        status: 'ok',
        source: 'indexer',
      },
    ],
  };

  await withFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://api.example/v1/reconciliation/status');
    assert.equal(parsed.searchParams.has('api_key'), false);
    assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer merchant_key');
    return jsonResponse(response);
  }, async () => {
    assert.deepEqual(await sdk.reconciliation.status(), response);
  });
});
