import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Wallet } from 'ethers';
import { SiweMessage } from 'siwe';

process.env.API_KEY = 'sk_test_suite';
process.env.QANTARA_FRONTEND_URL = 'https://pay.qie.example';
process.env.QUSDC_ADDRESS = '0x0000000000000000000000000000000000000001';
process.env.PAYMENT_INTENT_SECRET = 'intent_test_secret';
process.env.WEBHOOK_SECRET = 'webhook_test_secret';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';

function chainTxHash(seed: number): `0x${string}` {
  return `0x${seed.toString(16).padStart(64, '0')}`;
}

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const { createApp } = await import('./app.js');
  const app = createApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function jsonFetch(baseUrl: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({})) as any;
  return { res, body };
}

async function readSseEvents(baseUrl: string, path: string, headers: Record<string, string>, expectedCount: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: 'text/event-stream',
      ...headers,
    },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (buffer.split('\n\n').filter(Boolean).length < expectedCount) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
    controller.abort();
  }

  return buffer
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n');
      return JSON.parse(data);
    });
}

async function eventually<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 1500): Promise<T> {
  const started = Date.now();
  let last = await fn();
  while (!predicate(last) && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    last = await fn();
  }
  return last;
}

async function createSiweSession(baseUrl: string, wallet: { address: string; signMessage(message: string): Promise<string> }): Promise<string> {
  const nonce = await jsonFetch(baseUrl, '/v1/auth/nonce');
  assert.equal(nonce.res.status, 200);

  const message = new SiweMessage({
    domain: new URL(baseUrl).host,
    address: wallet.address,
    uri: baseUrl,
    version: '1',
    chainId: 1990,
    nonce: nonce.body.nonce,
  }).prepareMessage();

  const signature = await wallet.signMessage(message);
  const verified = await jsonFetch(baseUrl, '/v1/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  });
  assert.equal(verified.res.status, 200);
  assert.equal(verified.body.address.toLowerCase(), wallet.address.toLowerCase());
  assert.equal(typeof verified.body.token, 'string');
  return verified.body.token;
}

test('SIWE verification preserves nonce after invalid signature and rejects replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const nonce = await jsonFetch(server.baseUrl, '/v1/auth/nonce');
    assert.equal(nonce.res.status, 200);
    assert.equal(typeof nonce.body.nonce, 'string');

    const wallet = Wallet.createRandom();
    const message = new SiweMessage({
      domain: new URL(server.baseUrl).host,
      address: wallet.address,
      uri: server.baseUrl,
      version: '1',
      chainId: 1990,
      nonce: nonce.body.nonce,
    }).prepareMessage();

    const invalidSignature = await Wallet.createRandom().signMessage(message);
    const invalid = await jsonFetch(server.baseUrl, '/v1/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ message, signature: invalidSignature }),
    });
    assert.equal(invalid.res.status, 401);

    const signature = await wallet.signMessage(message);
    const verified = await jsonFetch(server.baseUrl, '/v1/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(verified.res.status, 200);
    assert.equal(verified.body.address.toLowerCase(), wallet.address.toLowerCase());
    assert.equal(typeof verified.body.token, 'string');

    const me = await jsonFetch(server.baseUrl, '/v1/auth/me', {
      headers: { Authorization: `Bearer ${verified.body.token}` },
    });
    assert.equal(me.res.status, 200);
    assert.equal(me.body.address, wallet.address.toLowerCase());

    const replay = await jsonFetch(server.baseUrl, '/v1/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(replay.res.status, 401);
    assert.equal(replay.body.error, 'unknown_or_expired_nonce');
  } finally {
    await server.close();
  }
});

