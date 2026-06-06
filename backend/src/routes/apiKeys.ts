import { Router, type Request, type Response } from 'express';
import type { Address } from 'viem';
import * as store from '../lib/store.js';
import { type AuthIdentity, validateBearerIdentity } from '../lib/authIdentity.js';

const router = Router();

type ApiKeyLocals = {
  apiKeyIdentity: AuthIdentity;
};

const ALLOWED_API_KEY_SCOPES = new Set([
  'api_keys:write',
  'invoices:read',
  'invoices:write',
  'webhooks:read',
  'webhooks:write',
  'notifications:read',
  'notifications:write',
  'receipts:read',
  'chain:read',
  'chain:sync',
  'ops:read',
  'ops:alerts',
  'telegram:write',
]);

function parseAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? value.toLowerCase() as Address
    : undefined;
}

function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function requireApiKey(req: Request, res: Response<any, ApiKeyLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'api_keys:write') : undefined;
  if (!identity) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.locals.apiKeyIdentity = identity;
  next();
}

function merchantScope(identity: AuthIdentity, requestedMerchant?: Address): Address | undefined | ResponsePayload {
  if (identity.kind === 'operator') return requestedMerchant;
  if (!identity.merchant) {
    return {
      status: 403,
      body: {
        error: 'merchant_boundary_required',
        message: 'Stored API keys without a merchant boundary cannot administer API keys',
      },
    };
  }
  if (requestedMerchant && !sameAddress(requestedMerchant, identity.merchant)) {
    return {
      status: 403,
      body: {
        error: 'merchant_scope_mismatch',
        message: 'Stored merchant API keys can only administer keys for their own merchant',
      },
    };
  }
  return identity.merchant;
}

type ResponsePayload = {
  status: number;
  body: Record<string, unknown>;
};

function isResponsePayload(value: unknown): value is ResponsePayload {
  return typeof value === 'object' && value !== null && 'status' in value && 'body' in value;
}

function publicApiKey(key: store.ApiKey) {
  return {
    id: key.id,
    name: key.name,
    merchant: key.merchant,
    scopes: key.scopes,
    prefix: key.prefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
  };
}

function requestedScopes(req: Request): string[] | undefined | ResponsePayload {
  if (req.body?.scopes === undefined) return undefined;
  if (!Array.isArray(req.body.scopes)) {
    return {
      status: 400,
      body: {
        error: 'invalid_scope',
        message: 'scopes must be a non-empty array of supported API key scopes',
      },
    };
  }
  const normalizedScopes: string[] = req.body.scopes
    .filter((scope: unknown): scope is string => typeof scope === 'string')
    .map((scope: string) => scope.trim())
    .filter((scope: string) => scope.length > 0);
  const scopes = Array.from(new Set<string>(normalizedScopes));
  if (scopes.length > 20) {
    return {
      status: 400,
      body: {
        error: 'invalid_scope',
        message: 'scopes cannot include more than 20 supported API key scopes',
      },
    };
  }
  return scopes;
}

function validateRequestedScopes(scopes: string[] | undefined | ResponsePayload): string[] | undefined | ResponsePayload {
  if (isResponsePayload(scopes) || scopes === undefined) return scopes;
  if (scopes.length === 0) {
    return {
      status: 400,
      body: {
        error: 'invalid_scope',
        message: 'scopes must include at least one supported API key scope',
      },
    };
  }
  const unsupported = scopes.filter((scope) => !ALLOWED_API_KEY_SCOPES.has(scope));
  if (unsupported.length > 0) {
    return {
      status: 400,
      body: {
        error: 'invalid_scope',
        message: `Unsupported API key scope: ${unsupported[0]}`,
      },
    };
  }
  return scopes;
}

function canGrantScopes(identity: AuthIdentity, scopes?: string[]): boolean {
  if (!scopes?.length || identity.kind === 'operator') return true;
  if (identity.scopes.includes('*')) return true;
  return scopes.every((scope) => identity.scopes.includes(scope));
}

router.get('/', requireApiKey, (req: Request, res: Response<any, ApiKeyLocals>) => {
  const merchant = parseAddress(req.query.merchant);
  const scopedMerchant = merchantScope(res.locals.apiKeyIdentity, merchant);
  if (isResponsePayload(scopedMerchant)) return res.status(scopedMerchant.status).json(scopedMerchant.body);
  const keys = store.listApiKeys({ merchant });
  const filteredKeys = res.locals.apiKeyIdentity.kind === 'operator'
    ? keys
    : store.listApiKeys({ merchant: scopedMerchant });
  res.json({ count: filteredKeys.length, keys: filteredKeys.map(publicApiKey) });
});

router.post('/', requireApiKey, (req: Request, res: Response<any, ApiKeyLocals>) => {
  const merchant = parseAddress(req.body?.merchant);
  const scopedMerchant = merchantScope(res.locals.apiKeyIdentity, merchant);
  if (isResponsePayload(scopedMerchant)) return res.status(scopedMerchant.status).json(scopedMerchant.body);
  const scopes = validateRequestedScopes(requestedScopes(req));
  if (isResponsePayload(scopes)) return res.status(scopes.status).json(scopes.body);
  if (!canGrantScopes(res.locals.apiKeyIdentity, scopes)) {
    return res.status(403).json({
      error: 'scope_escalation',
      message: 'Stored API keys can only create child keys with scopes they already hold',
    });
  }
  // When no scopes are requested by a non-operator (e.g. a wallet self-issuing
  // via SIWE), cap the minted key to the caller's own scopes rather than letting
  // store.createApiKey apply its broader default set (which includes telegram:write).
  // api_keys:write is dropped from the default so integration keys can't mint more keys.
  const identity = res.locals.apiKeyIdentity;
  const effectiveScopes =
    scopes ?? (identity.kind === 'operator'
      ? undefined
      : identity.scopes.filter((scope) => scope !== 'api_keys:write' && scope !== 'telegram:write' && scope !== '*'));
  const { apiKey, secret } = store.createApiKey({
    name: typeof req.body?.name === 'string' ? req.body.name : 'Merchant API key',
    merchant: scopedMerchant,
    scopes: effectiveScopes,
  });
  res.status(201).json({ key: publicApiKey(apiKey), secret });
});

router.post('/:id/revoke', requireApiKey, (req: Request, res: Response<any, ApiKeyLocals>) => {
  const existing = store.getApiKey(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const scopedMerchant = merchantScope(res.locals.apiKeyIdentity, existing.merchant);
  if (isResponsePayload(scopedMerchant)) return res.status(scopedMerchant.status).json(scopedMerchant.body);
  if (res.locals.apiKeyIdentity.kind !== 'operator' && (!existing.merchant || !sameAddress(existing.merchant, scopedMerchant!))) {
    return res.status(403).json({
      error: 'merchant_scope_mismatch',
      message: 'Stored merchant API keys can only revoke keys for their own merchant',
    });
  }
  const key = store.revokeApiKey(req.params.id)!;
  res.json({ ok: true, key: publicApiKey(key) });
});

export default router;
