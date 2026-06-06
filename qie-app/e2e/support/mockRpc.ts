import type { Page } from '@playwright/test';

export const mockTxHash = `0x${'9'.repeat(64)}`;
export const mockMerchant = '0x1111111111111111111111111111111111111111';
export const mockPayer = '0x2222222222222222222222222222222222222222';
export const mockInvoiceHash = `0x${'a'.repeat(64)}`;
export const zeroAddress = '0x0000000000000000000000000000000000000000';

export async function installMockQieRpc(page: Page) {
  await page.route('https://rpc1mainnet.qie.digital/**', async (route) => {
    const request = route.request();
    let payload: unknown = {};
    if (request.method() === 'POST') {
      try {
        payload = request.postDataJSON();
      } catch {
        payload = {};
      }
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    const results = calls.map((call: any) => {
      const method = call?.method;
      const id = call?.id ?? 1;
      switch (method) {
        case 'eth_chainId':
          return { jsonrpc: '2.0', id, result: '0x7c6' };
        case 'eth_blockNumber':
          return { jsonrpc: '2.0', id, result: '0x12345' };
        case 'eth_getBalance':
          return { jsonrpc: '2.0', id, result: '0xab54a98ceb1f0ad2' };
        case 'eth_gasPrice':
          return { jsonrpc: '2.0', id, result: '0x3b9aca00' };
        case 'eth_maxPriorityFeePerGas':
          return { jsonrpc: '2.0', id, result: '0x3b9aca00' };
        case 'eth_feeHistory':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              oldestBlock: '0x12340',
              baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
              gasUsedRatio: [0.5],
              reward: [['0x3b9aca00']],
            },
          };
        case 'eth_estimateGas':
          return { jsonrpc: '2.0', id, result: '0x5208' };
        case 'eth_call':
          return { jsonrpc: '2.0', id, result: '0x' };
        case 'net_version':
          return { jsonrpc: '2.0', id, result: '1990' };
        case 'eth_getBlockByNumber':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              number: '0x12346',
              hash: `0x${'8'.repeat(64)}`,
              parentHash: `0x${'7'.repeat(64)}`,
              timestamp: '0x65f00000',
              baseFeePerGas: '0x3b9aca00',
              gasLimit: '0x1c9c380',
              gasUsed: '0x5208',
              transactions: [],
            },
          };
        case 'eth_getTransactionByHash':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              hash: mockTxHash,
              from: mockPayer,
              to: mockMerchant,
              value: '0x38d7ea4c68000',
              input: '0x',
              nonce: '0x1',
              blockHash: `0x${'8'.repeat(64)}`,
              blockNumber: '0x12346',
              transactionIndex: '0x0',
              gas: '0x5208',
              gasPrice: '0x3b9aca00',
              type: '0x2',
              chainId: '0x7c6',
            },
          };
        case 'eth_getTransactionReceipt':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              transactionHash: mockTxHash,
              blockHash: `0x${'8'.repeat(64)}`,
              blockNumber: '0x12346',
              contractAddress: null,
              cumulativeGasUsed: '0x5208',
              effectiveGasPrice: '0x3b9aca00',
              from: mockPayer,
              gasUsed: '0x5208',
              logs: [],
              logsBloom: `0x${'0'.repeat(512)}`,
              status: '0x1',
              to: mockMerchant,
              transactionIndex: '0x0',
              type: '0x2',
            },
          };
        default:
          return { jsonrpc: '2.0', id, result: '0x' };
      }
    });
    await route.fulfill({ json: Array.isArray(payload) ? results : results[0] });
  });
}