test('invoice chat sanitizes messages, emits events, and scopes payer guest tokens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '42',
        token: 'QUSDC',
        merchant: '0x1111111111111111111111111111111111111111',
        memo: 'Deal room test',
        chain_tx_hash: chainTxHash(10),
      }),
    });
    assert.equal(created.res.status, 201);
    const hash = created.body.invoice_hash as string;

    const payerMessage = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        sender_role: 'payer',
        sender_label: 'Alice',
        body: '<script>alert(1)</script> Can you ship today?',
      }),
    });
    assert.equal(payerMessage.res.status, 201);
    assert.ok(payerMessage.body.guest_token);
    assert.equal(payerMessage.body.message.senderRole, 'payer');
    assert.equal(payerMessage.body.message.body.includes('<script>'), false);
    assert.match(payerMessage.body.message.body, /Can you ship today/);

    const merchantReply = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        sender_role: 'merchant',
        sender_label: 'Merchant',
        body: 'Yes, payment confirmation is enough.',
      }),
    });
    assert.equal(merchantReply.res.status, 201);

    const messages = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
      headers: { 'x-qantara-guest-token': payerMessage.body.guest_token },
    });
    assert.equal(messages.res.status, 200);
    assert.equal(messages.body.count, 2);

    const events = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/events`, {
      headers: { 'x-qantara-guest-token': payerMessage.body.guest_token },
    });
    assert.equal(events.res.status, 200);
    assert.ok(events.body.events.some((event: any) => event.type === 'invoice.created'));
    assert.ok(events.body.events.some((event: any) => event.type === 'message.created'));

    const notifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=0x1111111111111111111111111111111111111111`, {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(notifications.res.status, 200);
    assert.ok(notifications.body.notifications.some((notification: any) => notification.type === 'invoice_message'));
    const firstNotification = notifications.body.notifications[0];
    const markRead = await jsonFetch(server.baseUrl, `/v1/notifications/${firstNotification.id}/read`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ merchant: '0x1111111111111111111111111111111111111111' }),
    });
    assert.equal(markRead.res.status, 200);

    const afterRead = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=0x1111111111111111111111111111111111111111`, {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.ok(afterRead.body.notifications.some((notification: any) => notification.id === firstNotification.id && notification.readAt));

    const other = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '7',
        token: 'QIE',
        merchant: '0x1111111111111111111111111111111111111111',
        chain_tx_hash: chainTxHash(11),
      }),
    });
    assert.equal(other.res.status, 201);
    const leakAttempt = await jsonFetch(server.baseUrl, `/v1/invoices/${other.body.invoice_hash}/messages`, {
      headers: { 'x-qantara-guest-token': payerMessage.body.guest_token },
    });
    assert.equal(leakAttempt.res.status, 403);
  } finally {
    await server.close();
  }
});

test('public invoice reads and guest chat enforce persisted noise and spam boundaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '19',
        token: 'QIE',
        merchant: '0x1212121212121212121212121212121212121212',
        memo: 'Guest boundary invoice',
        chain_tx_hash: chainTxHash(401),
      }),
    });
    assert.equal(created.res.status, 201);
    const hash = created.body.invoice_hash as string;

    const firstRead = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}`);
    const secondRead = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}`);
    assert.equal(firstRead.res.status, 200);
    assert.equal(secondRead.res.status, 200);

    const events = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/events`);
    assert.equal(events.res.status, 200);
    assert.equal(events.body.events.filter((event: any) => event.type === 'invoice.viewed').length, 1);

    const invalidToken = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        sender_role: 'payer',
        sender_label: 'Buyer',
        guest_token: 'not-a-valid-token',
        body: 'I have a question before paying.',
      }),
    });
    assert.equal(invalidToken.res.status, 403);

    const firstMessage = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        sender_role: 'payer',
        sender_label: 'Buyer',
        body: 'I have a question before paying.',
      }),
    });
    assert.equal(firstMessage.res.status, 201);
    const guestToken = firstMessage.body.guest_token as string;

    for (let i = 0; i < 11; i += 1) {
      const sent = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
        method: 'POST',
        headers: { 'x-qantara-guest-token': guestToken },
        body: JSON.stringify({
          sender_role: 'payer',
          sender_label: 'Buyer',
          body: `Follow-up question ${i}`,
        }),
      });
      assert.equal(sent.res.status, 201);
    }

    const blocked = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
      method: 'POST',
      headers: { 'x-qantara-guest-token': guestToken },
      body: JSON.stringify({
        sender_role: 'payer',
        sender_label: 'Buyer',
        body: 'One more follow-up question',
      }),
    });
    assert.equal(blocked.res.status, 429);

    const messages = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/messages`, {
      headers: { 'x-qantara-guest-token': guestToken },
    });
    assert.equal(messages.res.status, 200);
    assert.equal(messages.body.total, 12);
  } finally {
    await server.close();
  }
});

test('checkout sessions reject malformed public inputs before persistence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const baseBody = {
      token: 'QIE',
      merchant: '0x1313131313131313131313131313131313131313',
      chain_tx_hash: chainTxHash(402),
    };

    const badAmount = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ ...baseBody, amount: '0' }),
    });
    assert.equal(badAmount.res.status, 400);

    const badTtl = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ ...baseBody, amount: '1', expires_in: 60 }),
    });
    assert.equal(badTtl.res.status, 400);

    const badUrl = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ ...baseBody, amount: '1', success_url: 'http://merchant.example/success' }),
    });
    assert.equal(badUrl.res.status, 400);

    const badSessionId = await jsonFetch(server.baseUrl, '/v1/checkout/sessions/not-a-session', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(badSessionId.res.status, 400);
  } finally {
    await server.close();
  }
});

test('health endpoint and demo invoice metadata use real backend state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const health = await jsonFetch(server.baseUrl, '/v1/health');
    assert.equal(health.res.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.db, 'ok');
    assert.equal(health.body.persistence, 'sqlite');
    assert.equal(typeof health.body.migrations.current, 'string');
    assert.equal(typeof health.body.rpc, 'object');
    assert.equal(typeof health.body.indexer.safety.confirmations, 'number');
    assert.equal(typeof health.body.indexer.safety.reorgRollbackBlocks, 'number');
    assert.equal(typeof health.body.operational, 'object');
    assert.equal(typeof health.body.operational.indexer.cursorAnchored, 'boolean');

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        amount: '3.5',
        token: 'QIE',
        merchant: '0x2222222222222222222222222222222222222222',
        title: 'Product tour invoice',
        metadata: { demo: true },
      }),
    });
    assert.equal(created.res.status, 201);
    assert.equal(created.body.metadata.demo, true);

    const loaded = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}`);
    assert.equal(loaded.res.status, 200);
    assert.equal(loaded.body.metadata.demo, true);

    const listed = await jsonFetch(server.baseUrl, '/v1/invoices?demo=true&merchant=0x2222222222222222222222222222222222222222');
    assert.equal(listed.res.status, 200);
    assert.equal(listed.body.count, 1);
    assert.equal(listed.body.invoices[0].metadata.demo, true);

    const events = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/events`);
    assert.equal(events.res.status, 200);
    assert.ok(events.body.events.some((event: any) => event.type === 'invoice.created'));
    assert.ok(events.body.events.some((event: any) => event.type === 'invoice.viewed'));
  } finally {
    await server.close();
  }
});

test('public status exposes safe operational health and security headers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  delete process.env.ERROR_TRACKING_DSN;
  delete process.env.SENTRY_DSN;

  const server = await startTestServer();
  try {
    const status = await jsonFetch(server.baseUrl, '/status');
    assert.equal(status.res.status, 200);
    assert.equal(status.body.ok, true);
    assert.match(status.body.status, /ok|degraded/);
    assert.equal(status.body.db, 'ok');
    assert.equal(status.body.errorTracking.enabled, false);
    assert.equal(status.body.errorTracking.provider, 'noop');
    assert.equal(JSON.stringify(status.body).includes('API_KEY'), false);
    assert.equal(JSON.stringify(status.body).includes('WEBHOOK_SECRET'), false);
    assert.equal(status.res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(status.res.headers.get('x-frame-options'), 'DENY');
    assert.match(status.res.headers.get('content-security-policy-report-only') ?? '', /frame-ancestors 'none'/);

    const v1Status = await jsonFetch(server.baseUrl, '/v1/status');
    assert.equal(v1Status.res.status, 200);
    assert.equal(v1Status.body.version, '1.0.0-rc.1');
  } finally {
    await server.close();
  }
});

test('public rails catalog exposes payment rail status without secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousQantara = process.env.QANTARA_ADDRESS;
  const previousQusdc = process.env.QUSDC_ADDRESS;
  const previousRpc = process.env.QIE_RPC_URL;
  const previousExplorer = process.env.QIE_EXPLORER_URL;
  const previousExplorerApi = process.env.QIE_EXPLORER_API_URL;
  const previousPaymaster = process.env.QUSDC_PAYMASTER_CHECKOUT_URL;
  const previousVault = process.env.QUSDC_VAULT_ADDRESS;
  const previousWusdc = process.env.WUSDC_ADDRESS;
  const previousMintMethod = process.env.QUSDC_VAULT_MINT_METHOD;

  process.env.QANTARA_ADDRESS = '0x27815fC2021345EB38B68D9C8F08679A4aeee030';
  process.env.QUSDC_ADDRESS = '0x88aBC76fd8e3d725139Ecc6BB75582aA3f14ec2D';
  process.env.QUSDC_VAULT_ADDRESS = '0x3333333333333333333333333333333333333333';
  process.env.WUSDC_ADDRESS = '0x4444444444444444444444444444444444444444';
  process.env.QUSDC_VAULT_MINT_METHOD = 'deposit';
  process.env.QIE_RPC_URL = 'https://user:secret@example-rpc.invalid/path?api_key=secret';
  delete process.env.QUSDC_PAYMASTER_CHECKOUT_URL;
  delete process.env.QIE_EXPLORER_URL;
  delete process.env.QIE_EXPLORER_API_URL;

  const server = await startTestServer();
  try {
    const rails = await jsonFetch(server.baseUrl, '/v1/rails');
    assert.equal(rails.res.status, 200);
    assert.equal(rails.body.ok, true);
    assert.equal(rails.body.network.chainId, 1990);
    assert.equal(rails.body.network.nativeCurrency.symbol, 'QIE');
    assert.equal(rails.body.network.explorer.baseUrl, 'https://mainnet.qie.digital');
    assert.equal(rails.body.network.explorer.txUrlTemplate, 'https://mainnet.qie.digital/tx/{txHash}');
    assert.equal(rails.body.rpc.label, 'custom');
    assert.notEqual(JSON.stringify(rails.body).includes('secret'), true);
    assert.equal(rails.body.networkCatalog.networks[0].chainId, 1990);
    assert.ok(rails.body.networkCatalog.networks[0].rpcUrls.length >= 2);
    assert.ok(rails.body.networkCatalog.networks.some((network: any) => network.chainId === 1983 && network.faucetUrl));
    assert.ok(rails.body.ecosystem.links.some((link: any) => link.id === 'bridge' && link.availability === 'available'));
    assert.ok(Array.isArray(rails.body.wallets));
    assert.ok(rails.body.wallets.some((wallet: any) => wallet.id === 'qie-wallet' && wallet.status === 'supported'));
    assert.equal(rails.body.tokens.qie.enabled, true);
    assert.equal(rails.body.tokens.qusdc.enabled, true);
    assert.equal(rails.body.tokens.qusdc.reason, 'QUSDC_ADDRESS is configured and matches the verified deployment registry');
    assert.ok(Array.isArray(rails.body.rails));
      assert.ok(rails.body.rails.some((rail: any) => (
        rail.tokenSymbol === 'QIE'
        && rail.tokenAddress === '0x0000000000000000000000000000000000000000'
        && rail.status === 'enabled'
        && rail.explorer.settlementContractUrl === 'https://mainnet.qie.digital/address/0x27815fC2021345EB38B68D9C8F08679A4aeee030'
      )));
    assert.ok(rails.body.rails.some((rail: any) => (
      rail.tokenSymbol === 'QUSDC'
      && rail.tokenAddress === '0x88aBC76fd8e3d725139Ecc6BB75582aA3f14ec2D'
      && rail.status === 'enabled'
    )));
    assert.ok(rails.body.contracts.some((contract: any) => (
      contract.key === 'Qantara'
      && contract.address === '0x27815fC2021345EB38B68D9C8F08679A4aeee030'
      && contract.status === 'configured'
    )));
    assert.ok(rails.body.supportedFlows.some((flow: any) => flow.key === 'qie.direct_transfer' && flow.enabled === true));
    assert.ok(rails.body.supportedFlows.some((flow: any) => flow.key === 'qusdc.gasless_paymaster' && flow.enabled === false));
    assert.ok(rails.body.supportedFlows.some((flow: any) => flow.key === 'qusdc.approve_and_pay' && flow.enabled === true));
    assert.equal(rails.body.paymaster.qusdc.reason, 'QUSDC_PAYMASTER_CHECKOUT_URL is not configured');
    assert.equal(rails.body.requiresRealTx, true);
    const mintRoute = rails.body.acquisitionRoutes.find((route: any) => route.id === 'qusdc.mint_vault');
    assert.equal(mintRoute.requiresRealTx, true);
    assert.equal(mintRoute.state, 'available');
    assert.equal(mintRoute.actionType, 'contract_mint');
    assert.equal(mintRoute.metadata.vaultAddress, '0x3333333333333333333333333333333333333333');
    assert.equal(mintRoute.metadata.wusdcAddress, '0x4444444444444444444444444444444444444444');
    assert.equal(mintRoute.metadata.mintMethod, 'deposit');

    const status = await jsonFetch(server.baseUrl, '/v1/rails/status');
    assert.equal(status.res.status, 200);
    assert.equal(status.body.tokens.qusdc.enabled, true);

    const networkCatalog = await jsonFetch(server.baseUrl, '/v1/qie/network-catalog');
    assert.equal(networkCatalog.res.status, 200);
    assert.equal(networkCatalog.body.networks[0].walletAddNetwork.chainId, '0x7c6');
    assert.equal(JSON.stringify(networkCatalog.body).includes('secret'), false);

    const ecosystem = await jsonFetch(server.baseUrl, '/v1/qie/ecosystem');
    assert.equal(ecosystem.res.status, 200);
    assert.ok(ecosystem.body.links.some((link: any) => link.id === 'wallet'));
  } finally {
    if (previousQantara === undefined) delete process.env.QANTARA_ADDRESS;
    else process.env.QANTARA_ADDRESS = previousQantara;
    if (previousQusdc === undefined) delete process.env.QUSDC_ADDRESS;
    else process.env.QUSDC_ADDRESS = previousQusdc;
    if (previousRpc === undefined) delete process.env.QIE_RPC_URL;
    else process.env.QIE_RPC_URL = previousRpc;
    if (previousExplorer === undefined) delete process.env.QIE_EXPLORER_URL;
    else process.env.QIE_EXPLORER_URL = previousExplorer;
    if (previousExplorerApi === undefined) delete process.env.QIE_EXPLORER_API_URL;
    else process.env.QIE_EXPLORER_API_URL = previousExplorerApi;
    if (previousPaymaster === undefined) delete process.env.QUSDC_PAYMASTER_CHECKOUT_URL;
    else process.env.QUSDC_PAYMASTER_CHECKOUT_URL = previousPaymaster;
    if (previousVault === undefined) delete process.env.QUSDC_VAULT_ADDRESS;
    else process.env.QUSDC_VAULT_ADDRESS = previousVault;
    if (previousWusdc === undefined) delete process.env.WUSDC_ADDRESS;
    else process.env.WUSDC_ADDRESS = previousWusdc;
    if (previousMintMethod === undefined) delete process.env.QUSDC_VAULT_MINT_METHOD;
    else process.env.QUSDC_VAULT_MINT_METHOD = previousMintMethod;
    await server.close();
  }
});

test('public explorer activity uses real persisted records and redacts private fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const empty = await jsonFetch(server.baseUrl, '/v1/explorer/activity');
    assert.equal(empty.res.status, 200);
    assert.equal(empty.body.source, 'sqlite');
    assert.equal(empty.body.count, 0);
    assert.equal(empty.body.total, 0);

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '12.5',
        token: 'QIE',
        merchant: '0x2222222222222222222222222222222222222222',
        title: 'Explorer invoice',
        memo: 'Real activity row',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        chain_tx_hash: chainTxHash(301),
        metadata: {
          public_note: 'visible',
          api_key: 'sk_should_not_leak',
          nested: {
            display: 'ok',
            webhook_secret: 'nested_secret_should_not_leak',
          },
        },
      }),
    });
    assert.equal(created.res.status, 201);

    const message = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        sender_role: 'payer',
        sender_label: 'Explorer payer',
        body: 'Is this invoice still open?',
      }),
    });
    assert.equal(message.res.status, 201);

    store.upsertWebhookDelivery({
      id: 'wd_explorer_private',
      invoiceHash: created.body.hash,
      eventType: 'invoice.created',
      targetUrl: 'https://merchant.example/private-webhook',
      status: 500,
      attempts: 1,
      lastError: 'contains internal delivery details',
      eventPayload: { secret: 'merchant_private_payload' },
    });

    const activity = await jsonFetch(
      server.baseUrl,
      '/v1/explorer/activity?merchant=0x2222222222222222222222222222222222222222&token=QIE&status=open&limit=10',
    );
    assert.equal(activity.res.status, 200);
    assert.equal(activity.body.count, 1);
    assert.equal(activity.body.total, 1);
    assert.equal(activity.body.activity[0].invoice.hash, created.body.hash);
    assert.equal(activity.body.activity[0].invoice.metadata.public_note, 'visible');
    assert.equal(activity.body.activity[0].invoice.metadata.nested.display, 'ok');
    assert.equal(activity.body.activity[0].invoice.messageCount, 1);
    assert.ok(activity.body.activity[0].recentEvents.some((event: any) => event.type === 'invoice.created'));

    const serialized = JSON.stringify(activity.body);
    assert.equal(serialized.includes('sk_should_not_leak'), false);
    assert.equal(serialized.includes('nested_secret_should_not_leak'), false);
    assert.equal(serialized.includes('private-webhook'), false);
    assert.equal(serialized.includes('merchant_private_payload'), false);
    assert.equal(serialized.includes(message.body.guest_token), false);
    assert.equal(serialized.includes('guestToken'), false);
    assert.equal(serialized.includes('webhookUrl'), false);
  } finally {
    const store = await import('./lib/store.js');
    store.clearAll();
    await server.close();
  }
});

test('payment requirements expose signed payable state only for open supported invoices', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const missing = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${chainTxHash(399)}`);
    assert.equal(missing.res.status, 404);

    const openQie = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '0.001',
        token: 'QIE',
        merchant: '0x3333333333333333333333333333333333333333',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        chain_tx_hash: chainTxHash(401),
      }),
    });
    assert.equal(openQie.res.status, 201);

    const qieRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${openQie.body.hash}`);
    assert.equal(qieRequirement.res.status, 200);
    assert.equal(qieRequirement.body.state, 'open');
    assert.equal(qieRequirement.body.payable, true);
    assert.equal(qieRequirement.body.requirement.chainId, 1990);
    assert.equal(qieRequirement.body.requirement.rail, 'qie-native');
    assert.equal(qieRequirement.body.requirement.token.symbol, 'QIE');
    assert.equal(qieRequirement.body.requirement.token.address, '0x0000000000000000000000000000000000000000');
    assert.equal(qieRequirement.body.requirement.verifyEndpoint, `/v1/invoices/${openQie.body.hash}/verify-payment`);
    assert.equal(qieRequirement.body.requirement.payUrl, `https://pay.qie.example/pay/${openQie.body.hash}`);
    assert.match(qieRequirement.body.requirement.signature, /^[a-f0-9]{64}$/);

    const openQusdc = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '1.25',
        token: 'QUSDC',
        merchant: '0x3333333333333333333333333333333333333333',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        chain_tx_hash: chainTxHash(402),
      }),
    });
    assert.equal(openQusdc.res.status, 201);

    const qusdcRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${openQusdc.body.hash}`);
    assert.equal(qusdcRequirement.res.status, 200);
    assert.equal(qusdcRequirement.body.requirement.rail, 'qusdc-erc20');
    assert.equal(qusdcRequirement.body.requirement.token.symbol, 'QUSDC');
    assert.equal(qusdcRequirement.body.requirement.token.address, process.env.QUSDC_ADDRESS);

    store.markPaid(openQie.body.hash, '0x4444444444444444444444444444444444444444', chainTxHash(403));
    const paidRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${openQie.body.hash}`);
    assert.equal(paidRequirement.res.status, 200);
    assert.equal(paidRequirement.body.state, 'paid');
    assert.equal(paidRequirement.body.payable, false);
    assert.equal(paidRequirement.body.requirement, null);

    const expired = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '0.002',
        token: 'QIE',
        merchant: '0x3333333333333333333333333333333333333333',
        expires_at: Math.floor(Date.now() / 1000) - 10,
        chain_tx_hash: chainTxHash(404),
      }),
    });
    assert.equal(expired.res.status, 201);
    const expiredRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${expired.body.hash}`);
    assert.equal(expiredRequirement.body.state, 'expired');
    assert.equal(expiredRequirement.body.payable, false);
    assert.equal(expiredRequirement.body.requirement, null);

    const paused = store.pauseInvoice(openQusdc.body.hash);
    assert.ok(paused);
    const pausedRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${openQusdc.body.hash}`);
    assert.equal(pausedRequirement.body.state, 'paused');
    assert.equal(pausedRequirement.body.requirement, null);

    const cancelled = store.createInvoice({
      merchant: '0x3333333333333333333333333333333333333333',
      amount: '0.003',
      token: '0x0000000000000000000000000000000000000000',
      hash: chainTxHash(405),
      chainTxHash: chainTxHash(406),
    });
    store.cancelInvoice(cancelled.hash);
    const cancelledRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${cancelled.hash}`);
    assert.equal(cancelledRequirement.body.state, 'cancelled');

    const refunded = store.createInvoice({
      merchant: '0x3333333333333333333333333333333333333333',
      amount: '0.004',
      token: '0x0000000000000000000000000000000000000000',
      hash: chainTxHash(407),
      chainTxHash: chainTxHash(408),
    });
    store.markPaid(refunded.hash, '0x4444444444444444444444444444444444444444', chainTxHash(409));
    store.refundInvoice(refunded.hash, 'test refund');
    const refundedRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${refunded.hash}`);
    assert.equal(refundedRequirement.body.state, 'refunded');

    const unsupported = store.createInvoice({
      merchant: '0x3333333333333333333333333333333333333333',
      amount: '0.005',
      token: '0x0000000000000000000000000000000000000002',
      hash: chainTxHash(410),
      chainTxHash: chainTxHash(411),
    });
    const unsupportedRequirement = await jsonFetch(server.baseUrl, `/v1/payment-requirements/${unsupported.hash}`);
    assert.equal(unsupportedRequirement.body.state, 'unsupported_token');
    assert.equal(unsupportedRequirement.body.payable, false);
    assert.equal(unsupportedRequirement.body.requirement, null);
  } finally {
    const store = await import('./lib/store.js');
    store.clearAll();
    await server.close();
  }
});

