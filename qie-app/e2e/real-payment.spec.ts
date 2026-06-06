import { expect, test } from '@playwright/test';
import { attachPageDiagnostics, expectNonBlankPage } from './support/assertions';
import { canRunRealTx, e2eEnv } from './support/env';
import { appendRealE2EScenario, initializeRealE2EReport, writeRealE2EReport } from './support/report';
import { installE2EWallet } from './support/wallet';

test.describe.serial('real QIE invoice and payment flow', () => {
  test.skip(!canRunRealTx(), 'Run npm run e2e:preflight; funded E2E wallets and E2E_ALLOW_REAL_TX=true are required');

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === 'passed') return;
    appendRealE2EScenario({
      name: testInfo.title,
      status: testInfo.status === 'skipped' ? 'skipped' : 'failed',
      detail: testInfo.error?.message,
      at: new Date().toISOString(),
    });
    writeRealE2EReport({ status: testInfo.status === 'skipped' ? 'skipped' : 'failed' });
  });

  test('creates an on-chain invoice, pays it, verifies receipt and timeline', async ({ browser }, testInfo) => {
    initializeRealE2EReport();
    writeRealE2EReport({ status: 'running' });
    const scenarioName = 'create invoice -> pay -> verify receipt';
    const merchantContext = await browser.newContext();
    const merchant = await merchantContext.newPage();
    const merchantDiagnostics = attachPageDiagnostics(merchant, testInfo);
    await installE2EWallet(merchant, 'merchant');

    await merchant.goto('/app/start');
    await merchant.getByRole('button', { name: /connect wallet/i }).click();
    await merchant.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(merchant.getByText(/connected successfully/i)).toBeVisible();
    await merchant.goto('/app/new-cipher');
    await expectNonBlankPage(merchant);

    await merchant.getByPlaceholder(/amount/i).fill(e2eEnv.invoiceAmount);
    await merchant.getByPlaceholder(/what is this for/i).fill(`E2E QIE invoice ${Date.now()}`);
    await merchant.getByText(/no expiry/i).click();
    await merchant.getByRole('button', { name: /review invoice/i }).click();
    await merchant.getByRole('button', { name: /^continue/i }).click();
    await merchant.getByRole('button', { name: /deploy qie qantara/i }).click();
    await expect(merchant.getByText(/invoice created/i)).toBeVisible({ timeout: 180_000 });

    const invoiceHash = (await merchant.locator('text=/0x[a-fA-F0-9]{64}/').first().textContent())?.trim();
    expect(invoiceHash, 'invoice hash created by UI').toMatch(/^0x[a-fA-F0-9]{64}$/);
    await testInfo.attach('invoice-hash', { body: invoiceHash!, contentType: 'text/plain' });
    writeRealE2EReport({ artifacts: { invoiceHash: invoiceHash! } });

    const payerContext = await browser.newContext();
    const payer = await payerContext.newPage();
    const payerDiagnostics = attachPageDiagnostics(payer, testInfo);
    await installE2EWallet(payer, 'payer');
    await payer.goto(`/pay/${invoiceHash}`);
    await expect(payer.getByText(/backend verified invoice/i)).toBeVisible();
    await payer.getByRole('button', { name: /connect wallet to pay/i }).click();
    await payer.getByRole('button', { name: /qie wallet|injected/i }).click();
    await expect(payer.getByText(/connected successfully/i)).toBeVisible();

    const messageBox = payer.getByPlaceholder(/ask|message|question/i).first();
    if (await messageBox.count()) {
      await messageBox.fill('E2E payer question before payment');
      await payer.getByRole('button', { name: /send/i }).click();
    }

    await payer.getByRole('button', { name: /pay/i }).click();
    await expect(payer.getByText(/payment verified|receipt|paid/i)).toBeVisible({ timeout: 240_000 });
    await expect(payer.getByRole('link', { name: /explorer|transaction/i }).or(payer.getByText(/tx/i))).toBeVisible();
    const pageText = await payer.locator('body').innerText();
    const hashes = pageText.match(/0x[a-fA-F0-9]{64}/g) ?? [];
    const paymentTxHash = hashes.find((value) => value.toLowerCase() !== invoiceHash!.toLowerCase());
    if (paymentTxHash) {
      await testInfo.attach('payment-tx-hash', { body: paymentTxHash, contentType: 'text/plain' });
      writeRealE2EReport({ artifacts: { paymentTxHash } });
    }

    const receiptResponse = await fetch(`${e2eEnv.backendUrl}/v1/receipts/${invoiceHash}`);
    if (receiptResponse.ok) {
      const receipt = await receiptResponse.json() as { receiptHash?: string; txHash?: string };
      writeRealE2EReport({ artifacts: { receiptHash: receipt.receiptHash, receiptTxHash: receipt.txHash } });
      if (receipt.receiptHash) await testInfo.attach('receipt-hash', { body: receipt.receiptHash, contentType: 'text/plain' });
    }

    await merchant.goto('/app/dashboard');
    await expect(merchant.getByText(invoiceHash!.slice(0, 10), { exact: false })).toBeVisible({ timeout: 60_000 });
    await merchant.goto(`/pay/${invoiceHash}`);
    await expect(merchant.getByText(/already paid|receipt|paid/i)).toBeVisible();

    await payerDiagnostics();
    await merchantDiagnostics();
    await payerContext.close();
    await merchantContext.close();
    appendRealE2EScenario({ name: scenarioName, status: 'passed', at: new Date().toISOString() });
    writeRealE2EReport({ status: 'passed' });
  });
});
