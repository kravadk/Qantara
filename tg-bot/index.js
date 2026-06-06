/**
 * Qantara Telegram bot.
 *
 * Merchant links a production invoice to Telegram.
 * Payer pays on /pay/:hash -> signed backend webhook -> bot notifies merchant.
 */

import 'dotenv/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Telegraf } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN;
const BACKEND_URL = process.env.QANTARA_BACKEND_URL?.replace(/\/$/, '');
const FRONTEND_URL = process.env.QANTARA_BASE_URL?.replace(/\/$/, '');
const API_KEY = process.env.QANTARA_API_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const ALERT_WEBHOOK_SECRET = process.env.ALERT_WEBHOOK_SECRET;
const ALERT_CHAT_ID = process.env.ALERT_CHAT_ID;
const BOT_WEBHOOK_PORT = Number(process.env.BOT_WEBHOOK_PORT || 0);
const BOT_WEBHOOK_MAX_BODY_BYTES = Number(process.env.BOT_WEBHOOK_MAX_BODY_BYTES || 262144);
const MAX_TELEGRAM_MESSAGE_CHARS = 3500;
const MAX_DISPLAY_FIELD_CHARS = 240;

if (!BOT_TOKEN) {
  console.error('[qie-tg-bot] Missing BOT_TOKEN - get one from @BotFather and set it in .env');
  process.exit(1);
}
if (!API_KEY) {
  console.error('[qie-tg-bot] Missing QANTARA_API_KEY');
  process.exit(1);
}
for (const [name, value] of Object.entries({ QANTARA_BACKEND_URL: BACKEND_URL, QANTARA_BASE_URL: FRONTEND_URL })) {
  if (!value) {
    console.error(`[qie-tg-bot] Missing ${name}`);
    process.exit(1);
  }
}
for (const [name, value] of Object.entries({ QANTARA_BACKEND_URL: BACKEND_URL, QANTARA_BASE_URL: FRONTEND_URL })) {
  try {
    new URL(value);
  } catch {
    console.error(`[qie-tg-bot] ${name} must be an absolute URL`);
    process.exit(1);
  }
}
if (BOT_WEBHOOK_PORT && !WEBHOOK_SECRET) {
  console.error('[qie-tg-bot] Missing WEBHOOK_SECRET for webhook verification');
  process.exit(1);
}
if (BOT_WEBHOOK_PORT && ALERT_CHAT_ID && !ALERT_WEBHOOK_SECRET) {
  console.error('[qie-tg-bot] Missing ALERT_WEBHOOK_SECRET for operational alert verification');
  process.exit(1);
}
if (BOT_WEBHOOK_PORT && (!Number.isFinite(BOT_WEBHOOK_MAX_BODY_BYTES) || BOT_WEBHOOK_MAX_BODY_BYTES < 1024)) {
  console.error('[qie-tg-bot] BOT_WEBHOOK_MAX_BODY_BYTES must be at least 1024');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

class BackendError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.code = code;
  }
}

function isInvoiceHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim());
}

function requireInvoiceHash(value) {
  const hash = String(value || '').trim();
  if (!isInvoiceHash(hash)) {
    throw new Error('Use the full invoice hash: 0x followed by 64 hex characters.');
  }
  return hash;
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function safeText(value, max = MAX_DISPLAY_FIELD_CHARS) {
  const normalized = String(value ?? '-')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || '-').slice(0, max);
}

function safeMarkdown(value, max = MAX_DISPLAY_FIELD_CHARS) {
  return escapeMarkdown(safeText(value, max));
}

function safeTelegramMessage(value) {
  const normalized = String(value ?? '-')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
  return (normalized || '-').slice(0, MAX_TELEGRAM_MESSAGE_CHARS);
}

function commandError(prefix, err) {
  if (err instanceof BackendError) {
    if (err.status === 401) {
      return `${prefix}: backend rejected the bot API key. Check QANTARA_API_KEY and required scopes: telegram:write, invoices:read, invoices:write.`;
    }
    if (err.status === 403) {
      return `${prefix}: this API key is not allowed for that merchant invoice. Use the operator key or a merchant-scoped key for the invoice merchant.`;
    }
    if (err.status === 404) {
      return `${prefix}: invoice or Telegram link was not found. Confirm the hash and link it from the intended merchant chat.`;
    }
    if (err.status === 429) {
      return `${prefix}: backend rate limit reached. Wait briefly and retry.`;
    }
    if (err.status >= 500) {
      return `${prefix}: backend is unavailable. Check /v1/health, /v1/metrics, RPC, and database status.`;
    }
  }
  return `${prefix}: ${safeTelegramMessage(err?.message || 'request failed')}`;
}

