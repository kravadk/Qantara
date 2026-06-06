import * as store from './store.js';
import type { ApiKey } from './store.js';

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function configuredApiKey(): string | undefined {
  return optionalEnv('API_KEY');
}

export type ApiKeyIdentity =
  | {
      kind: 'operator';
      id: 'env:API_KEY';
      scopes: ['*'];
    }
  | {
      kind: 'stored';
      id: string;
      merchant?: ApiKey['merchant'];
      scopes: string[];
      key: ApiKey;
    };

export function validateConfiguredOrStoredApiKeyIdentity(secret: string, requiredScope?: string): ApiKeyIdentity | undefined {
  const envKey = configuredApiKey();
  if (envKey && secret === envKey) {
    return {
      kind: 'operator',
      id: 'env:API_KEY',
      scopes: ['*'],
    };
  }
  const key = store.validateApiKey(secret, requiredScope);
  if (!key) return undefined;
  return {
    kind: 'stored',
    id: key.id,
    merchant: key.merchant,
    scopes: key.scopes,
    key,
  };
}

export function validateConfiguredOrStoredApiKey(secret: string, requiredScope?: string): boolean {
  return !!validateConfiguredOrStoredApiKeyIdentity(secret, requiredScope);
}

export function apiKeyCanAccessMerchant(identity: ApiKeyIdentity, merchant: string): boolean {
  if (identity.kind === 'operator') return true;
  return !!identity.merchant && identity.merchant.toLowerCase() === merchant.toLowerCase();
}

export function apiKeyHasMerchantBoundary(identity: ApiKeyIdentity): boolean {
  return identity.kind === 'operator' || !!identity.merchant;
}
