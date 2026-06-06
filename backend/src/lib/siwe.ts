import { randomBytes } from 'node:crypto';
import { SiweMessage } from 'siwe';
import { SignJWT, jwtVerify } from 'jose';
import type { Address } from 'viem';
import { optionalEnv } from './env.js';
import { saveNonce, consumeNonce } from './store.js';

const configuredJwtSecret = optionalEnv('SIWE_JWT_SECRET');
if (!configuredJwtSecret && process.env.NODE_ENV === 'production') {
  throw new Error('SIWE_JWT_SECRET is required in production');
}
const JWT_SECRET = new TextEncoder().encode(configuredJwtSecret ?? randomBytes(32).toString('hex'));
const SESSION_TTL_HOURS = Number(optionalEnv('SIWE_SESSION_TTL_HOURS') ?? '24');
const JWT_ISSUER = 'qantara';
const LEGACY_JWT_ISSUERS = ['qie-qantara'];

export function generateNonce(): string {
  const nonce = randomBytes(16).toString('hex');
  saveNonce(nonce);
  return nonce;
}

export interface SiweVerifyResult {
  ok: boolean;
  address?: Address;
  chainId?: number;
  error?: string;
}

export async function verifySiwe(
  rawMessage: string,
  signature: string,
): Promise<SiweVerifyResult> {
  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(rawMessage);
  } catch (e: any) {
    return { ok: false, error: `bad_message:${e?.message?.slice(0, 80) ?? 'parse'}` };
  }

  try {
    const result = await siwe.verify({ signature });
    if (!result.success) {
      return { ok: false, error: result.error?.type ?? 'verify_failed' };
    }
    if (!consumeNonce(siwe.nonce)) {
      return { ok: false, error: 'unknown_or_expired_nonce' };
    }
    return { ok: true, address: result.data.address as Address, chainId: result.data.chainId };
  } catch (e: any) {
    return { ok: false, error: e?.message?.slice(0, 80) ?? 'verify_threw' };
  }
}

export async function issueSession(address: Address): Promise<string> {
  return await new SignJWT({ address: address.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setSubject(address.toLowerCase())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(JWT_SECRET);
}

export async function verifySession(token: string): Promise<Address | null> {
  for (const issuer of [JWT_ISSUER, ...LEGACY_JWT_ISSUERS]) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, { issuer });
      if (typeof payload.sub === 'string' && payload.sub.startsWith('0x')) {
        return payload.sub as Address;
      }
    } catch {
      // Try the next accepted issuer.
    }
  }
  return null;
}