async function replyCommandError(ctx, prefix, err) {
  await ctx.reply(commandError(prefix, err));
}

async function backendFetch(path, options = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new BackendError(body.message || body.error || `Backend HTTP ${res.status}`, res.status, body.error);
  }
  return body;
}

async function getBackendStatus(hashOrSessionId) {
  return backendFetch(`/v1/checkout/sessions/${encodeURIComponent(hashOrSessionId)}`);
}

async function getBackendHealth() {
  return backendFetch('/v1/health');
}

async function getInvoiceMessages(hash) {
  return backendFetch(`/v1/invoices/${encodeURIComponent(hash)}/messages`);
}

async function postMerchantMessage(hash, body, senderLabel = 'Telegram merchant') {
  return backendFetch(`/v1/invoices/${encodeURIComponent(hash)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      sender_role: 'merchant',
      sender_label: senderLabel,
      body,
    }),
  });
}

function payUrl(hash) {
  return `${FRONTEND_URL}/pay/${hash}`;
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

async function getTelegramLink(hash) {
  const body = await backendFetch(`/v1/telegram/links/${encodeURIComponent(hash)}`);
  return body.link;
}

async function saveTelegramLinkForChat(ctx, hash) {
  const body = await backendFetch('/v1/telegram/links', {
    method: 'POST',
    body: JSON.stringify({
      invoice_hash: hash,
      chat_id: String(ctx.chat.id),
      creator_id: ctx.from?.id === undefined ? undefined : String(ctx.from.id),
    }),
  });
  return body.link;
}

async function getLinkedInvoiceForChat(ctx, hash, options = {}) {
  const invoiceHash = requireInvoiceHash(hash);
  let link;
  try {
    link = await getTelegramLink(invoiceHash);
  } catch (err) {
    if (err instanceof BackendError && err.status === 404 && options.createIfMissing) {
      link = await saveTelegramLinkForChat(ctx, invoiceHash);
    } else if (err instanceof BackendError && err.status === 404) {
      throw new Error('This invoice is not linked to this Telegram chat yet.');
    } else if (err instanceof BackendError && err.status === 403) {
      throw new Error('This bot API key is not allowed to access that merchant invoice.');
    } else {
      throw err;
    }
  }
  if (String(link.chatId) !== String(ctx.chat.id)) {
    if (options.createIfMissing && options.relinkSameInvoice) {
      link = await saveTelegramLinkForChat(ctx, invoiceHash);
    } else {
      throw new Error('This invoice is linked to a different Telegram chat.');
    }
  }
  return { invoiceHash, link };
}

async function listTelegramLinks(chatId, limit = 5) {
  const body = await backendFetch(`/v1/telegram/links?chat_id=${encodeURIComponent(String(chatId))}&limit=${limit}`);
  return body.links || [];
}

bot.start((ctx) => {
  ctx.reply(
    `*Qantara Bot*\n\n` +
      `Link wallet-created Qantara invoices to Telegram and manage deal-room replies from chat.\n\n` +
      `*Commands:*\n` +
      `/invoice - creation now starts from the wallet app\n` +
      `/status <hash> - check invoice status\n` +
      `/link <hash> - get payment link\n` +
      `/cancel <hash> - verified cancel guidance\n` +
      `/chat <hash> - show invoice chat\n` +
      `/reply <hash> <message> - reply to payer\n` +
      `/notify_test - test backend and bot setup\n` +
      `/list - show last 5 invoices in this chat\n\n` +
      `Create invoices from the Qantara app so the backend can mirror a real on-chain create transaction, then use /link, /chat, and /reply here.`,
    { parse_mode: 'Markdown' },
  );
});

bot.help((ctx) => ctx.reply('Use /start for commands and examples.'));

bot.command('invoice', async (ctx) => {
  await ctx.reply(
    `Invoice creation starts in the Qantara app because production invoices must be created on-chain first.\n\n` +
      `After the invoice is linked to this chat, use:\n` +
      `/link <invoice_hash>\n` +
      `/chat <invoice_hash>\n` +
      `/reply <invoice_hash> <message>`,
    { parse_mode: 'Markdown' },
  );
});

bot.command('status', async (ctx) => {
  const id = ctx.message.text.replace(/^\/status(@\w+)?\s*/, '').trim();
  if (!id) return ctx.reply('Usage: `/status <invoice_hash>`', { parse_mode: 'Markdown' });

  try {
    const { invoiceHash } = await getLinkedInvoiceForChat(ctx, id);
    const s = await getBackendStatus(invoiceHash);
    await ctx.reply(
      `*Invoice status*\n\n` +
        `Hash: \`${shortHash(s.invoice_hash)}\`\n` +
        `Status: *${safeMarkdown(s.status)}*\n` +
        `Amount: ${safeMarkdown(s.amount)}\n` +
        `Token: ${safeMarkdown(s.token || '-')}\n` +
        `Payer: ${safeMarkdown(s.payer || '-')}\n` +
        `Tx: ${safeMarkdown(s.tx_hash || '-')}`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await replyCommandError(ctx, 'Status lookup failed', err);
  }
});

