import { Router, type Request, type Response } from 'express';
import { resolveUsername } from '../lib/usernameResolver.js';

const router = Router();

const cache = new Map<string, { at: number; value: any }>();
const CACHE_TTL_MS = 5 * 60_000;

router.get('/', async (req: Request, res: Response) => {
  const q = (req.query.q || '').toString();
  if (!q || q.length > 64) {
    return res.status(400).json({ error: 'invalid_query' });
  }
  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.value);
  }
  try {
    const result = await resolveUsername(q);
    const payload = result ? { ok: true, result } : { ok: false, error: 'not_found' };
    cache.set(q, { at: Date.now(), value: payload });
    return res.json(payload);
  } catch (e: any) {
    return res.status(500).json({ error: 'resolver_failed', message: e?.message?.slice(0, 200) });
  }
});

export default router;