test('payment routes plan QIE and QUSDC actions from persisted invoices and rail catalog', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const previousQantara = process.env.QANTARA_ADDRESS;
  const previousQusdc = process.env.QUSDC_ADDRESS;
  process.env.QANTARA_ADDRESS = '0x27815fC2021345EB38B68D9C8F08679A4aeee030';
  process.env.QUSDC_ADDRESS = '0x88aBC76fd8e3d725139Ecc6BB75582aA3f14ec2D';

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const missing = await jsonFetch(server.baseUrl, `/v1/payment-routes/${chainTxHash(420)}`);
    assert.equal(missing.res.status, 404);
    assert.equal(missing.body.error, 'not_found');

    const qie = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '0.001',
        token: 'QIE',
        merchant: '0x4242424242424242424242424242424242424242',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        chain_tx_hash: chainTxHash(421),
      }),
    });
    assert.equal(qie.res.status, 201);

    const qieRoutes = await jsonFetch(server.baseUrl, `/v1/payment-routes/${qie.body.hash}`);
    assert.equal(qieRoutes.res.status, 200);
    assert.equal(qieRoutes.body.invoiceHash, qie.body.hash);
    assert.equal(qieRoutes.body.chainId, 1990);
    assert.equal(qieRoutes.body.state, 'ready');
    assert.equal(qieRoutes.body.payable, true);
    assert.equal(qieRoutes.body.token.symbol, 'QIE');
    assert.equal(qieRoutes.body.recommendedRouteId, 'qie.direct_transfer');
    assert.ok(qieRoutes.body.routes.some((route: any) => route.id === 'qie.direct_transfer' && route.recommended === true));
    assert.ok(qieRoutes.body.routes.some((route: any) => route.id === 'qie.qantara_invoice'));
    assert.equal(qieRoutes.body.requiresRealTx, true);
    assert.ok(qieRoutes.body.acquisitionRoutes.some((route: any) => route.id === 'qie.bridge' && route.requiresRealTx === true));
    assert.deepEqual(qieRoutes.body.dataSources, ['sqlite.invoice', 'backend.rails', 'qie.rpc.health', 'deployment.registry']);
    assert.equal(JSON.stringify(qieRoutes.body).includes('sk_test_suite'), false);
    assert.equal(JSON.stringify(qieRoutes.body).includes('guestToken'), false);

    const qusdc = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '1.25',
        token: 'QUSDC',
        merchant: '0x4242424242424242424242424242424242424242',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        chain_tx_hash: chainTxHash(422),
      }),
    });
    assert.equal(qusdc.res.status, 201);

    const qusdcRoutes = await jsonFetch(server.baseUrl, `/v1/payment-routes/${qusdc.body.hash}`);
    assert.equal(qusdcRoutes.res.status, 200);
    assert.equal(qusdcRoutes.body.token.symbol, 'QUSDC');
    assert.equal(qusdcRoutes.body.recommendedRouteId, 'qusdc.approve_and_pay');
    assert.ok(qusdcRoutes.body.acquisitionRoutes.some((route: any) => route.id === 'qusdc.dex'));
    assert.ok(qusdcRoutes.body.externalActions.every((route: any) => route.actionType === 'external_link'));
    assert.ok(qusdcRoutes.body.routes.some((route: any) => route.id === 'qusdc.direct_transfer'));
    assert.ok(qusdcRoutes.body.routes.some((route: any) => (
      route.id === 'qusdc.approve_and_pay'
      && route.actions.some((action: any) => action.type === 'erc20_approve')
      && route.actions.some((action: any) => action.method === 'payInvoiceERC20')
    )));

    store.markPaid(qie.body.hash, '0x4343434343434343434343434343434343434343', chainTxHash(423));
    const paidRoutes = await jsonFetch(server.baseUrl, `/v1/payment-routes/${qie.body.hash}`);
    assert.equal(paidRoutes.res.status, 200);
    assert.equal(paidRoutes.body.state, 'settled');
    assert.equal(paidRoutes.body.payable, false);
    assert.equal(paidRoutes.body.recommendedRouteId, null);
    assert.ok(paidRoutes.body.routes.every((route: any) => route.state === 'settled'));
  } finally {
    if (previousQantara) process.env.QANTARA_ADDRESS = previousQantara;
    else delete process.env.QANTARA_ADDRESS;
    if (previousQusdc) process.env.QUSDC_ADDRESS = previousQusdc;
    else delete process.env.QUSDC_ADDRESS;
    const store = await import('./lib/store.js');
    store.clearAll();
    await server.close();
  }
});

test('reconciliation status returns real zero state for an empty database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousQantara = process.env.QANTARA_ADDRESS;
  process.env.QANTARA_ADDRESS = '0x1111111111111111111111111111111111111111';

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const status = await jsonFetch(server.baseUrl, '/v1/reconciliation/status');
    assert.equal(status.res.status, 200);
    assert.equal(status.body.ok, true);
    assert.equal(status.body.source, 'sqlite');
    assert.equal(status.body.db.status, 'ok');
    assert.equal(typeof status.body.db.migrations.current, 'string');
    assert.equal(status.body.invoices.total, 0);
    assert.deepEqual(status.body.invoices.byStatus, {
      open: 0,
      paid: 0,
      cancelled: 0,
      refunded: 0,
      paused: 0,
    });
    assert.equal(status.body.receipts.total, 0);
    assert.equal(status.body.chain.events.total, 0);
    assert.deepEqual(status.body.chain.events.recent, []);
    assert.equal(status.body.webhooks.totalDeliveries, 0);
    assert.equal(status.body.webhooks.failedDeliveries, 0);
    assert.deepEqual(status.body.webhooks.recentFailures, []);
    assert.equal(status.body.rpcVerification.failures24h, 0);
    assert.deepEqual(status.body.rpcVerification.recentFailures, []);
  } finally {
    const store = await import('./lib/store.js');
    store.clearAll();
    if (previousQantara === undefined) delete process.env.QANTARA_ADDRESS;
    else process.env.QANTARA_ADDRESS = previousQantara;
    await server.close();
  }
});

test('reconciliation status aggregates persisted invoices, receipts, chain events and redacted failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousQantara = process.env.QANTARA_ADDRESS;
  const previousRpc = process.env.QIE_RPC_URL;
  process.env.QANTARA_ADDRESS = '0x2222222222222222222222222222222222222222';
  process.env.QIE_RPC_URL = 'https://user:rpc_secret@example.invalid/rpc';

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '1.5',
        token: 'QIE',
        merchant: '0x3333333333333333333333333333333333333333',
        title: 'Reconciliation invoice',
        chain_tx_hash: chainTxHash(501),
      }),
    });
    assert.equal(created.res.status, 201);

    store.markPaid(created.body.hash, '0x4444444444444444444444444444444444444444', chainTxHash(502));
    store.setChainCursor(
      process.env.QANTARA_ADDRESS,
      700,
      `0x${'a'.repeat(64)}` as `0x${string}`,
      `0x${'b'.repeat(64)}` as `0x${string}`,
    );
    store.recordChainEvent({
      contractAddress: process.env.QANTARA_ADDRESS as `0x${string}`,
      invoiceHash: created.body.hash,
      eventType: 'InvoicePaid',
      txHash: chainTxHash(503),
      blockNumber: 700,
      logIndex: 0,
      payload: {
        publicAmount: '1.5',
        webhook_secret: 'chain_payload_secret',
      },
    });
    store.upsertWebhookDelivery({
      id: 'wd_reconciliation_private',
      invoiceHash: created.body.hash,
      eventId: 'evt_reconciliation_private',
      eventType: 'invoice.paid',
      targetUrl: 'https://merchant.example/private-reconciliation-webhook',
      status: 500,
      attempts: 2,
      lastError: 'receiver returned 500',
      nextRetryAt: Math.floor(Date.now() / 1000) - 1,
      eventPayload: { secret: 'private_delivery_payload' },
    });
    store.appendInvoiceEvent(created.body.hash, 'payment.verification_failed', {
      txHash: chainTxHash(504),
      reason: 'receipt did not match invoice',
      webhookUrl: 'https://merchant.example/private-failure-webhook',
      apiKey: 'sk_private_failure_key',
    });

    const status = await jsonFetch(server.baseUrl, '/v1/reconciliation/status');
    assert.equal(status.res.status, 200);
    assert.equal(status.body.invoices.total, 1);
    assert.equal(status.body.invoices.byStatus.paid, 1);
    assert.equal(status.body.receipts.total, 1);
    assert.equal(status.body.chain.contractAddress, process.env.QANTARA_ADDRESS);
    assert.equal(status.body.chain.indexer.cursors[0].lastBlock, 700);
    assert.equal(status.body.chain.events.total, 1);
    assert.equal(status.body.chain.events.recent[0].eventType, 'InvoicePaid');
    assert.equal(status.body.chain.events.recent[0].payload.publicAmount, '1.5');
    assert.equal(status.body.webhooks.totalDeliveries, 1);
    assert.equal(status.body.webhooks.failedDeliveries, 1);
    assert.equal(status.body.webhooks.dueRetries, 1);
    assert.equal(status.body.webhooks.recentFailures[0].id, 'wd_reconciliation_private');
    assert.equal(status.body.rpcVerification.failures24h, 1);
    assert.equal(status.body.rpcVerification.recentFailures[0].payload.txHash, chainTxHash(504));
    assert.equal(status.body.chain.rpc.url, 'custom');
    assert.notEqual(JSON.stringify(status.body).includes('rpc_secret'), true);

    const serialized = JSON.stringify(status.body);
    assert.equal(serialized.includes('private-reconciliation-webhook'), false);
    assert.equal(serialized.includes('private_delivery_payload'), false);
    assert.equal(serialized.includes('private-failure-webhook'), false);
    assert.equal(serialized.includes('sk_private_failure_key'), false);
    assert.equal(serialized.includes('chain_payload_secret'), false);
    assert.equal(serialized.includes('targetUrl'), false);
    assert.equal(serialized.includes('eventPayload'), false);
  } finally {
    const store = await import('./lib/store.js');
    store.clearAll();
    if (previousQantara === undefined) delete process.env.QANTARA_ADDRESS;
    else process.env.QANTARA_ADDRESS = previousQantara;
    if (previousRpc === undefined) delete process.env.QIE_RPC_URL;
    else process.env.QIE_RPC_URL = previousRpc;
    await server.close();
  }
});

test('invoice event SSE replay honors Last-Event-ID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '8',
        token: 'QIE',
        merchant: '0x2424242424242424242424242424242424242424',
        title: 'Replay cursor invoice',
        chain_tx_hash: chainTxHash(12),
      }),
    });
    assert.equal(created.res.status, 201);

    const initialEvents = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/events`);
    const createdEvent = initialEvents.body.events.find((event: any) => event.type === 'invoice.created');
    assert.ok(createdEvent);

    const viewed = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}`);
    assert.equal(viewed.res.status, 200);

    const replayed = await readSseEvents(
      server.baseUrl,
      `/v1/invoices/${created.body.hash}/events`,
      { 'Last-Event-ID': createdEvent.id },
      1,
    );
    assert.equal(replayed.length, 1);
    assert.equal(replayed[0].type, 'invoice.viewed');
    assert.notEqual(replayed[0].id, createdEvent.id);
  } finally {
    await server.close();
  }
});

test('settings and notification endpoints enforce public and merchant boundaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const merchantA = '0x1010101010101010101010101010101010101010';
  const merchantB = '0x2020202020202020202020202020202020202020';
  const server = await startTestServer();
  try {
    const publicSettings = await jsonFetch(server.baseUrl, '/v1/settings/status');
    assert.equal(publicSettings.res.status, 401);

    const publicNotifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantA}`);
    assert.equal(publicNotifications.res.status, 401);

    const readKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant A notification reader',
        merchant: merchantA,
        scopes: ['notifications:read'],
      }),
    });
    assert.equal(readKey.res.status, 201);
    const writeKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant A notification writer',
        merchant: merchantA,
        scopes: ['notifications:read', 'notifications:write'],
      }),
    });
    assert.equal(writeKey.res.status, 201);
    const authRead = { Authorization: `Bearer ${readKey.body.secret}` };
    const authA = { Authorization: `Bearer ${writeKey.body.secret}` };

    const invoiceA = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '14',
        token: 'QIE',
        merchant: merchantA,
        title: 'Merchant A notification',
        chain_tx_hash: chainTxHash(120),
      }),
    });
    assert.equal(invoiceA.res.status, 201);

    const invoiceB = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '15',
        token: 'QIE',
        merchant: merchantB,
        title: 'Merchant B notification',
        chain_tx_hash: chainTxHash(121),
      }),
    });
    assert.equal(invoiceB.res.status, 201);

    const ownNotifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantA}`, {
      headers: authRead,
    });
    assert.equal(ownNotifications.res.status, 200);
    assert.ok(ownNotifications.body.notifications.length > 0);
    assert.equal(ownNotifications.body.notifications.every((notification: any) => notification.invoiceHash === invoiceA.body.hash), true);

    const firstNotification = ownNotifications.body.notifications[0];
    const readOnlyMarkRead = await jsonFetch(server.baseUrl, `/v1/notifications/${firstNotification.id}/read`, {
      method: 'POST',
      headers: authRead,
      body: JSON.stringify({ merchant: merchantA }),
    });
    assert.equal(readOnlyMarkRead.res.status, 401);

    const markRead = await jsonFetch(server.baseUrl, `/v1/notifications/${firstNotification.id}/read`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ merchant: merchantA }),
    });
    assert.equal(markRead.res.status, 200);

    const unknownMarkRead = await jsonFetch(server.baseUrl, '/v1/notifications/evt_missing/read', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ merchant: merchantA }),
    });
    assert.equal(unknownMarkRead.res.status, 404);

    const afterRead = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantA}`, {
      headers: authRead,
    });
    const persistedNotification = afterRead.body.notifications.find((notification: any) => notification.id === firstNotification.id);
    assert.ok(persistedNotification);
    assert.equal(typeof persistedNotification.readAt, 'number');

    const crossList = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantB}`, {
      headers: authRead,
    });
    assert.equal(crossList.res.status, 403);
    assert.equal(crossList.body.error, 'merchant_scope_mismatch');

    const merchantBNotifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantB}`, {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(merchantBNotifications.res.status, 200);
    assert.ok(merchantBNotifications.body.notifications.some((notification: any) => notification.invoiceHash === invoiceB.body.hash));

    const crossMarkRead = await jsonFetch(server.baseUrl, `/v1/notifications/${merchantBNotifications.body.notifications[0].id}/read`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ merchant: merchantB }),
    });
    assert.equal(crossMarkRead.res.status, 403);
    assert.equal(crossMarkRead.body.error, 'merchant_scope_mismatch');

    const crossMarkWithOwnMerchant = await jsonFetch(server.baseUrl, `/v1/notifications/${merchantBNotifications.body.notifications[0].id}/read`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ merchant: merchantA }),
    });
    assert.equal(crossMarkWithOwnMerchant.res.status, 404);

    const readAll = await jsonFetch(server.baseUrl, '/v1/notifications/read-all', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ merchant: merchantA, ids: [firstNotification.id, merchantBNotifications.body.notifications[0].id, 'evt_missing'] }),
    });
    assert.equal(readAll.res.status, 200);
    assert.equal(readAll.body.count, 1);
  } finally {
    await server.close();
  }
});

test('SIWE sessions can read operational status and notifications for their merchant only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const walletA = Wallet.createRandom();
  const walletB = Wallet.createRandom();
  const merchantA = walletA.address.toLowerCase();
  const merchantB = walletB.address.toLowerCase();
  const server = await startTestServer();
  try {
    const tokenA = await createSiweSession(server.baseUrl, walletA);
    const authA = { Authorization: `Bearer ${tokenA}` };

    const invoiceA = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '18',
        token: 'QIE',
        merchant: merchantA,
        title: 'SIWE notification',
        chain_tx_hash: chainTxHash(123),
      }),
    });
    assert.equal(invoiceA.res.status, 201);

    const invoiceB = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '19',
        token: 'QIE',
        merchant: merchantB,
        title: 'Other merchant notification',
        chain_tx_hash: chainTxHash(124),
      }),
    });
    assert.equal(invoiceB.res.status, 201);

    const settings = await jsonFetch(server.baseUrl, '/v1/settings/status', { headers: authA });
    assert.equal(settings.res.status, 200);
    assert.equal(settings.body.backend.invoices, 1);

    const ownNotifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantA}`, {
      headers: authA,
    });
    assert.equal(ownNotifications.res.status, 200);
    assert.ok(ownNotifications.body.notifications.length > 0);
    assert.equal(ownNotifications.body.notifications.every((notification: any) => notification.invoiceHash === invoiceA.body.hash), true);

    const crossNotifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantB}`, {
      headers: authA,
    });
    assert.equal(crossNotifications.res.status, 403);
    assert.equal(crossNotifications.body.error, 'merchant_scope_mismatch');

    const firstNotification = ownNotifications.body.notifications[0];
    const markRead = await jsonFetch(server.baseUrl, `/v1/notifications/${firstNotification.id}/read`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ merchant: merchantA }),
    });
    assert.equal(markRead.res.status, 200);

    const merchantBNotifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchantB}`, {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(merchantBNotifications.res.status, 200);
    assert.ok(merchantBNotifications.body.notifications.length > 0);
    const crossMarkRead = await jsonFetch(server.baseUrl, `/v1/notifications/${merchantBNotifications.body.notifications[0].id}/read`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ merchant: merchantB }),
    });
    assert.equal(crossMarkRead.res.status, 403);
  } finally {
    await server.close();
  }
});