export async function installMockWallet(
  page: Page,
  options: { initialChainId?: number; rejectTx?: boolean; rejectSign?: boolean } = {},
) {
  await page.addInitScript(({ address, initialChainId, txHash, rejectTx, rejectSign }) => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    let currentChainId = initialChainId;
    const emit = (event: string, payload: unknown) => {
      for (const cb of listeners.get(event) ?? []) cb(payload);
    };
    // Mirrors how MetaMask/QIE Wallet surface a user dismissal (EIP-1193 4001).
    const userRejected = () => {
      const err = new Error('User rejected the request.') as Error & { code: number };
      err.code = 4001;
      return err;
    };
    const provider = {
      isQieWallet: true,
      isMetaMask: true,
      selectedAddress: address,
      chainId: `0x${currentChainId.toString(16)}`,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
        if (method === 'eth_chainId') return `0x${currentChainId.toString(16)}`;
        if (method === 'wallet_switchEthereumChain') {
          currentChainId = Number(BigInt((params?.[0] as any)?.chainId));
          provider.chainId = `0x${currentChainId.toString(16)}`;
          emit('chainChanged', provider.chainId);
          return null;
        }
        if (method === 'personal_sign' || method === 'eth_signTypedData_v4') {
          if (rejectSign) throw userRejected();
          return `0x${'1'.repeat(130)}`;
        }
        if (method === 'eth_sendTransaction') {
          if (rejectTx) throw userRejected();
          return txHash;
        }
        if (method === 'eth_getBalance') return '0xab54a98ceb1f0ad2';
        if (method === 'eth_blockNumber') return '0x12345';
        if (method === 'eth_estimateGas') return '0x5208';
        if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
        if (method === 'eth_getTransactionReceipt') return {
          transactionHash: txHash,
          blockHash: `0x${'8'.repeat(64)}`,
          blockNumber: '0x12346',
          contractAddress: null,
          cumulativeGasUsed: '0x5208',
          effectiveGasPrice: '0x3b9aca00',
          from: address,
          gasUsed: '0x5208',
          logs: [],
          logsBloom: `0x${'0'.repeat(512)}`,
          status: '0x1',
          to: '0x1111111111111111111111111111111111111111',
          transactionIndex: '0x0',
          type: '0x2',
        };
        return '0x';
      },
      on: (event: string, cb: (...args: any[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      },
      removeListener: (event: string, cb: (...args: any[]) => void) => {
        listeners.get(event)?.delete(cb);
      },
      off: (event: string, cb: (...args: any[]) => void) => {
        listeners.get(event)?.delete(cb);
      },
    };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
  }, {
    address: mockPayer,
    initialChainId: options.initialChainId ?? 1990,
    txHash: mockTxHash,
    rejectTx: options.rejectTx ?? false,
    rejectSign: options.rejectSign ?? false,
  });
  return { address: mockPayer };
}

/**
 * Simulate the QIE RPC being unreachable: every JSON-RPC call is aborted at the
 * network layer. Lets e2e assert the app degrades (NetworkStrip / retry) instead
 * of crashing or hanging silently.
 */
export async function installFailingQieRpc(page: Page) {
  await page.route('https://rpc1mainnet.qie.digital/**', async (route) => {
    await route.abort('failed');
  });
}

