import Anthropic from '@anthropic-ai/sdk';
import { optionalEnv } from './env.js';
import * as store from './store.js';

const MODEL = optionalEnv('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5-20251001';
const MAX_OUTPUT = Number(optionalEnv('COPILOT_MAX_TOKENS_OUTPUT') ?? '1000');

let _client: Anthropic | null = null;
function client(): Anthropic | null {
  if (_client) return _client;
  const key = optionalEnv('ANTHROPIC_API_KEY');
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

const SYSTEM_PROMPT = `You are the Qantara checkout copilot. Your job is to explain invoices, payments,
and wallet flows to users in plain language.

HARD CONSTRAINTS — break these and you fail:
- NEVER generate, suggest, or describe an Ethereum transaction the user should execute.
- NEVER reveal private keys, mnemonics, or signing requests.
- NEVER claim to know the current price of QIE — defer to the user's wallet display.
- If asked about something off-topic (politics, jokes, unrelated tech), redirect with one sentence.
- If asked "is this safe?", explain factors but conclude with: "Final check is on you — confirm the recipient address and amount in your wallet popup."
- Keep replies under 150 words unless the user explicitly asks for more detail.
- If you don't know, say so. Don't guess.

OUTPUT FORMAT:
- Plain markdown answer (no code blocks unless explaining EIP-2612 or similar).
- Then ONE line: "Suggested actions: <comma-separated short ui hints>" — only include if useful.
  Example actions: show_permit_explainer, show_gas_explainer, copy_address, show_token_info.
  These are UI breadcrumbs only — never executable.`;

export interface CopilotResult {
  answer: string;
  suggestedActions: string[];
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export async function askCopilot(
  invoiceHash: string | undefined,
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<CopilotResult> {
  const c = client();
  if (!c) {
    return {
      answer:
        'AI assistant is not configured on this server. Add `ANTHROPIC_API_KEY` to backend env to enable.',
      suggestedActions: [],
      model: 'unconfigured',
    };
  }

  let contextBlock = '';
  if (invoiceHash) {
    const inv = store.getInvoice(invoiceHash as `0x${string}`);
    if (inv) {
      contextBlock =
        `\n\nCURRENT INVOICE CONTEXT (do not reveal raw JSON to the user; summarize):\n` +
        JSON.stringify(
          {
            hash: inv.hash,
            merchant: inv.merchant,
            amount: inv.amount,
            token: inv.token,
            status: inv.status,
            title: inv.title,
            memo: inv.memo,
            expiresAt: inv.expiresAt,
          },
          null,
          2,
        );
    }
  }

  const msgs: Anthropic.MessageParam[] = [
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question + contextBlock },
  ];

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT,
    system: SYSTEM_PROMPT,
    messages: msgs,
  });

  const text = resp.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  let answer = text;
  let actions: string[] = [];
  const m = text.match(/Suggested actions:\s*(.+)$/im);
  if (m) {
    actions = m[1]
      .split(/,/)
      .map((s) => s.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
      .slice(0, 6);
    answer = text.replace(m[0], '').trim();
  }

  return {
    answer,
    suggestedActions: actions,
    model: MODEL,
    tokensIn: resp.usage?.input_tokens,
    tokensOut: resp.usage?.output_tokens,
  };
}