test('notifications are derived from persisted events beyond the first page of invoices', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const merchant = '0x3030303030303030303030303030303030303030';
  const server = await startTestServer();
  try {
    for (let i = 0; i < 205; i += 1) {
      const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test_suite' },
        body: JSON.stringify({
          amount: '1',
          token: 'QIE',
          merchant,
          title: `Persisted event invoice ${i}`,
          chain_tx_hash: chainTxHash(4000 + i),
        }),
      });
      assert.equal(created.res.status, 201);
    }

    const notifications = await jsonFetch(server.baseUrl, `/v1/notifications?merchant=${merchant}&limit=5&offset=200`, {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(notifications.res.status, 200);
    assert.equal(notifications.body.total, 205);
    assert.equal(notifications.body.count, 5);
  } finally {
    await server.close();
  }
});

test('post-payment return redirects to the merchant URL and gates success on payment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const checkout = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '7',
        token: 'QIE',
        merchant: '0x6161616161616161616161616161616161616161',
        success_url: 'https://merchant.example/success',
        cancel_url: 'https://merchant.example/cancel',
        chain_tx_hash: chainTxHash(701),
      }),
    });
    assert.equal(checkout.res.status, 201);
    const hash = checkout.body.invoice_hash as string;

    // Success return is blocked until the invoice is paid.
    const successUnpaid = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/return?type=success`);
    assert.equal(successUnpaid.res.status, 409);
    assert.equal(successUnpaid.body.error, 'not_paid');

    // Cancel return redirects to the merchant cancel URL (which stays server-side).
    const cancelRes = await fetch(`${server.baseUrl}/v1/invoices/${hash}/return?type=cancel`, { redirect: 'manual' });
    assert.equal(cancelRes.status, 302);
    assert.equal(cancelRes.headers.get('location'), 'https://merchant.example/cancel');

    // An invoice without return URLs yields 404.
    const plain = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ amount: '1', token: 'QIE', merchant: '0x6161616161616161616161616161616161616161', title: 'No return', chain_tx_hash: chainTxHash(702) }),
    });
    assert.equal(plain.res.status, 201);
    const noReturn = await jsonFetch(server.baseUrl, `/v1/invoices/${plain.body.hash}/return?type=success`);
    assert.equal(noReturn.res.status, 404);
  } finally {
    await server.close();
  }
});

test('public invoice reads strip internal delivery and metadata fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const checkout = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '19',
        token: 'QIE',
        merchant: '0x3333333333333333333333333333333333333333',
        memo: 'Private webhook config',
        success_url: 'https://merchant.example/success',
        cancel_url: 'https://merchant.example/cancel',
        webhook_url: 'https://merchant.example/webhooks/qantara',
        chain_tx_hash: chainTxHash(20),
      }),
    });
    assert.equal(checkout.res.status, 201);

    const publicCheckout = await jsonFetch(server.baseUrl, `/v1/invoices/${checkout.body.invoice_hash}`);
    assert.equal(publicCheckout.res.status, 200);
    assert.equal('webhookUrl' in publicCheckout.body, false);
    assert.equal('successUrl' in publicCheckout.body, false);
    assert.equal('cancelUrl' in publicCheckout.body, false);
    assert.equal('guestToken' in publicCheckout.body, false);
    assert.equal('webhookEvents' in publicCheckout.body, false);
    assert.equal(publicCheckout.body.has_success_url, true);
    assert.equal(publicCheckout.body.has_cancel_url, true);

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '5',
        token: 'QIE',
        merchant: '0x3333333333333333333333333333333333333333',
        title: 'Metadata hygiene',
        metadata: {
          demo: true,
          public_note: 'visible',
          api_key: 'secret-value',
          webhook_url: 'https://merchant.example/private',
          nested: { internal_delivery_id: 'delivery-1', visible: 'yes' },
        },
      }),
    });
    assert.equal(created.res.status, 201);

    const loaded = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}`);
    assert.equal(loaded.res.status, 200);
    assert.equal(loaded.body.metadata.demo, true);
    assert.equal(loaded.body.metadata.public_note, 'visible');
    assert.equal(loaded.body.metadata.api_key, undefined);
    assert.equal(loaded.body.metadata.webhook_url, undefined);
    assert.deepEqual(loaded.body.metadata.nested, { visible: 'yes' });

    const listed = await jsonFetch(server.baseUrl, '/v1/invoices?demo=true&merchant=0x3333333333333333333333333333333333333333');
    assert.equal(listed.res.status, 200);
    assert.equal(listed.body.invoices[0].metadata.api_key, undefined);
    assert.equal('webhookEvents' in listed.body.invoices[0], false);
  } finally {
    await server.close();
  }
});

test('public invoice list requires an address filter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const unfiltered = await jsonFetch(server.baseUrl, '/v1/invoices');
    assert.equal(unfiltered.res.status, 400);
    assert.equal(unfiltered.body.error, 'filter_required');

    const filtered = await jsonFetch(server.baseUrl, '/v1/invoices?merchant=0xffffffffffffffffffffffffffffffffffffffff');
    assert.equal(filtered.res.status, 200);
    assert.equal(filtered.body.count, 0);
  } finally {
    await server.close();
  }
});

test('receipt list is API scoped while receipt lookup remains shareable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousReceiptRegistry = process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS;
  delete process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS;

  const server = await startTestServer();
  try {
    const status = await jsonFetch(server.baseUrl, '/v1/receipts/status');
    assert.equal(status.res.status, 200);
    assert.equal(status.body.source, 'sqlite');
    assert.equal(status.body.receipts.total, 0);
    assert.equal(status.body.verification.source, 'backend_sqlite_rpc_verified');
    assert.equal(status.body.verification.onChainAnchor.enabled, false);
    assert.equal(status.body.verification.onChainAnchor.registryAddress, null);

    const publicList = await jsonFetch(server.baseUrl, '/v1/receipts');
    assert.equal(publicList.res.status, 401);

    const scopedList = await jsonFetch(server.baseUrl, '/v1/receipts', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(scopedList.res.status, 200);
    assert.equal(scopedList.body.count, 0);

    const missingReceipt = await jsonFetch(server.baseUrl, `/v1/receipts/${chainTxHash(201)}`);
    assert.equal(missingReceipt.res.status, 404);
  } finally {
    if (previousReceiptRegistry) process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS = previousReceiptRegistry;
    else delete process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS;
    await server.close();
  }
});

test('API key responses are redacted and revoked keys stop authorizing requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const merchant = '0x3131313131313131313131313131313131313131';
  const server = await startTestServer();
  try {
    const parentKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant key admin',
        merchant,
        scopes: ['api_keys:write', 'receipts:read'],
      }),
    });
    assert.equal(parentKey.res.status, 201);
    assert.equal('secret' in parentKey.body.key, false);
    assert.equal('keyHash' in parentKey.body.key, false);
    assert.equal(typeof parentKey.body.key.prefix, 'string');

    const auth = { Authorization: `Bearer ${parentKey.body.secret}` };
    const blockedScope = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'Escalated child key',
        merchant,
        scopes: ['webhooks:write'],
      }),
    });
    assert.equal(blockedScope.res.status, 403);
    assert.equal(blockedScope.body.error, 'scope_escalation');

    const unsupportedScope = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Unsupported scoped key',
        merchant,
        scopes: ['receipts:read', '*'],
      }),
    });
    assert.equal(unsupportedScope.res.status, 400);
    assert.equal(unsupportedScope.body.error, 'invalid_scope');

    const emptyScope = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Empty scoped key',
        merchant,
        scopes: [],
      }),
    });
    assert.equal(emptyScope.res.status, 400);
    assert.equal(emptyScope.body.error, 'invalid_scope');

    const childKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: 'Receipt reader',
        merchant,
        scopes: ['receipts:read'],
      }),
    });
    assert.equal(childKey.res.status, 201);
    assert.equal('secret' in childKey.body.key, false);
    assert.equal('keyHash' in childKey.body.key, false);

    const listed = await jsonFetch(server.baseUrl, `/v1/api-keys?merchant=${merchant}`, {
      headers: auth,
    });
    assert.equal(listed.res.status, 200);
    assert.equal(listed.body.keys.some((key: any) => key.id === childKey.body.key.id), true);
    assert.equal(listed.body.keys.every((key: any) => !('secret' in key) && !('keyHash' in key)), true);

    const revoked = await jsonFetch(server.baseUrl, `/v1/api-keys/${childKey.body.key.id}/revoke`, {
      method: 'POST',
      headers: auth,
    });
    assert.equal(revoked.res.status, 200);
    assert.equal(typeof revoked.body.key.revokedAt, 'number');
    assert.equal('secret' in revoked.body.key, false);

    const revokedUse = await jsonFetch(server.baseUrl, '/v1/receipts', {
      headers: { Authorization: `Bearer ${childKey.body.secret}` },
    });
    assert.equal(revokedUse.res.status, 401);
  } finally {
    await server.close();
  }
});

