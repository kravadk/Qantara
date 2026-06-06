import { Router, type Request, type Response } from 'express';
import { askCopilot } from '../lib/copilotLLM.js';
import { optionalEnv } from '../lib/env.js';

const router = Router();

// Process-level leaky bucket per-IP rate limit.
const RATE = Number(optionalEnv('COPILOT_RATE_LIMIT_PER_MIN') ?? '10');
const buckets = new Map<string, number[]>();

function allow(ip: string): boolean {
  const now = Date.now();
  const arr = (buckets.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= RATE) return false;
  arr.push(now);
  buckets.set(ip, arr);
  return true;
}

router.post('/', async (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown';
  if (!allow(ip)) return res.status(429).json({ error: 'rate_limit' });

  const body = req.body ?? {};
  const question = String(body.question ?? '').slice(0, 1000);
  if (!question.trim()) return res.status(400).json({ error: 'empty_question' });

  const invoiceHash = body.invoiceHash ? String(body.invoiceHash) : undefined;
  const history = Array.isArray(body.history)
    ? body.history
        .slice(-6)
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
    : [];

  try {
    const result = await askCopilot(invoiceHash, question, history);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: 'copilot_failed', message: String(e?.message ?? e).slice(0, 200) });
  }
});

export default router;
