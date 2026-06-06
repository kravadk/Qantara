import { Router, type Request, type Response } from 'express';
import type { Address } from 'viem';
import * as store from '../lib/store.js';
import { type AuthIdentity, validateBearerIdentity } from '../lib/authIdentity.js';
import { optionalEnv } from '../lib/env.js';
import { qieNetworkCatalog } from '../lib/qieEcosystem.js';

const router = Router();
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ORIGIN_RE = /^https?:\/\/[^\s/]+$/i;

type MerchantLocals = { identity: AuthIdentity };

async function requireMerchant(req: Request, res: Response<any, MerchantLocals>, next: () => void) {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  const identity = m ? await validateBearerIdentity(m[1], 'invoices:read') : undefined;
  if (!identity) return res.status(401).json({ error: 'unauthorized' });
  res.locals.identity = identity;
  next();
}

function callerMerchant(res: Response<any, MerchantLocals>): Address | undefined {
  const id = res.locals.identity;
  return id.kind === 'stored' || id.kind === 'session' ? id.merchant : undefined;
}

/** Public trust view of a profile: which signals are verified. URL stays merchant-controlled. */
function trustView(profile: store.MerchantProfile | undefined, merchant: Address) {
  const telegram = store.getMerchantTelegramChat(merchant);
  const network = qieNetworkCatalog().networks.find((item) => item.key === 'qie-mainnet')!;
  const recentPaidCount = store.countMerchantPaid(merchant);
  const passVerificationUrl = optionalEnv('QIE_PASS_VERIFICATION_URL') ?? null;
  return {
    merchant,
    displayName: profile?.displayName ?? null,
    website: profile?.website ?? null,
    listed: !!profile?.publicListed,
    recentPaid: recentPaidCount,
    recentPaidCount,
    explorerUrl: network.explorer.addressUrlTemplate.replace('{address}', merchant),
    trust: {
      walletVerified: !!profile?.walletVerified,
      telegramVerified: !!telegram,
      telegramLinked: !!telegram,
      domainVerified: !!profile?.domainVerifiedAt,
      domain: profile?.domainVerifiedAt ? profile?.domain ?? null : null,
      pass: {
        configured: !!passVerificationUrl,
        verified: false,
        status: passVerificationUrl ? 'verification_endpoint_configured' : 'not_configured',
        verificationUrl: passVerificationUrl,
      },
    },
  };
}

// --- Self-serve merchant profile ---

router.get('/me', requireMerchant, (_req: Request, res: Response<any, MerchantLocals>) => {
  const merchant = callerMerchant(res);
  if (!merchant) return res.status(403).json({ error: 'merchant_boundary_required' });
  res.json(trustView(store.getMerchantProfile(merchant), merchant));
});

router.put('/me', requireMerchant, (req: Request, res: Response<any, MerchantLocals>) => {
  const merchant = callerMerchant(res);
  if (!merchant) return res.status(403).json({ error: 'merchant_boundary_required' });
  const body = req.body ?? {};
  if (body.website !== undefined && body.website !== null && body.website !== '' && !ORIGIN_RE.test(String(body.website))) {
    return res.status(400).json({ error: 'bad_request', message: 'website must be an http(s) origin' });
  }
  store.upsertMerchantProfile(merchant, {
    displayName: typeof body.display_name === 'string' ? body.display_name.slice(0, 80) : undefined,
    website: typeof body.website === 'string' ? body.website : undefined,
    publicListed: typeof body.public_listed === 'boolean' ? body.public_listed : undefined,
    // A SIWE session proves wallet ownership; record it as a verified trust signal.
    walletVerified: res.locals.identity.kind === 'session' ? true : undefined,
  });
  res.json(trustView(store.getMerchantProfile(merchant), merchant));
});

// --- Domain verification (place token at https://<domain>/.well-known/qantara.txt) ---

router.post('/me/domain/challenge', requireMerchant, (req: Request, res: Response<any, MerchantLocals>) => {
  const merchant = callerMerchant(res);
  if (!merchant) return res.status(403).json({ error: 'merchant_boundary_required' });
  const domain = typeof req.body?.domain === 'string' ? req.body.domain.trim() : '';
  if (!ORIGIN_RE.test(domain)) {
    return res.status(400).json({ error: 'bad_request', message: 'domain must be a full http(s) origin' });
  }
  const profile = store.setMerchantDomainChallenge(merchant, domain);
  res.json({
    domain: profile.domain,
    token: profile.domainToken,
    instructions: `Serve the token at ${domain}/.well-known/qantara.txt then call POST /v1/merchants/me/domain/verify`,
  });
});

router.post('/me/domain/verify', requireMerchant, async (req: Request, res: Response<any, MerchantLocals>) => {
  const merchant = callerMerchant(res);
  if (!merchant) return res.status(403).json({ error: 'merchant_boundary_required' });
  const profile = store.getMerchantProfile(merchant);
  if (!profile?.domain || !profile.domainToken) {
    return res.status(409).json({ error: 'no_challenge', message: 'Request a domain challenge first' });
  }
  const url = `${profile.domain.replace(/\/$/, '')}/.well-known/qantara.txt`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return res.status(422).json({ error: 'fetch_failed', message: `HTTP ${r.status} fetching ${url}` });
    const text = (await r.text()).trim();
    if (!text.includes(profile.domainToken)) {
      return res.status(422).json({ error: 'token_mismatch', message: 'Challenge token not found at the well-known URL' });
    }
    const verified = store.markMerchantDomainVerified(merchant);
    res.json(trustView(verified, merchant));
  } catch (err: any) {
    res.status(422).json({ error: 'fetch_failed', message: err?.message ?? 'Could not fetch the well-known URL' });
  }
});

// --- Public trust profile ---

router.get('/:address', (req: Request, res: Response) => {
  const address = req.params.address;
  if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: 'bad_request', message: 'invalid address' });
  const merchant = address.toLowerCase() as Address;
  res.json(trustView(store.getMerchantProfile(merchant), merchant));
});

export default router;
