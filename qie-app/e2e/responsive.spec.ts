import { test } from '@playwright/test';
import { attachPageDiagnostics, expectNoHorizontalOverflow, expectNonBlankPage } from './support/assertions';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const routes = ['/', '/status', '/app/start', '/app/settings', '/app/webhooks', '/app/telegram-bot', '/pay/0x0000000000000000000000000000000000000000000000000000000000000000'];

for (const viewport of viewports) {
  test.describe(`responsive ${viewport.name}`, () => {
    test.use({ viewport });

    for (const route of routes) {
      test(`${route} has no horizontal overflow`, async ({ page }, testInfo) => {
        const assertDiagnostics = attachPageDiagnostics(page, testInfo);
        await page.goto(route);
        await expectNonBlankPage(page);
        await expectNoHorizontalOverflow(page);
        await assertDiagnostics({
          allowFailedRequests: [/127\.0\.0\.1:4000/],
          allowConsoleErrors: [/404 \(Not Found\)/],
        });
      });
    }
  });
}
