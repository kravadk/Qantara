import { Router, type Request, type Response } from 'express';
import { generateNonce, verifySiwe, issueSession, verifySession } from '../lib/siwe.js';

const router = Router();

router.get('/nonce', (_req: Request, res: Response) => {
  const nonce = generateNonce();
  res.json({ nonce });
});

router.post('/verify', async (req: Request, res: Response) => {
  const message = String(req.body?.message ?? '');
  const signature = String(req.body?.signature ?? '');
  if (!message || !signature) {
    return res.status(400).json({ error: 'missing_message_or_signature' });
  }
  const result = await verifySiwe(message, signature);
  if (!result.ok || !result.address) {
    return res.status(401).json({ error: result.error ?? 'verify_failed' });
  }
  const token = await issueSession(result.address);
  res.json({ ok: true, token, address: result.address, chainId: result.chainId });
});

router.get('/me', async (req: Request, res: Response) => {
  const auth = req.header('Authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: 'no_token' });
  const address = await verifySession(m[1]);
  if (!address) return res.status(401).json({ error: 'invalid_token' });
  res.json({ ok: true, address });
});

export default router;
