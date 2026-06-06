import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildReceiptRecordExport,
  buildReceiptRecordShareText,
  collectOperationalBlockers,
  emptyPaymentRailCatalog,
  isFailedWebhookDelivery,
  isSuccessfulWebhookDelivery,
  normalizeExplorerActivityRecord,
  normalizePaymentRequirement,
  normalizePaymentRequirementsResponse,
  normalizePaymentRail,
  normalizeReconciliationStatus,
  notificationOperationalGroup,
  railForToken,
  receiptVerificationState,
  receiptRecordFilename,
  telegramSetupItems,
  type ReceiptRecord,
} from './qantaraApi';

const ROOT = join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['qie-app/src', 'backend/src', 'tg-bot'];
const FORBIDDEN = [
  /qantaraStub/i,
  /fakeTx/i,
  /simulateConfirmation/i,
  /saved locally/i,
  /demo mode/i,
  /local demo/i,
  /in-memory/i,
  /sk_test_demo/i,
  /whsec_demo/i,
  /change_me/i,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return files(path);
    return /\.(ts|tsx|js)$/.test(entry) && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

describe('source hygiene', () => {
  it('does not ship stub/local/fake payment paths in source', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of files(join(ROOT, root))) {
        const content = readFileSync(file, 'utf8');
        const matched = FORBIDDEN.find((pattern) => pattern.test(content));
        if (matched) offenders.push(`${file.replace(`${ROOT}\\`, '')}: ${matched}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not place API credentials in URL query strings', () => {
    const credentialQuery = /[?&](api[_-]?key|apikey|access[_-]?token|auth[_-]?token)=/i;
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of files(join(ROOT, root))) {
        const content = readFileSync(file, 'utf8');
        if (credentialQuery.test(content)) offenders.push(file.replace(`${ROOT}\\`, ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not ship special invoice metadata paths in app operations source', () => {
    const specialInvoicePath = /metadata\s*:\s*{\s*demo|metadata\?\.\s*demo|DemoModePanel/i;
    const offenders: string[] = [];
    for (const file of files(join(ROOT, 'qie-app/src'))) {
      const content = readFileSync(file, 'utf8');
      if (specialInvoicePath.test(content)) offenders.push(file.replace(`${ROOT}\\`, ''));
    }
    expect(offenders).toEqual([]);
  });

  it('keeps checkout route execution driven by backend route actions', () => {
    const paySource = readFileSync(join(ROOT, 'qie-app/src/pages/Pay.tsx'), 'utf8');
    expect(paySource).toContain('for (const action of selectedRoute.actions)');
    expect(paySource).not.toMatch(/selectedRoute\.id\s*===/);
    expect(paySource).not.toMatch(/Unsupported payment route:/);
  });

  it('keeps merchant deal-room realtime on authenticated SSE instead of tight polling only', () => {
    const source = readFileSync(join(ROOT, 'qie-app/src/hooks/useDealRoom.ts'), 'utf8');
    expect(source).toContain("Authorization: `Bearer ${token}`");
    expect(source).toContain("Accept: 'text/event-stream'");
    expect(source).not.toContain("if (role === 'merchant') {\n      setStreamStatus('disabled');");
  });

  it('keeps new product surfaces on domain API modules', () => {
    const checks = [
      ['qie-app/src/pages/Pay.tsx', '../lib/api/invoicesApi'],
      ['qie-app/src/pages/Pay.tsx', '../lib/api/railsApi'],
      ['qie-app/src/pages/Pay.tsx', '../lib/api/merchantApi'],
      ['qie-app/src/pages/app/Webhooks.tsx', '../../lib/api/webhooksApi'],
      ['qie-app/src/components/ResolutionCenter.tsx', '../lib/api/resolutionApi'],
      ['qie-app/src/pages/app/Explorer.tsx', '../../lib/api/explorerApi'],
    ];
    for (const [file, importPath] of checks) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain(importPath);
    }
  });

  it('keeps explorer activity filtering in backend SQL pagination path', () => {
    const explorerRoute = readFileSync(join(ROOT, 'backend/src/routes/explorer.ts'), 'utf8');
    const invoiceRepoSource = readFileSync(join(ROOT, 'backend/src/lib/repositories/invoices.ts'), 'utf8');
    expect(explorerRoute).not.toContain('limit: 200');
    expect(explorerRoute).not.toMatch(/\.filter\(\(inv\)/);
    expect(invoiceRepoSource).toContain('filter.invoiceHash');
    expect(invoiceRepoSource).toContain('filter.token');
  });

  it('classifies persisted operational records for merchant views', () => {
    expect(isSuccessfulWebhookDelivery({ status: 204 })).toBe(true);
    expect(isFailedWebhookDelivery({ status: 500 })).toBe(true);
    expect(notificationOperationalGroup('receipt_created')).toBe('receipt');
    expect(notificationOperationalGroup('webhook_failed')).toBe('webhook');
    expect(notificationOperationalGroup('invoice_message')).toBe('message');
    expect(notificationOperationalGroup('invoice_paid')).toBe('payment');
  });

  it('normalizes public payment rail catalog records', () => {
    const rail = normalizePaymentRail({
      id: 'qie-qusdc',
      chain: { id: 1990, name: 'QIE Mainnet' },
      token: { symbol: 'QUSDC', address: '0x1111111111111111111111111111111111111111' },
      contract_address: '0x2222222222222222222222222222222222222222',
      status: 'ready',
      flows: { permit_checkout: 'enabled', erc20_transfer: 'enabled' },
      acquisitionRoutes: [
        {
          id: 'qusdc.mint_vault',
          label: 'Mint QUSDC from WUSDC',
          tokenSymbol: 'QUSDC',
          state: 'available',
          actionType: 'contract_mint',
          requiresRealTx: true,
          source: 'qusdc_vault_config',
          metadata: {
            vaultAddress: '0x3333333333333333333333333333333333333333',
            wusdcAddress: '0x4444444444444444444444444444444444444444',
            mintMethod: 'deposit',
          },
        },
      ],
    });

    expect(rail).toMatchObject({
      id: 'qie-qusdc',
      chainId: 1990,
      tokenSymbol: 'QUSDC',
      contractAddress: '0x2222222222222222222222222222222222222222',
      status: 'active',
      source: 'backend',
    });
    expect(rail?.flows.map((flow) => flow.label)).toContain('Permit Checkout');
    expect(rail?.acquisitionRoutes?.[0]).toMatchObject({
      id: 'qusdc.mint_vault',
      actionType: 'contract_mint',
      requiresRealTx: true,
      metadata: { mintMethod: 'deposit' },
    });
  });

  it('keeps network strip on backend catalog health instead of browser RPC pings', () => {
    const source = readFileSync(join(ROOT, 'qie-app', 'src', 'components', 'NetworkStrip.tsx'), 'utf8');
    expect(source).toContain('getBackendHealth');
    expect(source).toContain('getQieNetworkCatalog');
    expect(source).not.toContain('eth_blockNumber');
    expect(source).not.toMatch(/const\s+RPC_URL\s*=/);
  });

  it('keeps public landing pages clean and Qantara-branded', () => {
    const publicFiles = [
      join(ROOT, 'qie-app', 'src', 'pages', 'Home.tsx'),
      join(ROOT, 'qie-app', 'src', 'pages', 'Showcase.tsx'),
      join(ROOT, 'qie-app', 'src', 'pages', 'Manifesto.tsx'),
      join(ROOT, 'qie-app', 'src', 'components', 'public', 'PublicMotion.tsx'),
      join(ROOT, 'qie-app', 'src', 'components', 'public', 'usePublicSignals.ts'),
    ];
    const badEncoding = /вЂ|пї|В·|в†|вњ|СЈ|в–/;
    const referenceNames = /Iron Fish|Namada|Aztec|Linearity|Pomegranate|Things, Inc\.|0xtech/i;
    const offenders = publicFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return badEncoding.test(source) || referenceNames.test(source) ? [file.replace(`${ROOT}\\`, '')] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('keeps the landing lightweight (no heavy 3D scene on the home route)', () => {
    const home = readFileSync(join(ROOT, 'qie-app', 'src', 'pages', 'Home.tsx'), 'utf8');
    expect(home).not.toContain('@react-three/fiber');
    expect(home).not.toContain('PaymentNetworkCore');
  });

  it('normalizes backend payment requirement records without local records', () => {
    const requirement = normalizePaymentRequirement({
      id: 'req_1',
      invoice_hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      scheme: 'qantara',
      chain: { id: 1990, name: 'QIE Mainnet' },
      token: { symbol: 'QIE', address: '0x0000000000000000000000000000000000000000' },
      amount_required: '0.001',
      merchant_address: '0x1111111111111111111111111111111111111111',
      verify_url: 'https://api.qantara.app/v1/invoices/hash/verify-payment',
      status: 'ready',
    });

    expect(requirement).toMatchObject({
      id: 'req_1',
      chainId: 1990,
      tokenSymbol: 'QIE',
      amount: '0.001',
      merchant: '0x1111111111111111111111111111111111111111',
      state: 'ready',
      source: 'backend',
    });
  });

  it('normalizes backend payment requirement envelopes', () => {
    const response = normalizePaymentRequirementsResponse({
      invoiceHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      state: 'verifying',
      verifyUrl: '/v1/invoices/hash/verify-payment',
      requirements: [
        {
          type: 'native',
          tokenSymbol: 'QIE',
          amount: '0.01',
          merchant: '0x2222222222222222222222222222222222222222',
        },
      ],
    }, 'fallback-hash');

    expect(response.source).toBe('backend');
    expect(response.state).toBe('pending');
    expect(response.requirements).toHaveLength(1);
    expect(response.requirements[0].invoiceHash).toBe(response.invoiceHash);
  });

  it('normalizes persisted explorer activity records', () => {
    const activity = normalizeExplorerActivityRecord({
      id: 'event_1',
      event_type: 'invoice.paid',
      invoice_hash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      tx_hash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      payer: '0x3333333333333333333333333333333333333333',
      merchant: '0x4444444444444444444444444444444444444444',
      token: { symbol: 'QUSDC' },
      amount: '5.00',
      created_at: 1_700_000_000,
    });

    expect(activity).toMatchObject({
      id: 'event_1',
      type: 'invoice.paid',
      tokenSymbol: 'QUSDC',
      amount: '5.00',
      timestamp: 1_700_000_000,
      source: 'backend',
    });
  });

  it('normalizes reconciliation status from backend persisted records', () => {
    const status = normalizeReconciliationStatus({
      ok: true,
      invoices: {
        total: 9,
        by_status: {
          open: 4,
          paid: 3,
          refunded: 1,
          paused: 1,
        },
      },
      receipts: {
        total: 2,
        issued: 2,
        missing_for_paid: 1,
      },
      chain: {
        indexer: {
          configured: true,
          healthy: false,
          cursor_block: 120,
          rpc_block_number: 132,
          lag_blocks: 12,
          last_error: 'rpc timeout',
        },
        events: {
          total: 14,
          recent_count: 3,
        },
      },
      webhooks: {
        total_deliveries: 7,
        failed_deliveries: 2,
        due_retries: 1,
        pending_retries: 3,
        max_attempts: 4,
        recent_failures: [
          {
            id: 'delivery_1',
            invoice_hash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            event_type: 'invoice.paid',
            status: 500,
            attempts: 2,
            last_error: 'HTTP 500',
          },
        ],
      },
      rpc_verification: {
        failures_24h: 1,
        recent_failures: [
          {
            id: 'event_1',
            invoiceHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            type: 'payment.verify.failed',
            payload: {},
            createdAt: 1_700_000_100,
          },
        ],
      },
    });

    expect(status).toMatchObject({
      ok: true,
      source: 'backend',
      invoices: {
        total: 9,
        open: 4,
        paid: 3,
        refunded: 1,
        paused: 1,
      },
      receipts: {
        total: 2,
        issued: 2,
        missingForPaid: 1,
      },
      chain: {
        indexer: {
          healthy: false,
          lagBlocks: 12,
          lastError: 'rpc timeout',
        },
        events: {
          total: 14,
          recent: 3,
        },
      },
      webhooks: {
        totalDeliveries: 7,
        failedDeliveries: 2,
        dueRetries: 1,
      },
      rpcVerification: {
        failures24h: 1,
      },
    });
    expect(status.webhooks.recentFailures[0].lastError).toBe('HTTP 500');
    expect(status.rpcVerification.recentFailures).toHaveLength(1);
  });

  it('does not fabricate rails when backend catalog is unavailable', () => {
    const catalog = emptyPaymentRailCatalog();
    expect(catalog.source).toBe('backend');
    expect(catalog.rails).toEqual([]);
    expect(railForToken(catalog, '0x0000000000000000000000000000000000000000')).toBeNull();
  });

  it('builds receipt actions from persisted receipt records', () => {
    const receipt: ReceiptRecord = {
      id: 'receipt_1',
      invoiceHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      payer: '0x2222222222222222222222222222222222222222',
      merchant: '0x1111111111111111111111111111111111111111',
      amount: '12.500000',
      token: '0x0000000000000000000000000000000000000000',
      issuedAt: 1_700_000_300,
      receiptHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };
    const options = { explorerUrl: 'https://mainnet.qie.digital', networkLabel: 'QIE Mainnet - chain 1990' };

    expect(receiptRecordFilename(receipt)).toBe('receipt-0x12345678.json');
    expect(buildReceiptRecordExport(receipt, options)).toMatchObject({
      invoiceHash: receipt.invoiceHash,
      receiptHash: receipt.receiptHash,
      token: 'QIE',
      explorerTxUrl: `${options.explorerUrl}/tx/${receipt.txHash}`,
    });
    expect(buildReceiptRecordShareText(receipt, options)).toContain(receipt.receiptHash);
  });

  it('classifies receipt verification source of truth', () => {
    expect(receiptVerificationState({ status: 1, paidTxHash: '0xabc' }, {
      receiptHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })).toEqual({
      label: 'Receipt issued',
      detail: 'Persisted backend receipt record is the source of truth',
      tone: 'good',
    });

    expect(receiptVerificationState({ status: 1, paidTxHash: '0xabc' }, {
      receiptHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      verification: {
        source: 'backend_sqlite_rpc_verified',
        policy: 'issued_after_verified_payment',
        anchored: true,
        onChainAnchor: {
          enabled: true,
          configured: true,
          registryAddress: '0x1111111111111111111111111111111111111111',
          status: 'anchored',
          mode: 'optional_receipt_registry',
        },
      },
    })).toEqual({
      label: 'Receipt anchored',
      detail: 'Receipt record is anchored on-chain and linked to the verified payment',
      tone: 'good',
    });

    expect(receiptVerificationState({ status: 1, paidTxHash: '0xabc' }, null)).toEqual({
      label: 'Payment verified',
      detail: 'Backend paid status is verified; receipt record is pending',
      tone: 'warn',
    });

    expect(receiptVerificationState({ status: 0, paidTxHash: undefined }, null)).toEqual({
      label: 'No verified receipt',
      detail: 'Receipt appears after QIE RPC verification',
      tone: 'neutral',
    });
  });

  it('summarizes operational blockers from runtime status', () => {
    expect(collectOperationalBlockers({
      walletConnected: false,
      expectedChainId: 1990,
      hasMerchantAuth: false,
      backendHealth: {
        ok: false,
        rpc: { configured: false, url: '' },
      } as any,
    })).toEqual([
      'Connect a merchant wallet',
      'Backend API unavailable',
      'QIE RPC endpoint is not configured',
      'Sign in with a merchant wallet for merchant operations',
    ]);

    expect(collectOperationalBlockers({
      walletConnected: true,
      currentChainId: 1,
      expectedChainId: 1990,
      hasMerchantAuth: true,
      backendHealth: {
        ok: true,
        rpc: { ok: false, configured: true, url: '', error: 'connection refused' },
      } as any,
      settingsError: 'HTTP 401',
    })).toEqual([
      'Switch wallet to chain 1990',
      'QIE RPC unhealthy: connection refused',
      'Authenticated settings unavailable: HTTP 401',
    ]);
  });

  it('reports Telegram setup from authenticated backend status', () => {
    expect(telegramSetupItems(null, false)).toEqual([
      { label: 'Merchant auth', value: 'wallet sign-in required', ok: false },
      { label: 'Bot token', value: 'waiting for authenticated status', ok: false },
      { label: 'Webhook signing', value: 'waiting for authenticated status', ok: false },
      { label: 'Alert webhook', value: 'waiting for authenticated status', ok: false },
    ]);

    expect(telegramSetupItems({
      telegram: { botTokenConfigured: true },
      webhooks: { signingConfigured: true },
      alerts: { webhookConfigured: true, minSeverity: 'critical' },
    } as any, true)).toEqual([
      { label: 'Merchant auth', value: 'connected', ok: true },
      { label: 'Bot token', value: 'configured', ok: true },
      { label: 'Webhook signing', value: 'HMAC configured', ok: true },
      { label: 'Alert webhook', value: 'configured at critical', ok: true },
    ]);
  });
});