bot.command('link', async (ctx) => {
  const hash = ctx.message.text.replace(/^\/link(@\w+)?\s*/, '').trim();
  if (!hash) return ctx.reply('Usage: `/link <invoice_hash>`', { parse_mode: 'Markdown' });

  try {
    const { invoiceHash } = await getLinkedInvoiceForChat(ctx, hash, { createIfMissing: true });
    const s = await getBackendStatus(invoiceHash);
    await ctx.reply(
      `Payment link\n\n` +
        `[Open invoice](${payUrl(s.invoice_hash)})\n` +
        `Hash: \`${shortHash(s.invoice_hash)}\`\n` +
        `Status: *${safeMarkdown(s.status)}*`,
      { parse_mode: 'Markdown', disable_web_page_preview: true },
    );
  } catch (err) {
    await replyCommandError(ctx, 'Link lookup failed', err);
  }
});

bot.command('notify_test', async (ctx) => {
  try {
    const health = await getBackendHealth();
    const linked = await listTelegramLinks(ctx.chat.id, 1);
    await ctx.reply(
      `Notification setup test\n\n` +
        `Backend: *${health.ok ? 'online' : 'unavailable'}*\n` +
        `DB: *${safeMarkdown(health.db || 'unknown')}*\n` +
        `RPC: *${safeMarkdown(health.rpc?.url || 'unknown')}*\n` +
        `Telegram link API: *accepted* (${linked.length} visible in this chat)\n` +
        `Webhook receiver: *${BOT_WEBHOOK_PORT ? 'enabled' : 'not enabled'}*\n` +
        `Alert receiver: *${BOT_WEBHOOK_PORT && ALERT_CHAT_ID ? 'enabled' : 'not enabled'}*`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await replyCommandError(ctx, 'Setup test failed', err);
  }
});

bot.command('cancel', async (ctx) => {
  const id = ctx.message.text.replace(/^\/cancel(@\w+)?\s*/, '').trim();
  if (!id) return ctx.reply('Usage: `/cancel <invoice_hash>`', { parse_mode: 'Markdown' });

  try {
    const { invoiceHash } = await getLinkedInvoiceForChat(ctx, id);
    const s = await getBackendStatus(invoiceHash);
    await ctx.reply(
      `Verified lifecycle required\n\n` +
        `Hash: \`${shortHash(s.invoice_hash)}\`\n` +
        `Current status: *${safeMarkdown(s.status)}*\n\n` +
        `Cancel from the Qantara app with the merchant wallet. After the wallet transaction confirms, the backend mirrors the state through /v1/invoices/:hash/cancel/verify.`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await replyCommandError(ctx, 'Cancel guidance failed', err);
  }
});

bot.command('list', async (ctx) => {
  try {
    const links = await listTelegramLinks(ctx.chat.id, 5);
    if (links.length === 0) {
      return ctx.reply('No invoices are linked to this chat yet. Create an invoice in the app, then send `/link <invoice_hash>` here.', { parse_mode: 'Markdown' });
    }

    const lines = await Promise.all(links.map(async (link) => {
      try {
        const s = await getBackendStatus(link.invoiceHash);
        return `- *${safeMarkdown(s.amount)} ${safeMarkdown(s.token)}* - ${safeMarkdown(s.status)} - [open](${payUrl(link.invoiceHash)}) - \`${shortHash(link.invoiceHash)}\``;
      } catch {
        return `- lookup failed - \`${shortHash(link.invoiceHash)}\``;
      }
    }));

    await ctx.reply(`*Recent invoices (${links.length}):*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    await replyCommandError(ctx, 'Invoice list failed', err);
  }
});

bot.command('chat', async (ctx) => {
  const hash = ctx.message.text.replace(/^\/chat(@\w+)?\s*/, '').trim();
  if (!hash) return ctx.reply('Usage: `/chat <invoice_hash>`', { parse_mode: 'Markdown' });

  try {
    const { invoiceHash } = await getLinkedInvoiceForChat(ctx, hash);
    const body = await getInvoiceMessages(invoiceHash);
    const messages = (body.messages || []).slice(-8);
    if (messages.length === 0) {
      return ctx.reply(`No messages yet for \`${shortHash(invoiceHash)}\``, { parse_mode: 'Markdown' });
    }
    const lines = messages.map((m) => {
      const who = safeText(m.senderLabel || m.senderRole, 80);
      return `${who}: ${safeText(m.body || '', 240)}`;
    });
    await ctx.reply(safeTelegramMessage(`Chat ${shortHash(hash)}\n\n${lines.join('\n')}`));
  } catch (err) {
    await replyCommandError(ctx, 'Chat lookup failed', err);
  }
});

bot.command('reply', async (ctx) => {
  const text = ctx.message.text.replace(/^\/reply(@\w+)?\s*/, '').trim();
  const [hash, ...messageParts] = text.split(/\s+/);
  const message = messageParts.join(' ').trim();
  if (!hash || !message) {
    return ctx.reply('Usage: `/reply <invoice_hash> <message>`', { parse_mode: 'Markdown' });
  }

  try {
    const { invoiceHash } = await getLinkedInvoiceForChat(ctx, hash);
    await postMerchantMessage(invoiceHash, message, ctx.from?.username ? `@${ctx.from.username}` : 'Telegram merchant');
    await ctx.reply(`Reply sent to ${shortHash(invoiceHash)}.`);
  } catch (err) {
    await replyCommandError(ctx, 'Reply failed', err);
  }
});

bot.on('inline_query', async (ctx) => {
  try {
    await ctx.answerInlineQuery([], {
      cache_time: 1,
      switch_pm_text: 'Create invoices from the Qantara app',
      switch_pm_parameter: 'invoice-help',
    });
  } catch (err) {
    console.error('[inline invoice] failed:', err.message);
    await ctx.answerInlineQuery([], { cache_time: 1 });
  }
});

function verifyPayloadSignature(rawBody, headers, secret) {
  if (!secret) return false;
  const timestamp = Number(headers['x-qantara-timestamp']);
  const signature = String(headers['x-qantara-signature'] || '');
  if (!timestamp || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyWebhookSignature(rawBody, headers) {
  return verifyPayloadSignature(rawBody, headers, WEBHOOK_SECRET);
}

function verifyAlertSignature(rawBody, headers) {
  return verifyPayloadSignature(rawBody, headers, ALERT_WEBHOOK_SECRET);
}

async function handleOperationalAlert(raw, headers, res) {
  if (!ALERT_CHAT_ID) {
    res.writeHead(503).end('alert_chat_not_configured');
    return;
  }
  if (!verifyAlertSignature(raw, headers)) {
    res.writeHead(401).end('bad_signature');
    return;
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    res.writeHead(400).end('bad_json');
    return;
  }
  if (event?.type !== 'operational.alert') {
    res.writeHead(400).end('bad_event_type');
    return;
  }

  const alert = event?.data?.alert || {};
  const severity = safeText(alert.severity || 'unknown', 40).toUpperCase();
  const id = safeText(alert.id || 'operational.alert', 120);
  const message = safeText(alert.message || 'Operational alert received', 600);
  const value = alert.value === undefined ? '' : `\nValue: ${safeText(alert.value, 120)}`;
  const threshold = alert.threshold === undefined ? '' : `\nThreshold: ${safeText(alert.threshold, 120)}`;
  await bot.telegram.sendMessage(
    ALERT_CHAT_ID,
    `Qantara ${severity} alert\n${id}\n\n${message}${value}${threshold}`,
  );
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
}

async function handlePaymentWebhook(raw, headers, res) {
  if (!verifyWebhookSignature(raw, headers)) {
    res.writeHead(401).end('bad_signature');
    return;
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    res.writeHead(400).end('bad_json');
    return;
  }

  if (!['invoice.paid', 'message.created', 'receipt.created'].includes(event?.type)) {
    res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ignored: true }));
    return;
  }

  const hash = event?.data?.invoice_hash;
  if (!isInvoiceHash(hash)) {
    res.writeHead(400).end('bad_invoice_hash');
    return;
  }

  const link = await getTelegramLink(hash).catch((err) => {
    if (!(err instanceof BackendError && err.status === 404)) {
      console.error('[payment webhook] link lookup failed:', err.message);
    }
    return null;
  });
  if (!link) {
    res.writeHead(202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, linked: false }));
    return;
  }

  if (event.type === 'invoice.paid') {
    await bot.telegram.sendMessage(
      link.chatId,
      safeTelegramMessage(`Payment received: ${safeText(event.data.amount, 80)} ${safeText(event.data.token || '', 40)} from ${safeText(event.data.payer || 'unknown', 80)}\n${payUrl(hash)}`),
    );
  }
  if (event.type === 'message.created') {
    await bot.telegram.sendMessage(
      link.chatId,
      safeTelegramMessage(`New payer message on ${shortHash(hash)}\n\n${safeText(event.data.sender_label || 'Payer', 80)}: ${safeText(event.data.message_preview || '', 240)}\n\nReply:\n/reply ${hash} <message>`),
    );
  }
  if (event.type === 'receipt.created') {
    await bot.telegram.sendMessage(
      link.chatId,
      safeTelegramMessage(`Receipt ready for ${shortHash(hash)}\n${payUrl(hash)}`),
    );
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
}

