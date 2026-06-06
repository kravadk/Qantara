import { expect, test } from '@playwright/test';
import { attachPageDiagnostics, expectNoHorizontalOverflow, expectNonBlankPage } from './support/assertions';

const invoiceHash = `0x${'a'.repeat(64)}`;
const merchant = '0x1111111111111111111111111111111111111111';
const zero = '0x0000000000000000000000000000000000000000';
const qusdc = '0x88aBC76fd8e3d725139Ecc6BB75582aA3f14ec2D';

test.describe('product surface regressions', () => {
  test('pay page renders backend route planner and resolution center', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await page.route('**/v1/invoices/**/messages**', async (route) => route.fulfill({ json: { messages: [], count: 0 } }));
    await page.route('**/v1/invoices/**/events**', async (route) => {
      if (route.request().headers().accept?.includes('text/event-stream')) {
        return route.fulfill({ body: '', headers: { 'content-type': 'text/event-stream' } });
      }
      return route.fulfill({ json: { events: [], count: 0 } });
    });
    await page.route(`**/v1/invoices/${invoiceHash}`, async (route) => route.fulfill({
      json: {
        hash: invoiceHash,
        merchant,
        payer: null,
        token: zero,
        amount: '0.001',
        invoice_type: 0,
        status: 0,
        created_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        title: 'Route planner checkout',
        memo: 'Backend route source test',
        metadata: {},
      },
    }));
    await page.route(`**/v1/payment-routes/${invoiceHash}`, async (route) => route.fulfill({
      json: {
        invoiceHash,
        chainId: 1990,
        network: 'QIE Mainnet',
        state: 'ready',
        payable: true,
        token: { symbol: 'QIE', address: zero, decimals: 18 },
        amount: '0.001',
        merchant,
        payer: null,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        recommendedRouteId: 'qie.direct_transfer',
        routes: [{
          id: 'qie.direct_transfer',
          rail: 'QIE',
          method: 'native-transfer',
          label: 'Native QIE direct transfer',
          state: 'ready',
          recommended: true,
          reason: 'Native QIE is ready',
          token: { symbol: 'QIE', address: zero, decimals: 18 },
          settlementContract: null,
          actions: [{ type: 'wallet_sendTransaction', label: 'Send QIE to merchant', target: merchant, value: '0.001' }],
          verifyEndpoint: `/v1/invoices/${invoiceHash}/verify-payment`,
          explorer: { merchantUrl: null, tokenUrl: null, settlementContractUrl: null, txUrlTemplate: 'https://mainnet.qie.digital/tx/{txHash}' },
          source: 'backend_invoice_and_rail_catalog',
        }],
        dataSources: ['sqlite.invoice', 'backend.rails', 'qie.rpc.health', 'deployment.registry'],
      },
    }));
    await page.route(`**/v1/merchants/public/${merchant}`, async (route) => route.fulfill({
      json: {
        merchant,
        displayName: 'Verified Merchant',
        website: 'https://merchant.example',
        listed: true,
        trust: { walletVerified: true, telegramVerified: true, domainVerified: true, domain: 'merchant.example' },
      },
    }));

    await page.goto(`/pay/${invoiceHash}`);
    await expectNonBlankPage(page);
    await expect(page.getByText(/Native QIE direct transfer/i).first()).toBeVisible();
    await expect(page.getByText(/recommended/i).first()).toBeVisible();
    await expect(page.getByText(/Resolution center/i).first()).toBeVisible();
    // Refund / dispute payer actions are present in the resolution center.
    await expect(page.getByRole('button', { name: /Request refund/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open dispute/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await assertDiagnostics({ allowFailedRequests: [/127\.0\.0\.1:4000/] });
  });

  test('pay page surfaces gasless paymaster route without native gas requirement', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await page.route('**/v1/invoices/**/messages**', async (route) => route.fulfill({ json: { messages: [], count: 0 } }));
    await page.route('**/v1/invoices/**/events**', async (route) => {
      if (route.request().headers().accept?.includes('text/event-stream')) {
        return route.fulfill({ body: '', headers: { 'content-type': 'text/event-stream' } });
      }
      return route.fulfill({ json: { events: [], count: 0 } });
    });
    await page.route(`**/v1/invoices/${invoiceHash}`, async (route) => route.fulfill({
      json: {
        hash: invoiceHash,
        merchant,
        payer: null,
        token: qusdc,
        amount: '12.50',
        invoice_type: 0,
        status: 0,
        created_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        title: 'Gasless checkout',
        metadata: {},
      },
    }));
    await page.route(`**/v1/payment-routes/${invoiceHash}`, async (route) => route.fulfill({
      json: {
        invoiceHash,
        chainId: 1990,
        network: 'QIE Mainnet',
        state: 'ready',
        payable: true,
        token: { symbol: 'QUSDC', address: qusdc, decimals: 6 },
        amount: '12.50',
        merchant,
        payer: null,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        recommendedRouteId: 'qusdc.gasless_paymaster',
        routes: [
          {
            id: 'qusdc.gasless_paymaster',
            rail: 'QUSDC',
            method: 'gasless-paymaster',
            label: 'Gasless QUSDC paymaster checkout',
            state: 'ready',
            recommended: true,
            reason: 'qevie_paymaster gasless checkout is configured',
            token: { symbol: 'QUSDC', address: qusdc, decimals: 6 },
            settlementContract: null,
            requiresNativeGas: false,
            provider: 'qevie_paymaster',
            fallbackRouteIds: ['qusdc.permit_and_pay', 'qusdc.approve_and_pay'],
            actions: [{ type: 'external_checkout', label: 'Open qevie_paymaster gasless checkout', target: null, method: 'open_paymaster_checkout', amount: '12.50', url: 'https://paymaster.example/checkout' }],
            verifyEndpoint: `/v1/invoices/${invoiceHash}/verify-payment`,
            explorer: { merchantUrl: null, tokenUrl: `https://mainnet.qie.digital/address/${qusdc}`, settlementContractUrl: null, txUrlTemplate: 'https://mainnet.qie.digital/tx/{txHash}' },
            source: 'backend_invoice_and_rail_catalog',
          },
          {
            id: 'qusdc.approve_and_pay',
            rail: 'QUSDC',
            method: 'approve-and-pay',
            label: 'Approve and pay through Qantara',
            state: 'ready',
            recommended: false,
            reason: 'Qantara fallback is configured',
            token: { symbol: 'QUSDC', address: qusdc, decimals: 6 },
            settlementContract: null,
            requiresNativeGas: true,
            actions: [{ type: 'erc20_approve', label: 'Approve Qantara to spend QUSDC', target: qusdc, method: 'approve', amount: '12.50' }],
            verifyEndpoint: `/v1/invoices/${invoiceHash}/verify-payment`,
            explorer: { merchantUrl: null, tokenUrl: `https://mainnet.qie.digital/address/${qusdc}`, settlementContractUrl: null, txUrlTemplate: 'https://mainnet.qie.digital/tx/{txHash}' },
            source: 'backend_invoice_and_rail_catalog',
          },
        ],
        dataSources: ['sqlite.invoice', 'backend.rails', 'qie.rpc.health', 'deployment.registry'],
      },
    }));
    await page.route('**/v1/rails/qusdc/capabilities', async (route) => route.fulfill({
      json: {
        supported: true,
        status: 'ready',
        reason: 'QUSDC configured',
        address: qusdc,
        metadata: { name: 'QUSDC', symbol: 'QUSDC', decimals: 6 },
        capabilities: {
          erc20Transfer: true,
          approveAndPay: true,
          permit: { supported: true, reason: 'DOMAIN_SEPARATOR and nonces are callable' },
          eip3009: { supported: false, reason: 'authorizationState unavailable' },
        },
        checkedAt: Math.floor(Date.now() / 1000),
        source: 'qie_rpc_contract_probe',
      },
    }));
    await page.route(`**/v1/merchants/public/${merchant}`, async (route) => route.fulfill({ json: { merchant, listed: false, trust: { walletVerified: true } } }));

    await page.goto(`/pay/${invoiceHash}`);
    await expectNonBlankPage(page);
    await expect(page.getByRole('button', { name: /Gasless QUSDC paymaster checkout gasless-paymaster/i })).toBeVisible();
    await expect(page.getByText(/No QIE gas/i).first()).toBeVisible();
    await expect(page.getByText(/qevie_paymaster/i).first()).toBeVisible();
    await expect(page.getByText(/qusdc\.permit_and_pay/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Open Gasless QUSDC paymaster checkout/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await assertDiagnostics({ allowFailedRequests: [/127\.0\.0\.1:4000/] });
  });

  test('settings exposes merchant trust profile controls', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await page.goto('/app/settings');
    await expectNonBlankPage(page);
    await expect(page.getByText(/Merchant trust profile/i)).toBeVisible();
    await expect(page.getByText(/Public merchant directory/i)).toBeVisible();
    await expect(page.getByText(/Domain verification/i)).toBeVisible();
    await assertDiagnostics({ allowFailedRequests: [/127\.0\.0\.1:4000/] });
  });

  test('webhook console exposes delivery and signing operations', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await page.goto('/app/webhooks');
    await expectNonBlankPage(page);
    await expect(page.getByRole('heading', { name: /Webhook Console/i })).toBeVisible();
    await expect(page.getByText(/signature verification/i)).toBeVisible();
    await expect(page.getByText(/Test webhook/i)).toBeVisible();
    await assertDiagnostics({ allowFailedRequests: [/127\.0\.0\.1:4000/] });
  });
});
