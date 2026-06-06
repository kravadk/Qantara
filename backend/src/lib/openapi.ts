/**
 * Curated OpenAPI 3.1 description of the public Qantara API surface. Served at
 * GET /v1/openapi.json so developers can import it into Postman / Swagger / codegen.
 * Kept hand-authored (not auto-generated) to stay accurate and dependency-free.
 */
export function openApiSpec(version: string) {
  const bearer = [{ bearerAuth: [] as string[] }];
  const ok = { description: 'Success' };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Qantara API',
      version,
      description: 'Self-serve crypto payment links, invoices, webhooks, merchant trust, and analytics on QIE Mainnet (chain 1990).',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'SIWE session JWT or merchant API key' },
      },
    },
    paths: {
      '/v1/health': { get: { summary: 'Liveness + RPC/indexer status', responses: { '200': ok } } },
      '/v1/auth/nonce': { get: { summary: 'Get a SIWE nonce', responses: { '200': ok } } },
      '/v1/auth/verify': { post: { summary: 'Verify SIWE signature → session JWT', responses: { '200': ok } } },
      '/v1/api-keys': {
        get: { summary: 'List your API keys', security: bearer, responses: { '200': ok } },
        post: { summary: 'Self-issue an API key for your merchant', security: bearer, responses: { '201': { description: 'Created' } } },
      },
      '/v1/api-keys/{id}/revoke': { post: { summary: 'Revoke an API key', security: bearer, parameters: [pathParam('id')], responses: { '200': ok } } },
      '/v1/invoices': {
        get: { summary: 'List invoices (filter by merchant/payer/status)', responses: { '200': ok } },
        post: { summary: 'Mirror an on-chain invoice', security: bearer, responses: { '201': { description: 'Created' } } },
      },
      '/v1/invoices/{hash}': { get: { summary: 'Public invoice read', parameters: [pathParam('hash')], responses: { '200': ok, '404': { description: 'Not found' } } } },
      '/v1/invoices/{hash}/verify-payment': { post: { summary: 'Verify a payment tx via RPC', parameters: [pathParam('hash')], responses: { '200': ok } } },
      '/v1/invoices/{hash}/return': { get: { summary: 'Post-payment redirect to merchant success/cancel URL', parameters: [pathParam('hash'), queryParam('type', 'success|cancel')], responses: { '302': { description: 'Redirect' } } } },
      '/v1/payment-requirements/{hash}': { get: { summary: 'Signed payment requirement', parameters: [pathParam('hash')], responses: { '200': ok } } },
      '/v1/payment-routes/{hash}': { get: { summary: 'Backend payment route plan for an invoice', parameters: [pathParam('hash')], responses: { '200': ok } } },
      '/v1/rails': { get: { summary: 'Public payment rail catalog and deployment health', responses: { '200': ok } } },
      '/v1/rails/qusdc/capabilities': { get: { summary: 'RPC probe for QUSDC transfer, approve, permit, and EIP-3009 support', responses: { '200': ok } } },
      '/v1/qie/network-catalog': { get: { summary: 'QIE mainnet/testnet chain metadata, RPC candidates, explorers, and wallet add-network payloads', responses: { '200': ok } } },
      '/v1/qie/ecosystem': { get: { summary: 'QIE ecosystem links and availability states used by Qantara rails', responses: { '200': ok } } },
      '/v1/qie/lending/status': { get: { summary: 'Read-only QIE lending market status from RPC contract reads', parameters: [queryParam('address', 'Optional wallet address for portfolio reads')], responses: { '200': ok } } },
      '/v1/webhooks/secret': { get: { summary: 'Get your per-merchant webhook signing secret', security: bearer, responses: { '200': ok } } },
      '/v1/webhooks/secret/rotate': { post: { summary: 'Rotate your webhook signing secret', security: bearer, responses: { '200': ok } } },
      '/v1/webhooks/deliveries': { get: { summary: 'List persisted webhook deliveries', security: bearer, responses: { '200': ok } } },
      '/v1/webhooks/deliveries/{id}/retry': { post: { summary: 'Retry one failed webhook delivery', security: bearer, parameters: [pathParam('id')], responses: { '200': ok } } },
      '/v1/webhooks/test': { post: { summary: 'Dispatch a test webhook for an invoice', security: bearer, responses: { '200': ok } } },
      '/v1/invoices/{hash}/refund/request': { post: { summary: 'Payer requests a refund in the deal room', parameters: [pathParam('hash')], responses: { '202': ok } } },
      '/v1/invoices/{hash}/refund/approve': { post: { summary: 'Merchant records refund approval', security: bearer, parameters: [pathParam('hash')], responses: { '200': ok } } },
      '/v1/invoices/{hash}/refund/reject': { post: { summary: 'Merchant records refund rejection', security: bearer, parameters: [pathParam('hash')], responses: { '200': ok } } },
      '/v1/invoices/{hash}/dispute/open': { post: { summary: 'Payer opens a dispute in the deal room', parameters: [pathParam('hash')], responses: { '202': ok } } },
      '/v1/invoices/{hash}/dispute/resolve': { post: { summary: 'Merchant resolves a dispute', security: bearer, parameters: [pathParam('hash')], responses: { '200': ok } } },
      '/v1/invoices/{hash}/refund/verify-contract': { post: { summary: 'Verify an on-chain Qantara refund tx and mark refunded', security: bearer, parameters: [pathParam('hash')], responses: { '200': ok } } },
      '/v1/merchants/me': {
        get: { summary: 'Your merchant trust profile', security: bearer, responses: { '200': ok } },
        put: { summary: 'Update profile (name, website, public listing)', security: bearer, responses: { '200': ok } },
      },
      '/v1/merchants/me/domain/challenge': { post: { summary: 'Start domain verification', security: bearer, responses: { '200': ok } } },
      '/v1/merchants/me/domain/verify': { post: { summary: 'Verify the domain well-known token', security: bearer, responses: { '200': ok } } },
      '/v1/merchants/{address}': { get: { summary: 'Public merchant trust profile', parameters: [pathParam('address')], responses: { '200': ok } } },
      '/v1/billing/summary': { get: { summary: 'Invoice counts + paid volume by token', security: bearer, responses: { '200': ok } } },
      '/v1/billing/analytics': { get: { summary: 'Conversion, avg time-to-pay, webhook failure rate', security: bearer, responses: { '200': ok } } },
      '/v1/billing/receipts.csv': { get: { summary: 'Settlement receipts CSV export', security: bearer, responses: { '200': { description: 'CSV' } } } },
      '/v1/explorer/activity': { get: { summary: 'Public payment activity feed', responses: { '200': ok } } },
      '/v1/explorer/stats': { get: { summary: 'Public network stats (volume, merchants, receipts)', responses: { '200': ok } } },
      '/v1/explorer/merchants': { get: { summary: 'Public opted-in merchant directory', responses: { '200': ok } } },
      '/v1/telegram/merchant': {
        get: { summary: 'Your default Telegram chat', security: bearer, responses: { '200': ok } },
        put: { summary: 'Set your default Telegram chat', security: bearer, responses: { '200': ok } },
      },
    },
  };
}

function pathParam(name: string) {
  return { name, in: 'path', required: true, schema: { type: 'string' } };
}

function queryParam(name: string, description: string) {
  return { name, in: 'query', required: false, description, schema: { type: 'string' } };
}
