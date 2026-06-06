import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQantaraLink,
  parseQantaraLink,
  isQantaraLink,
  qantaraLinkToEip681,
  qantaraLinkExpired,
  canonicalQantaraLinkPayload,
  payButtonHtml,
  embedCheckoutHtml,
  QANTARA_DEFAULT_CHAIN_ID,
} from '../dist/index.mjs';

const MERCHANT = '0x00000000000000000000000000000000000000aB';
const TOKEN = '0x000000000000000000000000000000000000C0De';
const HASH = `0x${'1'.repeat(64)}`;

test('builds a native qantara:// link and parses it back (round-trip)', () => {
  const link = buildQantaraLink({ to: MERCHANT, amount: '1.5', invoiceHash: HASH, label: 'Acme', message: 'Order 1001', expiry: 1750000000 });
  assert.ok(link.startsWith('qantara://pay?'));
  assert.equal(isQantaraLink(link), true);

  const parsed = parseQantaraLink(link);
  assert.equal(parsed.to, MERCHANT.toLowerCase());
  assert.equal(parsed.chainId, QANTARA_DEFAULT_CHAIN_ID);
  assert.equal(parsed.amount, '1.5');
  assert.equal(parsed.invoiceHash, HASH);
  assert.equal(parsed.label, 'Acme');
  assert.equal(parsed.message, 'Order 1001');
  assert.equal(parsed.expiry, 1750000000);
  assert.equal(parsed.token, undefined);
});

test('round-trips an ERC-20 link with token + decimals', () => {
  const link = buildQantaraLink({ to: MERCHANT, token: TOKEN, amount: '100', decimals: 6, chainId: 1990 });
  const parsed = parseQantaraLink(link);
  assert.equal(parsed.token, TOKEN.toLowerCase());
  assert.equal(parsed.decimals, 6);
  assert.equal(parsed.amount, '100');
});

test('converts to EIP-681 for native and ERC-20', () => {
  const native = qantaraLinkToEip681({ to: MERCHANT, amount: '1.5' });
  assert.equal(native, `ethereum:${MERCHANT.toLowerCase()}@1990?value=1500000000000000000`);

  const erc20 = qantaraLinkToEip681({ to: MERCHANT, token: TOKEN, amount: '100', decimals: 6 });
  assert.equal(erc20, `ethereum:${TOKEN.toLowerCase()}@1990/transfer?address=${MERCHANT.toLowerCase()}&uint256=100000000`);
});

test('canonical payload is stable and excludes the signature', () => {
  const a = canonicalQantaraLinkPayload({ to: MERCHANT, amount: '2', invoiceHash: HASH, expiry: 123, signature: 'deadbeef' });
  const b = canonicalQantaraLinkPayload({ signature: 'other', expiry: 123, invoiceHash: HASH, amount: '2', to: MERCHANT });
  assert.equal(a, b);
  assert.equal(a.includes('sig'), false);
});

test('detects expiry', () => {
  assert.equal(qantaraLinkExpired({ to: MERCHANT, expiry: 100 }, 200), true);
  assert.equal(qantaraLinkExpired({ to: MERCHANT, expiry: 300 }, 200), false);
  assert.equal(qantaraLinkExpired({ to: MERCHANT }, 200), false);
});

test('rejects invalid links', () => {
  assert.throws(() => parseQantaraLink('https://example.com/pay/x'), /not a qantara/);
  assert.throws(() => buildQantaraLink({ to: 'not-an-address' }), /must be a 0x-prefixed/);
  assert.throws(() => parseQantaraLink('qantara://pay?chain=1990'), /missing required "to"/);
  assert.throws(() => buildQantaraLink({ to: MERCHANT, amount: 'abc' }), /amount must be a decimal/);
});

test('payButtonHtml builds a safe anchor and escapes input', () => {
  const html = payButtonHtml({ href: 'https://pay.example/pay/0xabc', label: 'Buy now' });
  assert.ok(html.includes('href="https://pay.example/pay/0xabc"'));
  assert.ok(html.includes('Buy now'));
  assert.ok(html.includes('data-qantara-pay-button'));
  // No raw quotes from injected label break the attribute.
  const injected = payButtonHtml({ href: 'https://x', label: '"><script>alert(1)</script>' });
  assert.equal(injected.includes('<script>'), false);
});

test('embedCheckoutHtml builds an iframe for the invoice hash', () => {
  const html = embedCheckoutHtml({ hash: '0xdead', baseUrl: 'https://qantara.app/', height: 700 });
  assert.ok(html.includes('src="https://qantara.app/checkout/0xdead"'));
  assert.ok(html.includes('height="700"'));
});