export async function installMockBackend(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  let paid = false;
  await page.route('**/v1/health', async (route) => route.fulfill({
    json: { ok: true, status: 'ok', db: 'ok', rpc: { ok: true, blockNumber: 0x12345 }, version: '1.0.0-rc.1' },
  }));
  await page.route('**/v1/status', async (route) => route.fulfill({
    json: { ok: true, status: 'ok', db: 'ok', rpc: { ok: true }, operational: { healthy: true, alerts: 0 } },
  }));
  await page.route('**/v1/rails', async (route) => route.fulfill({
    json: {
      ok: true,
      source: 'backend',
      network: { chainId: 1990, name: 'QIE Mainnet' },
      wallets: [{ id: 'injected', name: 'QIE Wallet', status: 'active' }],
      explorer: {
        baseUrl: 'https://mainnet.qie.digital',
        txUrlTemplate: 'https://mainnet.qie.digital/tx/{txHash}',
        addressUrlTemplate: 'https://mainnet.qie.digital/address/{address}',
      },
      rails: [{
        id: 'qie-native',
        chainId: 1990,
        chainName: 'QIE Mainnet',
        tokenSymbol: 'QIE',
        tokenAddress: zeroAddress,
        contractAddress: null,
        status: 'active',
        flows: [{ id: 'native_transfer', label: 'Native transfer', status: 'active' }],
      }],
    },
  }));
  // QIE lending RPC reads are slow against a live backend and get aborted on
  // navigation; stub them so e2e never flags a benign in-flight cancellation.
  await page.route('**/v1/qie/lending/status**', async (route) => route.fulfill({
    json: { ok: true, source: 'rpc', comptroller: zeroAddress, address: null, markets: [] },
  }));
  await page.route('**/v1/reconciliation/status', async (route) => route.fulfill({
    json: {
      source: 'sqlite',
      db: { status: 'ok' },
      invoices: { total: 1, open: paid ? 0 : 1, paid: paid ? 1 : 0 },
      receipts: { total: paid ? 1 : 0 },
      webhooks: { failedDeliveries: 0, dueRetries: 0 },
      chain: { indexedEvents: 0 },
    },
  }));
  await page.route('**/v1/invoices/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/v1/invoices/${mockInvoiceHash}/messages`) {
      if (request.method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: {
            guest_token: 'gst_mock_ci',
            message: {
              id: 'msg_mock',
              invoiceHash: mockInvoiceHash,
              senderRole: 'payer',
              body: 'Question from payer',
              createdAt: now,
            },
          },
        });
      }
      return route.fulfill({ json: { messages: [], count: 0 } });
    }
    if (pathname === `/v1/invoices/${mockInvoiceHash}/events`) {
      if (request.headers().accept?.includes('text/event-stream')) {
        return route.fulfill({ body: '', headers: { 'content-type': 'text/event-stream' } });
      }
      return route.fulfill({ json: { events: [], count: 0 } });
    }
    if (pathname === `/v1/invoices/${mockInvoiceHash}/verify-payment`) {
      paid = true;
      return route.fulfill({
        json: {
          invoice: {
            hash: mockInvoiceHash,
            merchant: mockMerchant,
            payer: mockPayer,
            token: zeroAddress,
            amount: '0.001',
            invoice_type: 0,
            status: 1,
            created_at: now,
            expires_at: now + 3600,
            paid_at: now,
            paid_tx_hash: mockTxHash,
            title: 'CI checkout',
            memo: 'Mock RPC checkout flow',
            metadata: {},
          },
        },
      });
    }
    if (pathname === `/v1/invoices/${mockInvoiceHash}`) {
      return route.fulfill({
        json: {
          hash: mockInvoiceHash,
          merchant: mockMerchant,
          payer: paid ? mockPayer : null,
          token: zeroAddress,
          amount: '0.001',
          invoice_type: 0,
          status: paid ? 1 : 0,
          created_at: now,
          expires_at: now + 3600,
          paid_at: paid ? now : undefined,
          paid_tx_hash: paid ? mockTxHash : undefined,
          title: 'CI checkout',
          memo: 'Mock RPC checkout flow',
          metadata: {},
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.route(`**/v1/payment-routes/${mockInvoiceHash}`, async (route) => route.fulfill({
    json: {
      invoiceHash: mockInvoiceHash,
      chainId: 1990,
      network: 'QIE Mainnet',
      state: 'ready',
      payable: true,
      token: { symbol: 'QIE', address: zeroAddress, decimals: 18 },
      amount: '0.001',
      merchant: mockMerchant,
      payer: null,
      expiresAt: now + 3600,
      recommendedRouteId: 'qie.direct_transfer',
      routes: [{
        id: 'qie.direct_transfer',
        rail: 'QIE',
        method: 'native-transfer',
        label: 'Native QIE direct transfer',
        state: 'ready',
        recommended: true,
        reason: 'Native QIE is ready',
        token: { symbol: 'QIE', address: zeroAddress, decimals: 18 },
        settlementContract: null,
        actions: [{ type: 'wallet_sendTransaction', label: 'Send QIE to merchant', target: mockMerchant, value: '0.001' }],
        verifyEndpoint: `/v1/invoices/${mockInvoiceHash}/verify-payment`,
        explorer: { txUrlTemplate: 'https://mainnet.qie.digital/tx/{txHash}' },
        source: 'backend_invoice_and_rail_catalog',
      }],
      dataSources: ['sqlite.invoice', 'backend.rails', 'qie.rpc.health'],
    },
  }));
  await page.route(`**/v1/merchants/public/${mockMerchant}`, async (route) => route.fulfill({
    json: {
      merchant: mockMerchant,
      displayName: 'Qantara CI Merchant',
      website: 'https://qantara.app',
      listed: true,
      trust: { walletVerified: true, telegramVerified: true, domainVerified: true, domain: 'qantara.app' },
    },
  }));
}
