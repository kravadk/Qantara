import { expect, test } from '@playwright/test';
import { attachPageDiagnostics, expectNoHorizontalOverflow, expectNonBlankPage } from './support/assertions';
import {
  installMockBackend,
  installMockQieRpc,
  installMockWallet,
  mockInvoiceHash,
} from './support/mockRpc';

/**
 * Edge-case journeys: wallet rejection, wrong network, and backend failure.
 * These prove the app degrades with clear UI (no crash, no false success, no
 * silent fail) — the negative space around the happy path in mock-checkout.spec.
 */
test.describe('CI edge-case journeys', () => {
  test('user-rejected payment is recoverable: no crash, no false success, pay stays available', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await installMockBackend(page);
    await installMockQieRpc(page);
    await installMockWallet(page, { rejectTx: true });

    await page.goto('/app/start');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(page.getByText(/connected successfully/i)).toBeVisible();

    await page.goto(`/pay/${mockInvoiceHash}`);
    const payButton = page.getByRole('button', { name: /^pay with/i });
    await expect(payButton).toBeVisible();
    await payButton.click();

    // The wallet threw 4001 — the success state must NOT appear...
    await expect(page.getByText('Payment verified on QIE RPC')).toBeHidden();
    // ...and the flow must remain usable (recoverable), not stuck or blank.
    await expect(payButton).toBeVisible();
    await expectNonBlankPage(page);
    await expectNoHorizontalOverflow(page);

    // A user rejection is expected and handled — it must not surface as an
    // uncaught page error. Console noise from the rejection is tolerated.
    await assertDiagnostics({
      allowConsoleErrors: [/user rejected/i, /4001/, /denied/i, /rejected the request/i],
    });
  });

  test('connecting from the wrong chain auto-switches the wallet to QIE Mainnet', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await installMockBackend(page);
    await installMockQieRpc(page);
    await installMockWallet(page, { initialChainId: 1 }); // start on Ethereum mainnet, not QIE

    await page.goto('/app/start');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByRole('button', { name: /qie wallet|injected/i }).click();

    // Connect requests chain 1990; the wallet must be switched to QIE, not left
    // stranded on the wrong network — connection completes on QIE Mainnet.
    await expect(page.getByText(/connected successfully/i)).toBeVisible();

    await page.goto('/app/settings');
    await expect(page.getByText(/qie mainnet|chain 1990/i).first()).toBeVisible();
    await expectNonBlankPage(page);
    await assertDiagnostics({ allowConsoleErrors: [/chain|network/i] });
  });

  test('backend failure on invoice load shows a clear error state with a retry', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await installMockBackend(page);
    await installMockQieRpc(page);
    await installMockWallet(page);

    // Override the invoice endpoint to fail (registered last => takes precedence).
    await page.route(`**/v1/invoices/${mockInvoiceHash}`, async (route) =>
      route.fulfill({ status: 500, json: { error: 'internal_error' } }),
    );

    await page.goto(`/pay/${mockInvoiceHash}`);

    await expect(
      page.getByRole('heading', { name: /backend unavailable|invoice not loaded|invoice not found/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /retry|check again/i })).toBeVisible();
    await expectNonBlankPage(page);
    await expectNoHorizontalOverflow(page);
    await assertDiagnostics({
      allowConsoleErrors: [/500/, /internal_error/i, /failed to load/i, /Failed to fetch/i],
      allowFailedRequests: [/\/v1\/invoices\//],
    });
  });
});
