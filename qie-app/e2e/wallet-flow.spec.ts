import { expect, test } from '@playwright/test';
import { attachPageDiagnostics, expectNoHorizontalOverflow, expectNonBlankPage } from './support/assertions';
import { e2eEnv, hasFundedWalletEnv } from './support/env';
import { installE2EWallet } from './support/wallet';

test.describe('wallet user flows', () => {
  test.skip(!hasFundedWalletEnv(), 'Run npm run e2e:preflight; funded E2E wallet keys are required');

  test('connects, shows real RPC balance, disconnects, and reconnects', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    const wallet = await installE2EWallet(page, 'merchant');
    await page.goto('/app/start');

    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(page.getByText(/connected successfully/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(wallet.address.slice(0, 6), { exact: false })).toBeVisible();

    await page.goto('/app/settings');
    await expect(page.getByText(/wallet and network/i)).toBeVisible();
    await expect(page.getByText(/qie mainnet|chain 1990/i)).toBeVisible();
    await expect(page.getByText(/balance unavailable|checking balance|qie/i)).toBeVisible();

    await page.getByRole('button', { name: /disconnect/i }).click();
    await expect(page.getByRole('button', { name: /connect/i })).toBeVisible();

    await page.getByRole('button', { name: /connect/i }).click();
    await page.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(page.getByText(/connected successfully/i)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await assertDiagnostics({ allowFailedRequests: [/127\.0\.0\.1:4000/] });
  });

  test('wrong network can be switched to QIE Mainnet', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await installE2EWallet(page, 'merchant', { initialChainId: 1983 });
    await page.goto('/app/start');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(page.getByText(/wrong network|switch to qie mainnet/i)).toBeVisible();
    await page.getByRole('button', { name: /switch to qie mainnet/i }).click();
    await expect(page.getByText(/connected successfully/i)).toBeVisible();
    await page.goto('/app/settings');
    await expectNonBlankPage(page);
    await expect(page.getByText(new RegExp(`chain ${e2eEnv.chainId}|qie mainnet`, 'i'))).toBeVisible();
    await assertDiagnostics({ allowFailedRequests: [/127\.0\.0\.1:4000/] });
  });
});
