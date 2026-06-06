import {
  apiKeyCanAccessMerchant,
  apiKeyHasMerchantBoundary,
  type ApiKeyIdentity,
  validateConfiguredOrStoredApiKeyIdentity,
} from './env.js';
import { verifySession } from './siwe.js';

const sessionScopes = new Set([
  'ops:read',
  'notifications:read',
  'notifications:write',
  'receipts:read',
  'webhooks:read',
  'webhooks:write',
  'chain:read',
  'invoices:read',
  'invoices:write',
  // Self-serve Telegram: a wallet-authenticated merchant can link its own chat.
  // Note: api-keys self-issue still drops this from the minted default (integration
  // keys do not need Telegram); merchants may request it explicitly if needed.
  'telegram:write',
  // Self-serve onboarding: a wallet-authenticated merchant may mint long-lived
  // API keys for its own address (SDK / server-to-server). merchantScope in the
  // api-keys route binds every minted key to the session's own merchant, and
  // canGrantScopes caps the minted scopes to this set (no chain:sync / ops:alerts).
  'api_keys:write',
]);

export type SessionIdentity = {
  kind: 'session';
  id: 'siwe:session';
  merchant: `0x${string}`;
  scopes: string[];
};

export type AuthIdentity = ApiKeyIdentity | SessionIdentity;

export async function validateBearerIdentity(secret: string, requiredScope?: string): Promise<AuthIdentity | undefined> {
  const apiKeyIdentity = validateConfiguredOrStoredApiKeyIdentity(secret, requiredScope);
  if (apiKeyIdentity) return apiKeyIdentity;

  if (requiredScope && !sessionScopes.has(requiredScope)) return undefined;
  const address = await verifySession(secret);
  if (!address) return undefined;

  return {
    kind: 'session',
    id: 'siwe:session',
    merchant: address,
    scopes: Array.from(sessionScopes),
  };
}

export function identityCanAccessMerchant(identity: AuthIdentity, merchant: string): boolean {
  if (identity.kind === 'session') {
    return identity.merchant.toLowerCase() === merchant.toLowerCase();
  }
  return apiKeyCanAccessMerchant(identity, merchant);
}

export function identityHasMerchantBoundary(identity: AuthIdentity): boolean {
  if (identity.kind === 'session') return true;
  return apiKeyHasMerchantBoundary(identity);
}