test('wallet session can self-issue an API key scoped to its own merchant', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const wallet = Wallet.createRandom();
    const merchant = wallet.address.toLowerCase();
    const token = await createSiweSession(server.baseUrl, wallet);
    const sessionAuth = { Authorization: `Bearer ${token}` };

    // Self-issue with no explicit scopes: key binds to the session's own merchant
    // and is capped to the session scopes (no telegram:write, no api_keys:write).
    const minted = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: sessionAuth,
      body: JSON.stringify({ name: 'My integration key' }),
    });
    assert.equal(minted.res.status, 201);
    assert.equal(minted.body.key.merchant, merchant);
    assert.equal(typeof minted.body.secret, 'string');
    assert.equal(minted.body.key.scopes.includes('telegram:write'), false);
    assert.equal(minted.body.key.scopes.includes('api_keys:write'), false);
    assert.equal(minted.body.key.scopes.includes('invoices:write'), true);

    // The minted key works for server-to-server invoice creation.
    const invoice = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${minted.body.secret}` },
      body: JSON.stringify({
        amount: '5',
        token: 'QIE',
        merchant,
        title: 'Self-serve invoice',
        chain_tx_hash: chainTxHash(911),
      }),
    });
    assert.equal(invoice.res.status, 201);

    // A session cannot mint a key for a different merchant.
    const otherMerchant = '0x5151515151515151515151515151515151515151';
    const crossMerchant = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: sessionAuth,
      body: JSON.stringify({ name: 'Foreign key', merchant: otherMerchant }),
    });
    assert.equal(crossMerchant.res.status, 403);
    assert.equal(crossMerchant.body.error, 'merchant_scope_mismatch');

    // Listing returns only the caller's own keys.
    const listed = await jsonFetch(server.baseUrl, '/v1/api-keys', { headers: sessionAuth });
    assert.equal(listed.res.status, 200);
    assert.equal(listed.body.keys.every((key: any) => key.merchant === merchant), true);
  } finally {
    await server.close();
  }
});

test('webhook signing secrets are per-merchant, stable, and rotatable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const walletA = Wallet.createRandom();
    const walletB = Wallet.createRandom();
    const tokenA = await createSiweSession(server.baseUrl, walletA);
    const tokenB = await createSiweSession(server.baseUrl, walletB);

    const secretA = await jsonFetch(server.baseUrl, '/v1/webhooks/secret', { headers: { Authorization: `Bearer ${tokenA}` } });
    const secretB = await jsonFetch(server.baseUrl, '/v1/webhooks/secret', { headers: { Authorization: `Bearer ${tokenB}` } });
    assert.equal(secretA.res.status, 200);
    assert.equal(secretB.res.status, 200);
    assert.equal(secretA.body.merchant, walletA.address.toLowerCase());
    assert.equal(typeof secretA.body.secret, 'string');
    assert.equal(secretA.body.secret.startsWith('whsec_'), true);
    // Distinct merchants get distinct secrets — one merchant cannot forge another's signature.
    assert.notEqual(secretA.body.secret, secretB.body.secret);

    // Reads are stable (lazily provisioned once, then returned as-is).
    const secretAagain = await jsonFetch(server.baseUrl, '/v1/webhooks/secret', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(secretAagain.body.secret, secretA.body.secret);

    // Signature isolation: the same payload signed with A's secret does not match B's.
    const ts = 1_700_000_000;
    const body = JSON.stringify({ hello: 'world' });
    const sigA = createHmac('sha256', secretA.body.secret).update(`${ts}.${body}`).digest('hex');
    const sigB = createHmac('sha256', secretB.body.secret).update(`${ts}.${body}`).digest('hex');
    assert.notEqual(sigA, sigB);

    // Rotation issues a fresh secret for the caller's own merchant.
    const rotated = await jsonFetch(server.baseUrl, '/v1/webhooks/secret/rotate', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(rotated.res.status, 200);
    assert.equal(rotated.body.ok, true);
    assert.notEqual(rotated.body.secret, secretA.body.secret);
    assert.equal(rotated.body.rotatedAt >= secretA.body.rotatedAt, true);

    // Operator key has no merchant boundary and cannot manage a merchant secret.
    const operator = await jsonFetch(server.baseUrl, '/v1/webhooks/secret', { headers: { Authorization: 'Bearer sk_test_suite' } });
    assert.equal(operator.res.status, 403);
    assert.equal(operator.body.error, 'merchant_boundary_required');
  } finally {
    await server.close();
  }
});

test('per-merchant daily invoice quota blocks once the cap is reached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  process.env.MERCHANT_DAILY_INVOICE_QUOTA = '2';

  const server = await startTestServer();
  try {
    const wallet = Wallet.createRandom();
    const merchant = wallet.address.toLowerCase();
    const token = await createSiweSession(server.baseUrl, wallet);
    const auth = { Authorization: `Bearer ${token}` };

    const makeInvoice = (seed: number) =>
      jsonFetch(server.baseUrl, '/v1/invoices', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ amount: '1', token: 'QIE', merchant, title: `Quota ${seed}`, chain_tx_hash: chainTxHash(seed) }),
      });

    assert.equal((await makeInvoice(9001)).res.status, 201);
    assert.equal((await makeInvoice(9002)).res.status, 201);
    const blocked = await makeInvoice(9003);
    assert.equal(blocked.res.status, 429);
    assert.equal(blocked.body.error, 'quota_exceeded');

    // Operator key bypasses the per-merchant quota.
    const operatorCreate = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ amount: '1', token: 'QIE', merchant, title: 'Operator', chain_tx_hash: chainTxHash(9004) }),
    });
    assert.equal(operatorCreate.res.status, 201);
  } finally {
    delete process.env.MERCHANT_DAILY_INVOICE_QUOTA;
    await server.close();
  }
});

test('merchants manage their own default Telegram chat in isolation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const walletA = Wallet.createRandom();
    const walletB = Wallet.createRandom();
    const tokenA = await createSiweSession(server.baseUrl, walletA);
    const tokenB = await createSiweSession(server.baseUrl, walletB);

    // Initially unset.
    const empty = await jsonFetch(server.baseUrl, '/v1/telegram/merchant', { headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(empty.res.status, 200);
    assert.equal(empty.body.link, null);

    // Set A's default chat.
    const setA = await jsonFetch(server.baseUrl, '/v1/telegram/merchant', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ chat_id: '123456789' }),
    });
    assert.equal(setA.res.status, 200);
    assert.equal(setA.body.link.chatId, '123456789');
    assert.equal(setA.body.link.merchant, walletA.address.toLowerCase());

    // B does not see A's chat.
    const readB = await jsonFetch(server.baseUrl, '/v1/telegram/merchant', { headers: { Authorization: `Bearer ${tokenB}` } });
    assert.equal(readB.res.status, 200);
    assert.equal(readB.body.link, null);

    // Reject malformed chat id.
    const bad = await jsonFetch(server.baseUrl, '/v1/telegram/merchant', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ chat_id: 'not-a-chat' }),
    });
    assert.equal(bad.res.status, 400);

    // Delete A's chat.
    const del = await jsonFetch(server.baseUrl, '/v1/telegram/merchant', { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
    assert.equal(del.res.status, 200);
    assert.equal(del.body.removed, true);
  } finally {
    await server.close();
  }
});

test('billing summary is merchant scoped and counts invoices by status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const wallet = Wallet.createRandom();
    const merchant = wallet.address.toLowerCase();
    const token = await createSiweSession(server.baseUrl, wallet);
    const auth = { Authorization: `Bearer ${token}` };

    for (const seed of [8101, 8102]) {
      const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ amount: '3', token: 'QIE', merchant, title: `Bill ${seed}`, chain_tx_hash: chainTxHash(seed) }),
      });
      assert.equal(created.res.status, 201);
    }

    const summary = await jsonFetch(server.baseUrl, '/v1/billing/summary', { headers: auth });
    assert.equal(summary.res.status, 200);
    assert.equal(summary.body.merchant, merchant);
    assert.equal(summary.body.total, 2);
    assert.equal(summary.body.byStatus.created, 2);
    assert.equal(summary.body.byStatus.paid, 0);
    // No paid invoices yet → no token volume rows.
    assert.equal(Array.isArray(summary.body.tokens), true);
    assert.equal(summary.body.tokens.length, 0);

    // Operator key has no merchant boundary.
    const operator = await jsonFetch(server.baseUrl, '/v1/billing/summary', { headers: { Authorization: 'Bearer sk_test_suite' } });
    assert.equal(operator.res.status, 403);
    assert.equal(operator.body.error, 'merchant_boundary_required');
  } finally {
    await server.close();
  }
});

test('public explorer stats and merchant directory respect opt-in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    // Public stats endpoint requires no auth and returns a stable shape.
    const stats = await jsonFetch(server.baseUrl, '/v1/explorer/stats');
    assert.equal(stats.res.status, 200);
    assert.equal(typeof stats.body.paidCount, 'number');
    assert.equal(typeof stats.body.activeMerchants, 'number');
    assert.equal(Array.isArray(stats.body.volume), true);

    // A merchant is absent from the public directory until it opts in.
    const wallet = Wallet.createRandom();
    const token = await createSiweSession(server.baseUrl, wallet);
    const auth = { Authorization: `Bearer ${token}` };

    const before = await jsonFetch(server.baseUrl, '/v1/explorer/merchants');
    assert.equal(before.body.merchants.some((m: any) => m.merchant === wallet.address.toLowerCase()), false);

    const updated = await jsonFetch(server.baseUrl, '/v1/merchants/me', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ display_name: 'Acme', website: 'https://acme.example', public_listed: true }),
    });
    assert.equal(updated.res.status, 200);
    assert.equal(updated.body.trust.walletVerified, true);
    assert.equal(updated.body.listed, true);

    const after = await jsonFetch(server.baseUrl, '/v1/explorer/merchants');
    assert.equal(after.body.merchants.some((m: any) => m.merchant === wallet.address.toLowerCase()), true);
  } finally {
    await server.close();
  }
});

test('merchant domain verification confirms the well-known token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  let wellKnown: { server: ReturnType<typeof createServer>; origin: string; setToken: (t: string) => void } | undefined;
  try {
    let served = '';
    const wk = createServer((req, res) => {
      if (req.url === '/.well-known/qantara.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(served);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => wk.listen(0, '127.0.0.1', resolve));
    const addr = wk.address();
    assert(addr && typeof addr === 'object');
    wellKnown = { server: wk, origin: `http://127.0.0.1:${addr.port}`, setToken: (t) => { served = t; } };

    const wallet = Wallet.createRandom();
    const token = await createSiweSession(server.baseUrl, wallet);
    const auth = { Authorization: `Bearer ${token}` };

    const challenge = await jsonFetch(server.baseUrl, '/v1/merchants/me/domain/challenge', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ domain: wellKnown.origin }),
    });
    assert.equal(challenge.res.status, 200);
    assert.equal(typeof challenge.body.token, 'string');

    // Verification fails until the token is served.
    const failed = await jsonFetch(server.baseUrl, '/v1/merchants/me/domain/verify', { method: 'POST', headers: auth });
    assert.equal(failed.res.status, 422);

    wellKnown.setToken(challenge.body.token);
    const verified = await jsonFetch(server.baseUrl, '/v1/merchants/me/domain/verify', { method: 'POST', headers: auth });
    assert.equal(verified.res.status, 200);
    assert.equal(verified.body.trust.domainVerified, true);

    // Public profile reflects the verified domain.
    const pub = await jsonFetch(server.baseUrl, `/v1/merchants/${wallet.address.toLowerCase()}`);
    assert.equal(pub.body.trust.domainVerified, true);
  } finally {
    wellKnown?.server.close();
    await server.close();
  }
});

test('billing analytics and CSV export are merchant scoped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const wallet = Wallet.createRandom();
    const merchant = wallet.address.toLowerCase();
    const token = await createSiweSession(server.baseUrl, wallet);
    const auth = { Authorization: `Bearer ${token}` };

    await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ amount: '4', token: 'QIE', merchant, title: 'Analytics', chain_tx_hash: chainTxHash(8201) }),
    });

    const analytics = await jsonFetch(server.baseUrl, '/v1/billing/analytics', { headers: auth });
    assert.equal(analytics.res.status, 200);
    assert.equal(analytics.body.totalInvoices, 1);
    assert.equal(analytics.body.paidInvoices, 0);
    assert.equal(analytics.body.conversionRate, 0);
    assert.equal(analytics.body.avgTimeToPaySeconds, null);
    assert.equal(typeof analytics.body.webhook.failureRate, 'number');

    const csv = await fetch(`${server.baseUrl}/v1/billing/receipts.csv`, { headers: auth });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    const body = await csv.text();
    assert.match(body.split('\n')[0], /^id,invoiceHash,txHash/);
  } finally {
    await server.close();
  }
});

test('openapi spec is served publicly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const spec = await jsonFetch(server.baseUrl, '/v1/openapi.json');
    assert.equal(spec.res.status, 200);
    assert.equal(spec.body.openapi, '3.1.0');
    assert.ok(spec.body.paths['/v1/merchants/me']);
    assert.ok(spec.body.paths['/v1/billing/analytics']);
  } finally {
    await server.close();
  }
});

test('merchant customers list is scoped and dispute-lite endpoints are wired', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const wallet = Wallet.createRandom();
    const merchant = wallet.address.toLowerCase();
    const token = await createSiweSession(server.baseUrl, wallet);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ amount: '6', token: 'QIE', merchant, title: 'Customer test', chain_tx_hash: chainTxHash(8301) }),
    });
    assert.equal(created.res.status, 201);
    const hash = created.body.hash as string;

    // Customers list is merchant-scoped (empty until payments settle on-chain).
    const customers = await jsonFetch(server.baseUrl, '/v1/billing/customers', { headers: auth });
    assert.equal(customers.res.status, 200);
    assert.equal(Array.isArray(customers.body.customers), true);

    const operatorCustomers = await jsonFetch(server.baseUrl, '/v1/billing/customers', { headers: { Authorization: 'Bearer sk_test_suite' } });
    assert.equal(operatorCustomers.res.status, 403);

    // Dispute open requires a payer guest session.
    const openNoGuest = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/dispute/open`, { method: 'POST', headers: {}, body: JSON.stringify({ reason: 'item not delivered' }) });
    assert.equal(openNoGuest.res.status, 403);

    // Dispute resolve validates the resolution value (merchant path).
    const badResolve = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/dispute/resolve`, { method: 'POST', headers: auth, body: JSON.stringify({ resolution: 'nope' }) });
    assert.equal(badResolve.res.status, 400);
    assert.equal(badResolve.body.error, 'bad_request');

    const okResolve = await jsonFetch(server.baseUrl, `/v1/invoices/${hash}/dispute/resolve`, { method: 'POST', headers: auth, body: JSON.stringify({ resolution: 'resolved', message: 'sorted in chat' }) });
    assert.equal(okResolve.res.status, 200);
    assert.equal(okResolve.body.ok, true);
  } finally {
    await server.close();
  }
});

test('settings status is merchant scoped and does not expose webhook secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const merchantA = '0x4141414141414141414141414141414141414141';
  const merchantB = '0x4242424242424242424242424242424242424242';
  const server = await startTestServer();
  try {
    const invoiceA = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '11',
        token: 'QIE',
        merchant: merchantA,
        title: 'Merchant A operations',
        chain_tx_hash: chainTxHash(211),
      }),
    });
    assert.equal(invoiceA.res.status, 201);

    const invoiceB = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '12',
        token: 'QIE',
        merchant: merchantB,
        title: 'Merchant B operations',
        chain_tx_hash: chainTxHash(212),
      }),
    });
    assert.equal(invoiceB.res.status, 201);

    const store = await import('./lib/store.js');
    const nextRetryAt = Math.floor(Date.now() / 1000) - 1;
    store.upsertWebhookDelivery({
      id: 'wh_settings_a',
      invoiceHash: invoiceA.body.hash,
      eventType: 'invoice.created',
      targetUrl: 'https://merchant-a.example/private-webhook',
      status: 500,
      attempts: 1,
      lastError: 'HTTP 500',
      nextRetryAt,
      eventPayload: { secret: 'merchant-a-payload' },
    });
    store.upsertWebhookDelivery({
      id: 'wh_settings_b',
      invoiceHash: invoiceB.body.hash,
      eventType: 'invoice.created',
      targetUrl: 'https://merchant-b.example/private-webhook',
      status: 500,
      attempts: 1,
      lastError: 'HTTP 500',
      nextRetryAt,
      eventPayload: { secret: 'merchant-b-payload' },
    });

    const keyA = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant A ops',
        merchant: merchantA,
        scopes: ['ops:read'],
      }),
    });
    assert.equal(keyA.res.status, 201);

    const settings = await jsonFetch(server.baseUrl, '/v1/settings/status', {
      headers: { Authorization: `Bearer ${keyA.body.secret}` },
    });
    assert.equal(settings.res.status, 200);
    assert.equal(settings.body.backend.invoices, 1);
    assert.equal(settings.body.webhooks.dueRetries, 1);
    assert.equal(settings.body.webhooks.stats.total, 1);
    assert.equal(settings.body.webhooks.stats.recentFailures[0].invoiceHash, invoiceA.body.hash);
    assert.equal('targetUrl' in settings.body.webhooks.stats.recentFailures[0], false);
    assert.equal('eventPayload' in settings.body.webhooks.stats.recentFailures[0], false);
    assert.doesNotMatch(JSON.stringify(settings.body), /merchant-b\.example|merchant-b-payload/);
  } finally {
    await server.close();
  }
});

