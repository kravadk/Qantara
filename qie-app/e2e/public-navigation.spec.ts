import { expect, test } from '@playwright/test';
import { attachPageDiagnostics, expectNoHorizontalOverflow, expectNonBlankPage } from './support/assertions';
import { e2eEnv, hasFundedWalletEnv } from './support/env';
import { installE2EWallet } from './support/wallet';

const publicRoutes = ['/', '/manifesto', '/status', '/app/start', '/app/settings', '/app/telegram-bot'];
const appRoutes = [
  '/app/start',
  '/app/dashboard',
  '/app/new-cipher',
  '/app/inbox',
  '/app/notifications',
  '/app/payment-proofs',
  '/app/webhooks',
  '/app/advanced',
  '/app/distribute',
  '/app/developer',
  '/app/build',
  '/app/checkout-api',
  '/app/guide',
  '/app/sdk',
  '/app/settings',
];

async function waitForBackendHealth() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const res = await fetch(`${e2eEnv.backendUrl}/v1/health`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError instanceof Error ? lastError : new Error('Backend health endpoint did not become ready');
}

test.describe('public navigation audit', () => {
  for (const route of publicRoutes) {
    test(`renders ${route} without blank screen`, async ({ page }, testInfo) => {
      const assertDiagnostics = attachPageDiagnostics(page, testInfo);
      if (route === '/status') await waitForBackendHealth();
      await page.goto(route);
      await expectNonBlankPage(page);
      await expectNoHorizontalOverflow(page);
      await assertDiagnostics({ allowFailedRequests: [/api\.qantara\.app|127\.0\.0\.1:4000/] });
    });
  }

  test('not-found pay page shows a clear state', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await page.goto('/pay/0x0000000000000000000000000000000000000000000000000000000000000000');
    await expectNonBlankPage(page);
    await expect(page.getByRole('heading', { name: /invoice not found/i })).toBeVisible();
    await assertDiagnostics({ allowConsoleErrors: [/404 \(Not Found\)/] });
  });
});

test.describe('authenticated route audit', () => {
  test.skip(!hasFundedWalletEnv(), 'Run npm run e2e:preflight; funded E2E wallet keys are required');

  test('merchant can connect and visit primary workspace routes', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await installE2EWallet(page, 'merchant');
    await page.goto('/app/start');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(page.getByText(/connected successfully/i)).toBeVisible();

    for (const route of appRoutes) {
      await page.goto(route);
      await expectNonBlankPage(page);
      await expectNoHorizontalOverflow(page);
    }
    await assertDiagnostics({ allowFailedRequests: [/127\.0\.0\.1:4000/] });
  });
});
