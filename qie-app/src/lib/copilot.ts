import { QANTARA_BACKEND_URL } from './dealRoom';

export interface CopilotHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotResponse {
  ok: boolean;
  answer?: string;
  suggestedActions?: string[];
  model?: string;
  error?: string;
}

export async function askCopilot(opts: {
  question: string;
  invoiceHash?: string;
  history?: CopilotHistoryMessage[];
}): Promise<CopilotResponse> {
  try {
    const r = await fetch(`${QANTARA_BACKEND_URL}/v1/copilot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const j = (await r.json()) as CopilotResponse;
    if (!r.ok) return { ok: false, error: j.error ?? `http_${r.status}` };
    return j;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'fetch_failed' };
  }
}