test('metrics endpoint exports operational gauges without unverified payment state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousConfirmations = process.env.CHAIN_CONFIRMATIONS;
  const previousRollbackBlocks = process.env.CHAIN_REORG_ROLLBACK_BLOCKS;
  process.env.CHAIN_CONFIRMATIONS = '7';
  process.env.CHAIN_REORG_ROLLBACK_BLOCKS = '19';

  const server = await startTestServer();
  try {
    const res = await fetch(`${server.baseUrl}/v1/metrics`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
    assert.match(body, /qantara_backend_up 1/);
    assert.match(body, /qantara_operational_healthy [01]/);
    assert.match(body, /qantara_rpc_verification_failures_24h 0/);
    assert.match(body, /qantara_indexer_cursor_anchored [01]/);
    assert.match(body, /qantara_indexer_confirmations 7/);
    assert.match(body, /qantara_indexer_reorg_rollback_blocks 19/);
    assert.doesNotMatch(body, /paid.*synthetic|synthetic.*paid/i);
  } finally {
    await server.close();
    if (previousConfirmations === undefined) delete process.env.CHAIN_CONFIRMATIONS;
    else process.env.CHAIN_CONFIRMATIONS = previousConfirmations;
    if (previousRollbackBlocks === undefined) delete process.env.CHAIN_REORG_ROLLBACK_BLOCKS;
    else process.env.CHAIN_REORG_ROLLBACK_BLOCKS = previousRollbackBlocks;
  }
});

test('deployment registry reports configured contract versions without replacing env addresses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousCore = process.env.QANTARA_ADDRESS;
  process.env.QANTARA_ADDRESS = '0x27815fC2021345EB38B68D9C8F08679A4aeee030';

  const server = await startTestServer();
  try {
    const publicStatus = await jsonFetch(server.baseUrl, '/v1/deployments/status');
    assert.equal(publicStatus.res.status, 401);

    const status = await jsonFetch(server.baseUrl, '/v1/deployments/status', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(status.res.status, 200);
    assert.equal(status.body.network, 'qieMainnet');
    assert.equal(status.body.chainId, 1990);
    assert.equal(status.body.requiredConfigured, true);
    assert.ok(status.body.contracts.some((contract: any) => (
      contract.key === 'Qantara'
      && contract.version === 'v1'
      && contract.status === 'configured'
      && contract.verified === true
    )));

    const settings = await jsonFetch(server.baseUrl, '/v1/settings/status', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(settings.res.status, 200);
    assert.equal(settings.body.contracts.registry.requiredConfigured, true);
  } finally {
    if (previousCore) process.env.QANTARA_ADDRESS = previousCore;
    else delete process.env.QANTARA_ADDRESS;
    await server.close();
  }
});

test('operational deployment, relay, and onramp reads require authenticated boundaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const publicRelayStatus = await jsonFetch(server.baseUrl, '/v1/relay/status');
    assert.equal(publicRelayStatus.res.status, 401);

    const publicRelayRecent = await jsonFetch(server.baseUrl, '/v1/relay/recent');
    assert.equal(publicRelayRecent.res.status, 401);

    const publicOnrampOrders = await jsonFetch(
      server.baseUrl,
      '/v1/onramp/orders?wallet=0x1111111111111111111111111111111111111111',
    );
    assert.equal(publicOnrampOrders.res.status, 401);

    const openSponsorValidation = await jsonFetch(server.baseUrl, '/v1/relay/sponsor', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(openSponsorValidation.res.status, 400);
    assert.equal(openSponsorValidation.body.error, 'missing_forward_request');

    const unboundedKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Unbounded ops reader',
        scopes: ['ops:read'],
      }),
    });
    assert.equal(unboundedKey.res.status, 201);
    const unboundedAuth = { Authorization: `Bearer ${unboundedKey.body.secret}` };

    const unboundedDeployments = await jsonFetch(server.baseUrl, '/v1/deployments/status', {
      headers: unboundedAuth,
    });
    assert.equal(unboundedDeployments.res.status, 403);
    assert.equal(unboundedDeployments.body.error, 'merchant_boundary_required');

    const unboundedRelayRecent = await jsonFetch(server.baseUrl, '/v1/relay/recent', {
      headers: unboundedAuth,
    });
    assert.equal(unboundedRelayRecent.res.status, 403);

    const unboundedOnrampOrders = await jsonFetch(
      server.baseUrl,
      '/v1/onramp/orders?wallet=0x1111111111111111111111111111111111111111',
      { headers: unboundedAuth },
    );
    assert.equal(unboundedOnrampOrders.res.status, 403);

    const merchantKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant ops reader',
        merchant: '0x1212121212121212121212121212121212121212',
        scopes: ['ops:read'],
      }),
    });
    assert.equal(merchantKey.res.status, 201);
    const merchantAuth = { Authorization: `Bearer ${merchantKey.body.secret}` };

    const merchantDeployments = await jsonFetch(server.baseUrl, '/v1/deployments/status', {
      headers: merchantAuth,
    });
    assert.equal(merchantDeployments.res.status, 200);
    assert.equal(merchantDeployments.body.network, 'qieMainnet');

    const merchantRelayRecent = await jsonFetch(server.baseUrl, '/v1/relay/recent', {
      headers: merchantAuth,
    });
    assert.equal(merchantRelayRecent.res.status, 200);
    assert.deepEqual(merchantRelayRecent.body.items, []);

    const invalidWallet = await jsonFetch(server.baseUrl, '/v1/onramp/orders?wallet=0x1234', {
      headers: merchantAuth,
    });
    assert.equal(invalidWallet.res.status, 400);
    assert.equal(invalidWallet.body.error, 'invalid_wallet');

    const merchantOnrampOrders = await jsonFetch(
      server.baseUrl,
      '/v1/onramp/orders?wallet=0x1111111111111111111111111111111111111111',
      { headers: merchantAuth },
    );
    assert.equal(merchantOnrampOrders.res.status, 200);
    assert.deepEqual(merchantOnrampOrders.body.items, []);
  } finally {
    await server.close();
  }
});

test('telegram invoice links are persisted in backend storage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '13',
        token: 'QIE',
        merchant: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        memo: 'Telegram persisted link',
        chain_tx_hash: chainTxHash(30),
      }),
    });
    assert.equal(created.res.status, 201);

    const saved = await jsonFetch(server.baseUrl, '/v1/telegram/links', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        invoice_hash: created.body.invoice_hash,
        chat_id: '12345',
        creator_id: '67890',
      }),
    });
    assert.equal(saved.res.status, 201);
    assert.equal(saved.body.link.invoiceHash, created.body.invoice_hash);
    assert.equal(saved.body.link.chatId, '12345');

    const listed = await jsonFetch(server.baseUrl, '/v1/telegram/links?chat_id=12345', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(listed.res.status, 200);
    assert.equal(listed.body.total, 1);
    assert.equal(listed.body.links[0].invoiceHash, created.body.invoice_hash);

    const loaded = await jsonFetch(server.baseUrl, `/v1/telegram/links/${created.body.invoice_hash}`, {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(loaded.res.status, 200);
    assert.equal(loaded.body.link.chatId, '12345');

    const invalidChat = await jsonFetch(server.baseUrl, '/v1/telegram/links', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        invoice_hash: created.body.invoice_hash,
        chat_id: 'not-a-chat-id',
      }),
    });
    assert.equal(invalidChat.res.status, 400);

    const invalidList = await jsonFetch(server.baseUrl, '/v1/telegram/links?chat_id=not-a-chat-id', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(invalidList.res.status, 400);
  } finally {
    await server.close();
  }
});

test('merchant can create and verify signed payment intents for real invoices', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '12.25',
        token: 'QIE',
        merchant: '0x3333333333333333333333333333333333333333',
        title: 'Signed intent invoice',
        chain_tx_hash: chainTxHash(101),
      }),
    });
    assert.equal(created.res.status, 201);

    const intent = await jsonFetch(server.baseUrl, '/v1/payment-intents', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        invoice_hash: created.body.hash,
        ttl_seconds: 600,
      }),
    });
    assert.equal(intent.res.status, 201);
    assert.match(intent.body.intent.id, /^pi_/);
    assert.equal(intent.body.intent.invoiceHash, created.body.hash);
    assert.equal(intent.body.intent.amount, '12.25');
    assert.equal(typeof intent.body.intent.signature, 'string');

    const publicVerify = await jsonFetch(server.baseUrl, `/v1/payment-intents/${intent.body.intent.id}/verify`, {
      method: 'POST',
    });
    assert.equal(publicVerify.res.status, 401);

    const verified = await jsonFetch(server.baseUrl, `/v1/payment-intents/${intent.body.intent.id}/verify`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(verified.res.status, 200);
    assert.equal(verified.body.ok, true);
    assert.equal(verified.body.signatureValid, true);
    assert.equal(verified.body.used, false);
    assert.equal(verified.body.intent.signature, undefined);
    assert.equal(verified.body.intent.nonce, undefined);

    const listed = await jsonFetch(server.baseUrl, '/v1/payment-intents', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(listed.res.status, 200);
    assert.equal(listed.body.intents[0].signature, undefined);
    assert.equal(listed.body.intents[0].nonce, undefined);

    const used = await jsonFetch(server.baseUrl, `/v1/payment-intents/${intent.body.intent.id}/use`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(used.res.status, 200);
    assert.equal(used.body.intent.signature, undefined);
    assert.equal(used.body.intent.nonce, undefined);

    const usedVerify = await jsonFetch(server.baseUrl, `/v1/payment-intents/${intent.body.intent.id}/verify`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(usedVerify.res.status, 200);
    assert.equal(usedVerify.body.ok, false);
    assert.equal(usedVerify.body.used, true);

    const replay = await jsonFetch(server.baseUrl, `/v1/payment-intents/${intent.body.intent.id}/use`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(replay.res.status, 409);
    assert.equal(replay.body.error, 'intent_already_used');

    const store = await import('./lib/store.js');
    const expired = store.createPaymentIntent({
      invoiceHash: created.body.hash,
      merchant: created.body.merchant,
      token: created.body.token,
      amount: created.body.amount,
      deadline: Math.floor(Date.now() / 1000) - 1,
      nonce: 'pin_expired_test',
      signature: 'expired_signature',
    });
    const expiredUse = await jsonFetch(server.baseUrl, `/v1/payment-intents/${expired.id}/use`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(expiredUse.res.status, 409);
    assert.equal(expiredUse.body.error, 'intent_expired');
    assert.equal(store.getPaymentIntent(expired.id)?.usedAt, undefined);
  } finally {
    await server.close();
  }
});

test('chain operations require authorization and merchant scope', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const merchantA = '0x1212121212121212121212121212121212121212';
  const merchantB = '0x3434343434343434343434343434343434343434';
  const server = await startTestServer();
  try {
    const invoiceA = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '11',
        token: 'QIE',
        merchant: merchantA,
        title: 'Merchant A chain event',
        chain_tx_hash: chainTxHash(401),
      }),
    });
    assert.equal(invoiceA.res.status, 201);

    const invoiceB = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '13',
        token: 'QIE',
        merchant: merchantB,
        title: 'Merchant B chain event',
        chain_tx_hash: chainTxHash(402),
      }),
    });
    assert.equal(invoiceB.res.status, 201);

    const store = await import('./lib/store.js');
    store.recordChainEvent({
      contractAddress: '0x9999999999999999999999999999999999999999',
      invoiceHash: invoiceA.body.hash,
      eventType: 'invoice.created',
      txHash: chainTxHash(411),
      blockNumber: 411,
      logIndex: 0,
      payload: { merchant: merchantA },
    });
    store.recordChainEvent({
      contractAddress: '0x9999999999999999999999999999999999999999',
      invoiceHash: invoiceB.body.hash,
      eventType: 'invoice.created',
      txHash: chainTxHash(412),
      blockNumber: 412,
      logIndex: 0,
      payload: { merchant: merchantB },
    });

    const publicEvents = await jsonFetch(server.baseUrl, `/v1/chain/events?invoice_hash=${invoiceA.body.hash}`);
    assert.equal(publicEvents.res.status, 401);

    const keyA = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant A chain key',
        merchant: merchantA,
        scopes: ['chain:read', 'chain:sync'],
      }),
    });
    assert.equal(keyA.res.status, 201);
    const authA = { Authorization: `Bearer ${keyA.body.secret}` };

    const ownEvents = await jsonFetch(server.baseUrl, `/v1/chain/events?invoice_hash=${invoiceA.body.hash}`, {
      headers: authA,
    });
    assert.equal(ownEvents.res.status, 200);
    assert.equal(ownEvents.body.total, 1);
    assert.equal(ownEvents.body.events[0].invoiceHash, invoiceA.body.hash);

    const scopedEvents = await jsonFetch(server.baseUrl, '/v1/chain/events', {
      headers: authA,
    });
    assert.equal(scopedEvents.res.status, 200);
    assert.equal(scopedEvents.body.total, 1);
    assert.equal(scopedEvents.body.events.every((event: any) => event.invoiceHash === invoiceA.body.hash), true);

    const crossEvents = await jsonFetch(server.baseUrl, `/v1/chain/events?invoice_hash=${invoiceB.body.hash}`, {
      headers: authA,
    });
    assert.equal(crossEvents.res.status, 403);
    assert.equal(crossEvents.body.error, 'merchant_scope_mismatch');

    const scopedStatus = await jsonFetch(server.baseUrl, '/v1/chain/status', {
      headers: authA,
    });
    assert.equal(scopedStatus.res.status, 200);
    assert.equal(typeof scopedStatus.body.safety.confirmations, 'number');
    assert.equal(typeof scopedStatus.body.safety.reorgRollbackBlocks, 'number');
    assert.equal(scopedStatus.body.indexedEvents.every((event: any) => event.invoiceHash === invoiceA.body.hash), true);

    const merchantSync = await jsonFetch(server.baseUrl, '/v1/chain/sync', {
      method: 'POST',
      headers: authA,
    });
    assert.equal(merchantSync.res.status, 403);
    assert.equal(merchantSync.body.error, 'operator_required');

    const unboundedKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Unbounded ops key',
        scopes: ['ops:read', 'chain:read', 'chain:sync'],
      }),
    });
    assert.equal(unboundedKey.res.status, 201);
    const unboundedAuth = { Authorization: `Bearer ${unboundedKey.body.secret}` };

    const unboundedSettings = await jsonFetch(server.baseUrl, '/v1/settings/status', {
      headers: unboundedAuth,
    });
    assert.equal(unboundedSettings.res.status, 403);
    assert.equal(unboundedSettings.body.error, 'merchant_boundary_required');

    const unboundedChainStatus = await jsonFetch(server.baseUrl, '/v1/chain/status', {
      headers: unboundedAuth,
    });
    assert.equal(unboundedChainStatus.res.status, 403);
    assert.equal(unboundedChainStatus.body.error, 'merchant_boundary_required');
  } finally {
    await server.close();
  }
});

