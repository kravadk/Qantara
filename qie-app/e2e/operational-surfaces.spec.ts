import { expect, test } from '@playwright/test';
import { attachPageDiagnostics, expectNoHorizontalOverflow, expectNonBlankPage } from './support/assertions';
import { e2eEnv } from './support/env';

async function backendJson(path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const res = await fetch(`${e2eEnv.backendUrl}${path}`);
      const body = await res.json().catch(() => ({}));
      return { res, body };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Backend request failed: ${path}`);
}

test.describe('production source-of-truth surfaces', () => {
  test('public backend catalog and reconciliation endpoints expose real state only', async () => {
    const rails = await backendJson('/v1/rails');
    expect(rails.res.status).toBe(200);
    expect(rails.body.ok).toBe(true);
    expect(rails.body.network.chainId).toBe(e2eEnv.chainId);
    expect(Array.isArray(rails.body.rails)).toBe(true);
    expect(rails.body.rails.some((rail: any) => rail.tokenSymbol === 'QIE' && rail.enabled === true)).toBe(true);
    expect(JSON.stringify(rails.body)).not.toMatch(/api[_-]?key|secret|bearer/i);

    const activity = await backendJson('/v1/explorer/activity?limit=5');
    expect(activity.res.status).toBe(200);
    expect(activity.body.source).toBe('sqlite');
    expect(Array.isArray(activity.body.activity)).toBe(true);
    expect(JSON.stringify(activity.body)).not.toMatch(/guest[_-]?token|webhook.*https?:\/\//i);

    const reconciliation = await backendJson('/v1/reconciliation/status');
    expect(reconciliation.res.status).toBe(200);
    expect(reconciliation.body.source).toBe('sqlite');
    expect(reconciliation.body.db.status).toBe('ok');
    expect(Number(reconciliation.body.invoices.total)).toBeGreaterThanOrEqual(0);
    expect(Number(reconciliation.body.receipts.total)).toBeGreaterThanOrEqual(0);
    expect(Number(reconciliation.body.webhooks.failedDeliveries)).toBeGreaterThanOrEqual(0);
    const reconciliationPayload = JSON.stringify(reconciliation.body);
    expect(reconciliationPayload).not.toMatch(/authorization|bearer|target[_-]?url|https?:\/\/[^"]*webhook/i);
    expect(reconciliationPayload).not.toMatch(/sk_live|sk_test|whsec|secret_/i);
  });

  test('payment requirements return an explicit not-found state for unknown invoices', async () => {
    const missing = await backendJson('/v1/payment-requirements/0x0000000000000000000000000000000000000000000000000000000000000000');
    expect(missing.res.status).toBe(404);
    expect(missing.body.error).toBe('not_found');

    const routes = await backendJson('/v1/payment-routes/0x0000000000000000000000000000000000000000000000000000000000000000');
    expect(routes.res.status).toBe(404);
    expect(routes.body.error).toBe('not_found');
  });
});

test.describe('operational UI surfaces', () => {
  test('Build page exposes rail, requirement debugger, and reconciliation panels', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await page.goto('/app/build');
    await expectNonBlankPage(page);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('heading', { name: /build/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /payment rails/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /requirement debugger/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /route planner/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /reconciliation/i })).toBeVisible();

    await page.getByRole('textbox', { name: /invoice hash/i }).first().fill('0x0000000000000000000000000000000000000000000000000000000000000000');
    await page.getByRole('button', { name: /fetch from backend/i }).click();
    await expect(page.getByText(/not_found|not found|payment requirements endpoint unavailable/i)).toBeVisible();
    await assertDiagnostics({ allowConsoleErrors: [/404 \(Not Found\)/i] });
  });

  test('Settings page shows persisted reconciliation without merchant browser API keys', async ({ page }, testInfo) => {
    const assertDiagnostics = attachPageDiagnostics(page, testInfo);
    await page.goto('/app/settings');
    await expectNonBlankPage(page);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('heading', { name: 'Reconciliation' })).toBeVisible();
    await expect(page.getByText(/backend persisted invoices/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment rails' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/browser api key|vite_qantara_api_key/i);
    await assertDiagnostics();
  });
});
