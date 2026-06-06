import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function chainTxHash(seed: number): `0x${string}` {
  return `0x${seed.toString(16).padStart(64, '0')}`;
}

test('buildPaymentRoutePlan recommends native QIE transfer for an open QIE invoice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-routes-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousQantara = process.env.QANTARA_ADDRESS;
  process.env.QANTARA_ADDRESS = '0x27815fC2021345EB38B68D9C8F08679A4aeee030';

  const store = await import('./store.js');
  const { buildPaymentRoutePlan } = await import('./paymentRoutes.js');
  try {
    store.clearAll();
    const invoice = store.createInvoice({
      merchant: '0x1111111111111111111111111111111111111111',
      amount: '0.001',
      token: '0x0000000000000000000000000000000000000000',
      hash: chainTxHash(801),
      chainTxHash: chainTxHash(802),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const plan = await buildPaymentRoutePlan(invoice);
    assert.equal(plan.state, 'ready');
    assert.equal(plan.payable, true);
    assert.equal(plan.recommendedRouteId, 'qie.direct_transfer');
    assert.ok(plan.routes.some((route) => route.id === 'qie.qantara_invoice'));
    assert.equal(plan.requiresRealTx, true);
    assert.ok(plan.acquisitionRoutes.some((route) => route.id === 'qie.wallet'));
    assert.deepEqual(plan.dataSources, ['sqlite.invoice', 'backend.rails', 'qie.rpc.health', 'deployment.registry']);
  } finally {
    store.clearAll();
    if (previousQantara) process.env.QANTARA_ADDRESS = previousQantara;
    else delete process.env.QANTARA_ADDRESS;
  }
});

test('buildPaymentRoutePlan blocks payable routes after invoice settlement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-routes-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const store = await import('./store.js');
  const { buildPaymentRoutePlan } = await import('./paymentRoutes.js');
  try {
    store.clearAll();
    const invoice = store.createInvoice({
      merchant: '0x2222222222222222222222222222222222222222',
      amount: '0.002',
      token: '0x0000000000000000000000000000000000000000',
      hash: chainTxHash(803),
      chainTxHash: chainTxHash(804),
    });
    const paid = store.markPaid(invoice.hash, '0x3333333333333333333333333333333333333333', chainTxHash(805));
    assert.ok(paid);

    const plan = await buildPaymentRoutePlan(paid);
    assert.equal(plan.state, 'settled');
    assert.equal(plan.payable, false);
    assert.equal(plan.recommendedRouteId, null);
    assert.ok(plan.routes.every((route) => route.state === 'settled'));
  } finally {
    store.clearAll();
  }
});

test('buildPaymentRoutePlan reports unsupported tokens without route candidates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-routes-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');

  const store = await import('./store.js');
  const { buildPaymentRoutePlan } = await import('./paymentRoutes.js');
  try {
    store.clearAll();
    const invoice = store.createInvoice({
      merchant: '0x4444444444444444444444444444444444444444',
      amount: '5',
      token: '0x5555555555555555555555555555555555555555',
      hash: chainTxHash(806),
      chainTxHash: chainTxHash(807),
    });

    const plan = await buildPaymentRoutePlan(invoice);
    assert.equal(plan.state, 'unsupported');
    assert.equal(plan.payable, false);
    assert.equal(plan.routes.length, 0);
    assert.equal(plan.reason, 'Invoice token is not configured as a supported payment rail');
  } finally {
    store.clearAll();
  }
});

test('buildPaymentRoutePlan recommends gasless QUSDC when paymaster checkout is configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qantara-routes-'));
  process.env.QANTARA_DB_PATH = join(dir, 'test.sqlite');
  const previousQantara = process.env.QANTARA_ADDRESS;
  const previousQusdc = process.env.QUSDC_ADDRESS;
  const previousPaymaster = process.env.QUSDC_PAYMASTER_CHECKOUT_URL;
  const previousProvider = process.env.QUSDC_PAYMASTER_PROVIDER;
  process.env.QANTARA_ADDRESS = '0x27815fC2021345EB38B68D9C8F08679A4aeee030';
  const qusdcAddress = '0x88aBC76fd8e3d725139Ecc6BB75582aA3f14ec2D' as `0x${string}`;
  process.env.QUSDC_ADDRESS = qusdcAddress;
  process.env.QUSDC_PAYMASTER_CHECKOUT_URL = 'https://paymaster.example/checkout';
  process.env.QUSDC_PAYMASTER_PROVIDER = 'qevie_paymaster';

  const store = await import('./store.js');
  const { buildPaymentRoutePlan } = await import('./paymentRoutes.js');
  try {
    store.clearAll();
    const invoice = store.createInvoice({
      merchant: '0x6666666666666666666666666666666666666666',
      amount: '7.5',
      token: qusdcAddress,
      hash: chainTxHash(808),
      chainTxHash: chainTxHash(809),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const plan = await buildPaymentRoutePlan(invoice);
    assert.equal(plan.payable, true);
    assert.equal(plan.recommendedRouteId, 'qusdc.gasless_paymaster');
    assert.ok(plan.acquisitionRoutes.some((route) => route.id === 'qusdc.mint_vault'));
    assert.ok(plan.externalActions.every((route) => route.actionType === 'external_link'));
    const gasless = plan.routes.find((route) => route.id === 'qusdc.gasless_paymaster');
    assert.ok(gasless);
    assert.equal(gasless.state, 'ready');
    assert.equal(gasless.requiresNativeGas, false);
    assert.equal(gasless.provider, 'qevie_paymaster');
    assert.deepEqual(gasless.fallbackRouteIds, ['qusdc.permit_and_pay', 'qusdc.approve_and_pay', 'qusdc.direct_transfer']);
    assert.equal(gasless.actions[0].type, 'external_checkout');
    assert.match(gasless.actions[0].url ?? '', /^https:\/\/paymaster\.example\/checkout\?/);
  } finally {
    store.clearAll();
    if (previousQantara) process.env.QANTARA_ADDRESS = previousQantara;
    else delete process.env.QANTARA_ADDRESS;
    if (previousQusdc) process.env.QUSDC_ADDRESS = previousQusdc;
    else delete process.env.QUSDC_ADDRESS;
    if (previousPaymaster) process.env.QUSDC_PAYMASTER_CHECKOUT_URL = previousPaymaster;
    else delete process.env.QUSDC_PAYMASTER_CHECKOUT_URL;
    if (previousProvider) process.env.QUSDC_PAYMASTER_PROVIDER = previousProvider;
    else delete process.env.QUSDC_PAYMASTER_PROVIDER;
  }
});