test('chain cursor stays monotonic and event persistence keeps full transaction identity', async () => {
  const store = await import('./lib/store.js');
  store.clearAll();

  const contractAddress = '0x8888888888888888888888888888888888888888';
  const block500 = `0x${'5'.repeat(64)}` as `0x${string}`;
  const parent499 = `0x${'4'.repeat(64)}` as `0x${string}`;
  const block725 = `0x${'7'.repeat(64)}` as `0x${string}`;
  const parent724 = `0x${'6'.repeat(64)}` as `0x${string}`;

  store.setChainCursor(contractAddress, 500, block500, parent499);
  store.setChainCursor(contractAddress, 450, `0x${'3'.repeat(64)}` as `0x${string}`);
  let cursor = store.chainSyncStatus(contractAddress)[0];
  assert.equal(cursor.lastBlock, 500);
  assert.equal(cursor.lastBlockHash, block500);
  assert.equal(cursor.lastParentHash, parent499);

  store.setChainCursor(contractAddress, 725, block725, parent724);
  cursor = store.chainSyncStatus(contractAddress)[0];
  assert.equal(cursor.lastBlock, 725);
  assert.equal(cursor.lastBlockHash, block725);
  assert.equal(cursor.lastParentHash, parent724);

  const txA = `0x${'a'.repeat(12)}${'1'.repeat(52)}` as `0x${string}`;
  const txB = `0x${'a'.repeat(12)}${'2'.repeat(52)}` as `0x${string}`;
  const eventA = store.recordChainEvent({
    contractAddress,
    invoiceHash: chainTxHash(701),
    eventType: 'invoice.created',
    txHash: txA,
    blockNumber: 701,
    logIndex: 0,
    payload: { merchant: '0x1111111111111111111111111111111111111111' },
  });
  const eventB = store.recordChainEvent({
    contractAddress,
    invoiceHash: chainTxHash(702),
    eventType: 'invoice.created',
    txHash: txB,
    blockNumber: 702,
    logIndex: 0,
    payload: { merchant: '0x2222222222222222222222222222222222222222' },
  });

  assert.ok(eventA);
  assert.ok(eventB);
  assert.notEqual(eventA.id, eventB.id);
  assert.equal(store.countChainEvents({}), 2);

  assert.equal(store.rollbackChainCursor(contractAddress, 701), 701);
  cursor = store.chainSyncStatus(contractAddress)[0];
  assert.equal(cursor.lastBlock, 701);
  assert.equal(cursor.lastBlockHash, undefined);
  assert.equal(cursor.lastParentHash, undefined);
  assert.equal(store.countChainEvents({}), 1);
  const remainingEvents = store.listChainEvents({});
  assert.equal(remainingEvents[0].txHash, txA);
});

test('webhook delivery failures are persisted and can be retried without blocking invoice creation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  let attempts = 0;
  const receiver = createServer((req, res) => {
    attempts += 1;
    req.resume();
    res.statusCode = 500;
    res.end('retry later');
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverAddress = receiver.address();
  assert(receiverAddress && typeof receiverAddress === 'object');
  const webhookUrl = `http://127.0.0.1:${receiverAddress.port}/qantara`;

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '21',
        token: 'QIE',
        merchant: '0x5555555555555555555555555555555555555555',
        webhook_url: webhookUrl,
        chain_tx_hash: chainTxHash(40),
      }),
    });
    assert.equal(created.res.status, 201);

    const publicDeliveries = await jsonFetch(server.baseUrl, `/v1/webhooks/deliveries?invoice_hash=${created.body.invoice_hash}`);
    assert.equal(publicDeliveries.res.status, 401);

    const deliveries = await eventually(
      () => jsonFetch(server.baseUrl, `/v1/webhooks/deliveries?invoice_hash=${created.body.invoice_hash}`, {
        headers: { Authorization: 'Bearer sk_test_suite' },
      }),
      (value) => value.body.deliveries?.length === 1,
    );
    assert.equal(deliveries.body.deliveries[0].attempts, 1);
    assert.equal(deliveries.body.deliveries[0].status, 500);
    assert.ok(deliveries.body.deliveries[0].nextRetryAt);

    const scopedKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant webhook read key',
        merchant: '0x5555555555555555555555555555555555555555',
        scopes: ['webhooks:read', 'webhooks:write'],
      }),
    });
    assert.equal(scopedKey.res.status, 201);

    const otherKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Other merchant webhook read key',
        merchant: '0x5656565656565656565656565656565656565656',
        scopes: ['webhooks:read', 'webhooks:write'],
      }),
    });
    assert.equal(otherKey.res.status, 201);

    const scopedDeliveries = await jsonFetch(server.baseUrl, `/v1/webhooks/deliveries?invoice_hash=${created.body.invoice_hash}`, {
      headers: { Authorization: `Bearer ${scopedKey.body.secret}` },
    });
    assert.equal(scopedDeliveries.res.status, 200);
    assert.equal(scopedDeliveries.body.count, 1);
    assert.equal(scopedDeliveries.body.deliveries[0].invoiceHash, created.body.invoice_hash);

    const crossInvoiceDeliveries = await jsonFetch(server.baseUrl, `/v1/webhooks/deliveries?invoice_hash=${created.body.invoice_hash}`, {
      headers: { Authorization: `Bearer ${otherKey.body.secret}` },
    });
    assert.equal(crossInvoiceDeliveries.res.status, 403);
    assert.equal(crossInvoiceDeliveries.body.error, 'merchant_scope_mismatch');

    const crossDeliveryList = await jsonFetch(server.baseUrl, '/v1/webhooks/deliveries', {
      headers: { Authorization: `Bearer ${otherKey.body.secret}` },
    });
    assert.equal(crossDeliveryList.res.status, 200);
    assert.equal(crossDeliveryList.body.count, 0);

    const crossRetry = await jsonFetch(server.baseUrl, `/v1/webhooks/deliveries/${deliveries.body.deliveries[0].id}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherKey.body.secret}` },
    });
    assert.equal(crossRetry.res.status, 403);
    assert.equal(crossRetry.body.error, 'merchant_scope_mismatch');

    const retried = await jsonFetch(server.baseUrl, `/v1/webhooks/deliveries/${deliveries.body.deliveries[0].id}/retry`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(retried.res.status, 200);
    assert.equal(retried.body.delivery.attempts, 2);
    assert.equal(attempts, 2);
  } finally {
    await server.close();
    await new Promise<void>((resolve, reject) => receiver.close((err) => (err ? reject(err) : resolve())));
  }
});

test('successful webhook deliveries are terminal for manual retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  let attempts = 0;
  const receiver = createServer((req, res) => {
    attempts += 1;
    req.resume();
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverAddress = receiver.address();
  assert(receiverAddress && typeof receiverAddress === 'object');
  const webhookUrl = `http://127.0.0.1:${receiverAddress.port}/qantara`;

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '22',
        token: 'QIE',
        merchant: '0x5757575757575757575757575757575757575757',
        webhook_url: webhookUrl,
        chain_tx_hash: chainTxHash(41),
      }),
    });
    assert.equal(created.res.status, 201);

    const deliveries = await eventually(
      () => jsonFetch(server.baseUrl, `/v1/webhooks/deliveries?invoice_hash=${created.body.invoice_hash}`, {
        headers: { Authorization: 'Bearer sk_test_suite' },
      }),
      (value) => value.body.deliveries?.length === 1,
    );
    assert.equal(deliveries.body.deliveries[0].status, 204);
    assert.equal(deliveries.body.deliveries[0].nextRetryAt, undefined);

    const retried = await jsonFetch(server.baseUrl, `/v1/webhooks/deliveries/${deliveries.body.deliveries[0].id}/retry`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(retried.res.status, 409);
    assert.equal(retried.body.error, 'webhook_already_succeeded');
    assert.equal(attempts, 1);
  } finally {
    await server.close();
    await new Promise<void>((resolve, reject) => receiver.close((err) => (err ? reject(err) : resolve())));
  }
});

test('contract lifecycle verification endpoints require a real transaction hash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '8',
        token: 'QIE',
        merchant: '0x6666666666666666666666666666666666666666',
        title: 'Lifecycle verify invoice',
        chain_tx_hash: chainTxHash(102),
      }),
    });
    assert.equal(created.res.status, 201);

    for (const action of ['cancel', 'pause', 'resume']) {
      const result = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/${action}/verify`, {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test_suite' },
        body: JSON.stringify({ tx_hash: 'not-a-tx' }),
      });
      assert.equal(result.res.status, 400);
      assert.equal(result.body.error, 'bad_request');
    }

    const refundVerify = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/refund/verify-contract`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ tx_hash: 'not-a-tx' }),
    });
    assert.equal(refundVerify.res.status, 400);
    assert.equal(refundVerify.body.error, 'bad_state');
  } finally {
    await server.close();
  }
});

test('indexed paid state issues a receipt with the payment event', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousReceiptRegistry = process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS;
  process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS = '0x6969696969696969696969696969696969696969';

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '9',
        token: 'QIE',
        merchant: '0x6767676767676767676767676767676767676767',
        title: 'Receipt guarantee invoice',
        chain_tx_hash: chainTxHash(105),
      }),
    });
    assert.equal(created.res.status, 201);

    const paid = store.applyIndexedInvoiceState({
      invoiceHash: created.body.hash,
      eventType: 'invoice.paid',
      payer: '0x6868686868686868686868686868686868686868',
      txHash: chainTxHash(106),
    });
    assert.equal(paid?.status, store.InvoiceStatus.Paid);

    const receipt = await jsonFetch(server.baseUrl, `/v1/receipts/${created.body.hash}`);
    assert.equal(receipt.res.status, 200);
    assert.equal(receipt.body.invoiceHash, created.body.hash);
    assert.equal(receipt.body.txHash, chainTxHash(106));
    assert.equal(receipt.body.verification.policy, 'issued_after_verified_payment');
    assert.equal(receipt.body.verification.anchored, false);
    assert.equal(receipt.body.verification.onChainAnchor.enabled, true);
    assert.equal(receipt.body.verification.onChainAnchor.registryAddress, '0x6969696969696969696969696969696969696969');

    const events = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/events`);
    assert.equal(events.res.status, 200);
    const types = events.body.events.map((event: any) => event.type);
    assert.ok(types.includes('invoice.paid'));
    assert.ok(types.includes('receipt.created'));
  } finally {
    if (previousReceiptRegistry) process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS = previousReceiptRegistry;
    else delete process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS;
    await server.close();
  }
});

test('receipt anchoring is disabled without a signer and the anchor route returns 412', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousReceiptRegistry = process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS;
  const previousAnchorPk = process.env.RECEIPT_ANCHOR_PK;
  const previousRelayerPk = process.env.RELAYER_PK;
  // Registry configured, but no anchoring signer key => not ready to anchor.
  process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS = '0x6969696969696969696969696969696969696969';
  delete process.env.RECEIPT_ANCHOR_PK;
  delete process.env.RELAYER_PK;

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '12',
        token: 'QIE',
        merchant: '0x6767676767676767676767676767676767676767',
        title: 'Anchor gating invoice',
        chain_tx_hash: chainTxHash(120),
      }),
    });
    assert.equal(created.res.status, 201);

    const paid = store.applyIndexedInvoiceState({
      invoiceHash: created.body.hash,
      eventType: 'invoice.paid',
      payer: '0x6868686868686868686868686868686868686868',
      txHash: chainTxHash(121),
    });
    assert.equal(paid?.status, store.InvoiceStatus.Paid);

    const receipt = await jsonFetch(server.baseUrl, `/v1/receipts/${created.body.hash}`);
    assert.equal(receipt.res.status, 200);
    // Registry configured (enabled) but not ready (no signer), and never anchored.
    assert.equal(receipt.body.verification.anchored, false);
    assert.equal(receipt.body.verification.onChainAnchor.enabled, true);
    assert.equal(receipt.body.verification.onChainAnchor.ready, false);
    assert.equal(receipt.body.verification.onChainAnchor.status, 'registry_configured_anchor_not_indexed');

    const anchor = await jsonFetch(server.baseUrl, `/v1/receipts/${created.body.hash}/anchor`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(anchor.res.status, 412);
    assert.equal(anchor.body.error, 'anchoring_not_configured');

    const unauthorized = await jsonFetch(server.baseUrl, `/v1/receipts/${created.body.hash}/anchor`, {
      method: 'POST',
    });
    assert.equal(unauthorized.res.status, 401);
  } finally {
    if (previousReceiptRegistry) process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS = previousReceiptRegistry;
    else delete process.env.QANTARA_RECEIPT_REGISTRY_ADDRESS;
    if (previousAnchorPk) process.env.RECEIPT_ANCHOR_PK = previousAnchorPk;
    if (previousRelayerPk) process.env.RELAYER_PK = previousRelayerPk;
    await server.close();
  }
});

test('refund decision events require paid state and valid transaction hash format', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const store = await import('./lib/store.js');
    store.clearAll();

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '10',
        token: 'QIE',
        merchant: '0x6969696969696969696969696969696969696969',
        title: 'Refund decision invoice',
        chain_tx_hash: chainTxHash(107),
      }),
    });
    assert.equal(created.res.status, 201);

    const earlyApprove = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/refund/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ message: 'Review complete' }),
    });
    assert.equal(earlyApprove.res.status, 400);
    assert.equal(earlyApprove.body.error, 'bad_state');

    store.applyIndexedInvoiceState({
      invoiceHash: created.body.hash,
      eventType: 'invoice.paid',
      payer: '0x7070707070707070707070707070707070707070',
      txHash: chainTxHash(108),
    });

    const noTokenRequest = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/refund/request`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Item was not delivered' }),
    });
    assert.equal(noTokenRequest.res.status, 403);

    const payerMessage = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        sender_role: 'payer',
        sender_label: 'Payer',
        body: 'I need help with this paid invoice',
      }),
    });
    assert.equal(payerMessage.res.status, 201);
    assert.match(payerMessage.body.guest_token, /^gst_/);

    const payerRequest = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/refund/request`, {
      method: 'POST',
      headers: { 'x-qantara-guest-token': payerMessage.body.guest_token },
      body: JSON.stringify({ reason: 'Item was not delivered' }),
    });
    assert.equal(payerRequest.res.status, 202);
    assert.equal(payerRequest.body.event.type, 'refund.requested');

    const badApprove = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/refund/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ tx_hash: 'not-a-tx' }),
    });
    assert.equal(badApprove.res.status, 400);
    assert.equal(badApprove.body.error, 'bad_request');

    const approve = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/refund/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ tx_hash: chainTxHash(109), message: 'Ready for settlement' }),
    });
    assert.equal(approve.res.status, 200);

    const reject = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/refund/reject`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({ message: 'Rejected after review' }),
    });
    assert.equal(reject.res.status, 200);
  } finally {
    await server.close();
  }
});