function startPaymentWebhookServer() {
  if (!BOT_WEBHOOK_PORT) return;

  const server = createServer((req, res) => {
    const url = req.url || '';
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: true,
        receiver: 'qantara-telegram',
        qantaraWebhook: Boolean(WEBHOOK_SECRET),
        alerts: Boolean(ALERT_CHAT_ID && ALERT_WEBHOOK_SECRET),
      }));
      return;
    }
    if (req.method !== 'POST' || (url !== '/webhooks/qantara' && url !== '/webhooks/alerts')) {
      res.writeHead(404).end('not_found');
      return;
    }

    let raw = '';
    let bytes = 0;
    let rejected = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > BOT_WEBHOOK_MAX_BODY_BYTES) {
        rejected = true;
        res.writeHead(413).end('payload_too_large');
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('error', (err) => {
      console.error('[webhook] request error:', err.message);
      if (!res.writableEnded) res.writeHead(400).end('request_error');
    });
    req.on('end', async () => {
      if (rejected || res.writableEnded) return;
      if (url === '/webhooks/alerts') {
        await handleOperationalAlert(raw, req.headers, res).catch((err) => {
          console.error('[alert webhook] failed:', err.message);
          if (!res.writableEnded) res.writeHead(502).end('alert_delivery_failed');
        });
        return;
      }

      await handlePaymentWebhook(raw, req.headers, res).catch((err) => {
        console.error('[payment webhook] failed:', err.message);
        if (!res.writableEnded) res.writeHead(502).end('telegram_delivery_failed');
      });
    });
  });

  server.listen(BOT_WEBHOOK_PORT, () => {
    console.log(`[qantara-tg-bot] webhook receiver listening on :${BOT_WEBHOOK_PORT}/webhooks/qantara`);
    if (ALERT_CHAT_ID) {
      console.log(`[qantara-tg-bot] operational alert receiver listening on :${BOT_WEBHOOK_PORT}/webhooks/alerts`);
    }
  });
}

bot.catch((err, ctx) => {
  console.error(`[bot error] update ${ctx.update.update_id}:`, err);
});

bot.launch().then(() => {
  console.log(`[qie-tg-bot] running. Backend: ${BACKEND_URL}. Frontend: ${FRONTEND_URL}`);
  startPaymentWebhookServer();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
