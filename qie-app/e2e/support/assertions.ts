import { expect, type Page, type TestInfo } from '@playwright/test';

export function attachPageDiagnostics(page: Page, testInfo: TestInfo) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    failedRequests.push(`${request.method()} ${request.url()} ${failure?.errorText ?? ''}`.trim());
  });

  return async (options: { allowFailedRequests?: RegExp[]; allowConsoleErrors?: RegExp[] } = {}) => {
    const allowedRequests = options.allowFailedRequests ?? [];
    const allowedConsole = options.allowConsoleErrors ?? [];
    const unexpectedRequests = failedRequests.filter((item) => !allowedRequests.some((pattern) => pattern.test(item)));
    const unexpectedConsole = consoleErrors.filter((item) => !allowedConsole.some((pattern) => pattern.test(item)));

    if (unexpectedConsole.length || pageErrors.length || unexpectedRequests.length) {
      await testInfo.attach('browser-diagnostics', {
        body: JSON.stringify({ consoleErrors, pageErrors, failedRequests }, null, 2),
        contentType: 'application/json',
      });
    }

    expect(pageErrors, 'uncaught browser page errors').toEqual([]);
    expect(unexpectedConsole, 'unexpected console errors').toEqual([]);
    expect(unexpectedRequests, 'unexpected failed browser requests').toEqual([]);
  };
}

export async function expectNonBlankPage(page: Page) {
  await expect(page.locator('body')).toBeVisible();
  await expect.poll(async () => {
    return page.locator('body').evaluate((body) => (body.textContent ?? '').trim().length);
  }, { message: 'page should render meaningful text' }).toBeGreaterThan(20);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow, 'horizontal layout overflow in viewport').toBeLessThanOrEqual(2);
}