test('failed payment verification is persisted in operational monitoring', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '4',
        token: 'QIE',
        merchant: '0x7777777777777777777777777777777777777777',
        title: 'Monitoring invoice',
        chain_tx_hash: chainTxHash(103),
      }),
    });
    assert.equal(created.res.status, 201);

    const badVerify = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/verify-payment`, {
      method: 'POST',
      body: JSON.stringify({
        payer: '0x8888888888888888888888888888888888888888',
        tx_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      }),
    });
    assert.equal(badVerify.res.status, 400);
    assert.equal(badVerify.body.error, 'payment_not_verified');

    const events = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/events`);
    assert.equal(events.res.status, 200);
    const publicFailure = events.body.events.find((event: any) => event.type === 'payment.verification_failed');
    assert.ok(publicFailure);
    assert.deepEqual(publicFailure.payload, {});

    const merchantEvents = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/events`, {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    const merchantFailure = merchantEvents.body.events.find((event: any) => event.type === 'payment.verification_failed');
    assert.ok(merchantFailure);
    assert.equal(merchantFailure.payload.txHash, '0x0000000000000000000000000000000000000000000000000000000000000000');
    assert.equal(typeof merchantFailure.payload.reason, 'string');

    const writeOnlyKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Write-only invoice key',
        merchant: '0x7777777777777777777777777777777777777777',
        scopes: ['invoices:write'],
      }),
    });
    assert.equal(writeOnlyKey.res.status, 201);

    const writeOnlyEvents = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/events`, {
      headers: { Authorization: `Bearer ${writeOnlyKey.body.secret}` },
    });
    assert.equal(writeOnlyEvents.res.status, 200);
    const writeOnlyFailure = writeOnlyEvents.body.events.find((event: any) => event.type === 'payment.verification_failed');
    assert.ok(writeOnlyFailure);
    assert.deepEqual(writeOnlyFailure.payload, {});

    const settings = await jsonFetch(server.baseUrl, '/v1/settings/status', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(settings.res.status, 200);
    assert.equal(settings.body.operational.rpcVerification.failures24h, 1);
    assert.equal(settings.body.operational.rpcVerification.healthy, false);
  } finally {
    await server.close();
  }
});

test('critical operational alerts can be delivered to a signed alert webhook', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  process.env.ALERT_WEBHOOK_SECRET = 'alert_test_secret';
  process.env.ALERT_MIN_SEVERITY = 'critical';

  let alertBody = '';
  let alertSignature = '';
  let alertTimestamp = '';
  const receiver = createServer((req, res) => {
    alertSignature = String(req.headers['x-qantara-signature'] ?? '');
    alertTimestamp = String(req.headers['x-qantara-timestamp'] ?? '');
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      alertBody += chunk;
    });
    req.on('end', () => {
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverAddress = receiver.address();
  assert(receiverAddress && typeof receiverAddress === 'object');
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${receiverAddress.port}/alerts`;

  const server = await startTestServer();
  try {
    const publicDeliveries = await jsonFetch(server.baseUrl, '/v1/alerts/deliveries');
    assert.equal(publicDeliveries.res.status, 401);

    const storedAlertKey = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Stored alert key',
        merchant: '0x9090909090909090909090909090909090909090',
        scopes: ['ops:alerts'],
      }),
    });
    assert.equal(storedAlertKey.res.status, 201);
    const storedAlertAuth = { Authorization: `Bearer ${storedAlertKey.body.secret}` };

    const storedDeliveries = await jsonFetch(server.baseUrl, '/v1/alerts/deliveries', {
      headers: storedAlertAuth,
    });
    assert.equal(storedDeliveries.res.status, 403);
    assert.equal(storedDeliveries.body.error, 'operator_required');

    const storedDispatch = await jsonFetch(server.baseUrl, '/v1/alerts/dispatch', {
      method: 'POST',
      headers: storedAlertAuth,
    });
    assert.equal(storedDispatch.res.status, 403);
    assert.equal(storedDispatch.body.error, 'operator_required');

    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '2',
        token: 'QIE',
        merchant: '0x9999999999999999999999999999999999999999',
        title: 'Alert invoice',
        chain_tx_hash: chainTxHash(104),
      }),
    });
    assert.equal(created.res.status, 201);

    for (let i = 0; i < 11; i += 1) {
      await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/verify-payment`, {
        method: 'POST',
        body: JSON.stringify({
          payer: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          tx_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        }),
      });
    }

    const dispatched = await jsonFetch(server.baseUrl, '/v1/alerts/dispatch', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(dispatched.res.status, 200);
    assert.equal(dispatched.body.enabled, true);
    assert.equal(dispatched.body.delivered, 1);
    assert.match(alertBody, /rpc\.verification_failures_high/);

    const expected = createHmac('sha256', process.env.ALERT_WEBHOOK_SECRET)
      .update(`${alertTimestamp}.${alertBody}`)
      .digest('hex');
    assert.equal(alertSignature, expected);

    const deliveries = await jsonFetch(server.baseUrl, '/v1/alerts/deliveries', {
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(deliveries.res.status, 200);
    assert.equal(deliveries.body.deliveries[0].alertId, 'rpc.verification_failures_high');
    assert.equal(deliveries.body.deliveries[0].status, 204);
  } finally {
    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.ALERT_WEBHOOK_SECRET;
    delete process.env.ALERT_MIN_SEVERITY;
    await server.close();
    await new Promise<void>((resolve, reject) => receiver.close((err) => (err ? reject(err) : resolve())));
  }
});

test('production invoice creation requires merchant authority', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const unsigned = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        amount: '9',
        token: 'QIE',
        merchant: '0x4444444444444444444444444444444444444444',
        title: 'Unsigned production invoice',
        chain_tx_hash: chainTxHash(105),
      }),
    });
    assert.equal(unsigned.res.status, 401);
    assert.equal(unsigned.body.error, 'signature_required');

    const withoutChainReference = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '9',
        token: 'QIE',
        merchant: '0x4444444444444444444444444444444444444444',
        title: 'Missing chain reference',
      }),
    });
    assert.equal(withoutChainReference.res.status, 400);
    assert.equal(withoutChainReference.body.error, 'chain_tx_hash_required');
  } finally {
    await server.close();
  }
});

test('direct lifecycle mutation endpoints require verified chain actions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const server = await startTestServer();
  try {
    const created = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '7',
        token: 'QIE',
        merchant: '0x5555555555555555555555555555555555555555',
        title: 'Lifecycle guarded invoice',
        chain_tx_hash: chainTxHash(106),
      }),
    });
    assert.equal(created.res.status, 201);

    for (const action of ['cancel', 'pause', 'resume']) {
      const response = await jsonFetch(server.baseUrl, `/v1/invoices/${created.body.hash}/${action}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test_suite' },
      });
      assert.equal(response.res.status, 410);
      assert.equal(response.body.error, 'verified_lifecycle_required');
    }

    const checkoutCancel = await jsonFetch(server.baseUrl, `/v1/checkout/sessions/${created.body.hash}/cancel`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
    });
    assert.equal(checkoutCancel.res.status, 410);
    assert.equal(checkoutCancel.body.error, 'verified_lifecycle_required');
  } finally {
    await server.close();
  }
});

test('stored merchant API keys cannot access another merchant resources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const merchantA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const merchantB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const server = await startTestServer();
  try {
    const keyA = await jsonFetch(server.baseUrl, '/v1/api-keys', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        name: 'Merchant A key',
        merchant: merchantA,
        scopes: ['invoices:read', 'invoices:write', 'webhooks:read', 'webhooks:write', 'receipts:read'],
      }),
    });
    assert.equal(keyA.res.status, 201);
    const authA = { Authorization: `Bearer ${keyA.body.secret}` };

    const ownInvoice = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        amount: '6',
        token: 'QIE',
        merchant: merchantA,
        title: 'Merchant A invoice',
        chain_tx_hash: chainTxHash(301),
      }),
    });
    assert.equal(ownInvoice.res.status, 201);

    const crossCreate = await jsonFetch(server.baseUrl, '/v1/invoices', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        amount: '6',
        token: 'QIE',
        merchant: merchantB,
        title: 'Merchant B invoice through A key',
        chain_tx_hash: chainTxHash(302),
      }),
    });
    assert.equal(crossCreate.res.status, 403);
    assert.equal(crossCreate.body.error, 'merchant_scope_mismatch');

    const merchantBSession = await jsonFetch(server.baseUrl, '/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        amount: '10',
        token: 'QIE',
        merchant: merchantB,
        memo: 'Merchant B checkout',
        webhook_url: 'https://merchant-b.example/webhooks/qantara',
        chain_tx_hash: chainTxHash(303),
      }),
    });
    assert.equal(merchantBSession.res.status, 201);
    const merchantBHash = merchantBSession.body.invoice_hash as string;

    const crossList = await jsonFetch(server.baseUrl, `/v1/invoices?merchant=${merchantB}`, {
      headers: authA,
    });
    assert.equal(crossList.res.status, 403);
    assert.equal(crossList.body.error, 'merchant_scope_mismatch');

    const ownList = await jsonFetch(server.baseUrl, '/v1/invoices', {
      headers: authA,
    });
    assert.equal(ownList.res.status, 200);
    assert.equal(ownList.body.count, 1);
    assert.equal(ownList.body.invoices[0].merchant, merchantA);

    const crossChat = await jsonFetch(server.baseUrl, `/v1/invoices/${merchantBHash}/messages`, {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        sender_role: 'merchant',
        sender_label: 'Merchant A',
        body: 'Cross-merchant reply attempt',
      }),
    });
    assert.equal(crossChat.res.status, 403);
    assert.equal(crossChat.body.error, 'merchant_scope_mismatch');

    const crossCheckoutRead = await jsonFetch(server.baseUrl, `/v1/checkout/sessions/${merchantBHash}`, {
      headers: authA,
    });
    assert.equal(crossCheckoutRead.res.status, 403);
    assert.equal(crossCheckoutRead.body.error, 'merchant_scope_mismatch');

    const crossIntentCreate = await jsonFetch(server.baseUrl, '/v1/payment-intents', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        invoice_hash: merchantBHash,
        ttl_seconds: 600,
      }),
    });
    assert.equal(crossIntentCreate.res.status, 403);
    assert.equal(crossIntentCreate.body.error, 'merchant_scope_mismatch');

    const ownIntent = await jsonFetch(server.baseUrl, '/v1/payment-intents', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({
        invoice_hash: ownInvoice.body.hash,
        ttl_seconds: 600,
      }),
    });
    assert.equal(ownIntent.res.status, 201);

    const merchantBIntent = await jsonFetch(server.baseUrl, '/v1/payment-intents', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk_test_suite' },
      body: JSON.stringify({
        invoice_hash: merchantBHash,
        ttl_seconds: 600,
      }),
    });
    assert.equal(merchantBIntent.res.status, 201);

    const ownIntents = await jsonFetch(server.baseUrl, '/v1/payment-intents', {
      headers: authA,
    });
    assert.equal(ownIntents.res.status, 200);
    assert.equal(ownIntents.body.count, 1);
    assert.equal(ownIntents.body.total, 1);
    assert.equal(ownIntents.body.intents[0].invoiceHash, ownInvoice.body.hash);

    const crossIntentList = await jsonFetch(server.baseUrl, `/v1/payment-intents?invoice_hash=${merchantBHash}`, {
      headers: authA,
    });
    assert.equal(crossIntentList.res.status, 403);
    assert.equal(crossIntentList.body.error, 'merchant_scope_mismatch');

    const crossIntentVerify = await jsonFetch(server.baseUrl, `/v1/payment-intents/${merchantBIntent.body.intent.id}/verify`, {
      method: 'POST',
      headers: authA,
    });
    assert.equal(crossIntentVerify.res.status, 403);
    assert.equal(crossIntentVerify.body.error, 'merchant_scope_mismatch');

    const crossWebhookTest = await jsonFetch(server.baseUrl, '/v1/webhooks/test', {
      method: 'POST',
      headers: authA,
      body: JSON.stringify({ invoice_hash: merchantBHash }),
    });
    assert.equal(crossWebhookTest.res.status, 403);
    assert.equal(crossWebhookTest.body.error, 'merchant_scope_mismatch');

    const crossReceipts = await jsonFetch(server.baseUrl, `/v1/receipts?merchant=${merchantB}`, {
      headers: authA,
    });
    assert.equal(crossReceipts.res.status, 403);
    assert.equal(crossReceipts.body.error, 'merchant_scope_mismatch');
  } finally {
    await server.close();
  }
});
