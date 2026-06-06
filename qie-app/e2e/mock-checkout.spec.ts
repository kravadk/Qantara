import { expect, test } from '@playwright/test';
import { attachPageDiagnostics, expectNoHorizontalOverflow, expectNonBlankPage } from './support/assertions';
import {
  installMockBackend,
  installMockQieRpc,
  installMockWallet,
  mockInvoiceHash,
  mockTxHash,
} from './support/mockRpc';

test.describe('CI mock-wallet checkout journey', () => {
  test('connects wallet, reads mocked RPC balance, pays invoice, and verifies receipt state', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await installMockBackend(page);
    await installMockQieRpc(page);
    await installMockWallet(page);

    await page.goto('/app/start');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(page.getByText(/connected successfully/i)).toBeVisible();

    await page.goto('/app/settings');
    await expectNonBlankPage(page);
    await expect(page.getByText(/wallet and network/i)).toBeVisible();
    await expect(page.getByText(/qie mainnet|chain 1990/i).first()).toBeVisible();
    await expect(page.locator('body')).toContainText(/QIE/);

    await page.goto(`/pay/${mockInvoiceHash}`);
    await expect(page.getByText(/backend verified invoice/i).first()).toBeVisible();
    await expect(page.getByText(/Native QIE direct transfer/i).first()).toBeVisible();
    await expect(page.getByText(/recommended/i)).toBeVisible();

    const messageBox = page.getByPlaceholder(/ask|message|question/i).first();
    await messageBox.fill('Question from payer');
    await page.getByRole('button', { name: /send deal room message/i }).click();

    await page.getByRole('button', { name: /^pay with/i }).click();
    await expect(page.getByText('Payment verified on QIE RPC')).toBeVisible();
    // Settlement proof: the verified state links out to the payment transaction.
    await expect(page.getByRole('link', { name: new RegExp(`tx:.*${mockTxHash.slice(2, 10)}`, 'i') })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await assertDiagnostics();
  });

  test('missing invoice edge state is clear and nonblank', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await installMockBackend(page);
    await installMockQieRpc(page);
    await installMockWallet(page);

    await page.goto(`/pay/0x${'0'.repeat(64)}`);
    await expectNonBlankPage(page);
    await expect(page.getByRole('heading', { name: /invoice not found|invoice not loaded/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await assertDiagnostics({ allowConsoleErrors: [/404 \(Not Found\)/] });
  });
});
