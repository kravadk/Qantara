import { motion } from 'framer-motion';
import { AlertCircle, Clock, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, Webhook } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { QANTARA_BACKEND_URL } from '../../lib/dealRoom';
import { useSiweAuth } from '../../lib/auth';
import {
  createApiKey,
  getWebhookSecret,
  listApiKeys,
  MerchantAuthMissingError,
  revokeApiKey,
  rotateWebhookSecret,
  type MerchantApiKey,
  type WebhookSigningSecret,
} from '../../lib/qantaraApi';

function Panel({ icon: Icon, title, tone, children }: { icon: typeof KeyRound; title: string; tone?: 'default' | 'warn'; children: React.ReactNode }) {
  const border = tone === 'warn' ? 'border-yellow-400/20 bg-yellow-400/8' : 'border-border-default bg-surface-1';
  const iconTone = tone === 'warn' ? 'bg-yellow-400/10 text-yellow-300' : 'bg-primary/10 text-primary';
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`space-y-5 rounded-2xl border p-6 ${border}`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      {children}
    </motion.section>
  );
}

export function ApiKeys() {
  const { addToast } = useToastStore();
  const { address, isAuthenticated, status, login } = useSiweAuth();
  const [keys, setKeys] = useState<MerchantApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ keyId: string; secret: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<WebhookSigningSecret | null>(null);
  const [isRotating, setIsRotating] = useState(false);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast('success', `${label} copied`);
  };

  const loadKeys = useCallback(async () => {
    if (!isAuthenticated) {
      setKeys([]);
      setWebhookSecret(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [apiKeys, secret] = await Promise.all([listApiKeys(), getWebhookSecret().catch(() => null)]);
      setKeys(apiKeys);
      setWebhookSecret(secret);
    } catch (err) {
      setKeys([]);
      setError(err instanceof MerchantAuthMissingError ? 'Sign in to view API keys' : err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const handleRotateWebhook = async () => {
    setIsRotating(true);
    try {
      setWebhookSecret(await rotateWebhookSecret());
      addToast('success', 'Webhook signing secret rotated');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to rotate webhook secret');
    } finally {
      setIsRotating(false);
    }
  };

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const handleSignIn = async () => {
    const ok = await login();
    if (!ok) addToast('error', 'Connect a wallet, then sign the message to continue');
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const result = await createApiKey({ name: 'Integration key' });
      setKeys((prev) => [result.key, ...prev]);
      setNewSecret({ keyId: result.key.id, secret: result.secret });
      addToast('success', 'API key created');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      const revoked = await revokeApiKey(id);
      setKeys((prev) => prev.map((key) => (key.id === id ? revoked : key)));
      if (newSecret?.keyId === id) setNewSecret(null);
      addToast('success', 'API key revoked');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to revoke API key');
    } finally {
      setRevokingId(null);
    }
  };

  const header = (
    <div className="space-y-2">
      <h1 className="text-4xl font-bold tracking-tight text-white">API Keys</h1>
      <p className="text-text-secondary">
        Self-serve keys for server-side integration with the Qantara API. Sign in with your wallet and mint a key — no
        operator approval, no signup form. Every key is scoped to your own merchant address.
      </p>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        {header}
        <Panel icon={KeyRound} title="Sign in to manage keys" tone="warn">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <p className="max-w-2xl text-sm text-text-secondary">
              API keys authorize programmatic access (SDK / server-to-server). Sign in with your merchant wallet — the key
              binds to {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'your connected address'} and can only
              touch your own invoices, webhooks, and receipts.
            </p>
            <Button variant="primary" size="md" className="gap-2" loading={status === 'signing' || status === 'verifying'} onClick={handleSignIn}>
              <ShieldCheck className="h-4 w-4" /> Sign in with wallet
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {header}

      {newSecret && (
        <Panel icon={AlertCircle} title="Save your secret key" tone="warn">
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              This secret is shown <span className="font-bold text-white">once</span>. Copy it now and store it securely —
              you cannot retrieve it again.
            </p>
            <div className="break-all rounded-2xl border border-border-default bg-surface-2 p-4 font-mono text-sm text-white">
              {newSecret.secret}
            </div>
            <div className="flex gap-3">
              <Button variant="primary" size="sm" className="gap-2" onClick={() => copy(newSecret.secret, 'Secret')}>
                <Copy className="h-4 w-4" /> Copy secret
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setNewSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        </Panel>
      )}

      <Panel icon={KeyRound} title="Your API keys">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              Use the secret as a bearer token: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-primary">Authorization: Bearer &lt;secret&gt;</code>
            </p>
            <Button variant="primary" size="sm" className="gap-2" loading={isCreating} onClick={handleCreate}>
              <Plus className="h-4 w-4" /> Create API key
            </Button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-300">{error}</div>
          )}

          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">
              Loading keys…
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">
              No API keys yet. Create one to start integrating.
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => {
                const revoked = Boolean(key.revokedAt);
                return (
                  <motion.div
                    key={key.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl border p-4 ${revoked ? 'border-border-default bg-surface-2/50 opacity-60' : 'border-border-default bg-surface-2'}`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-white">{key.prefix}…</span>
                          {revoked && (
                            <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-300">
                              Revoked
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-text-muted">{key.name || 'Unnamed key'}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Created {new Date(key.createdAt * 1000).toLocaleDateString()}
                          </span>
                          {key.lastUsedAt && <span>Last used {new Date(key.lastUsedAt * 1000).toLocaleDateString()}</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {key.scopes.map((scope) => (
                            <span key={scope} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                              {scope}
                            </span>
                          ))}
                        </div>
                      </div>
                      {!revoked && (
                        <Button
                          variant="danger"
                          size="sm"
                          className="shrink-0 gap-2"
                          loading={revokingId === key.id}
                          onClick={() => handleRevoke(key.id)}
                        >
                          <Trash2 className="h-4 w-4" /> Revoke
                        </Button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      <Panel icon={Webhook} title="Webhook signing secret">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Each webhook we send is signed with <span className="font-bold text-white">your own</span> secret via
            <code className="mx-1 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-primary">X-Qantara-Signature</code>.
            Verify it as <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-primary">{'hmac_sha256(secret, `${timestamp}.${body}`)'}</code>.
            Keep it private — it is unique to your merchant address.
          </p>
          {webhookSecret ? (
            <>
              <div className="break-all rounded-2xl border border-border-default bg-surface-2 p-4 font-mono text-sm text-white">
                {webhookSecret.secret}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" size="sm" className="gap-2" onClick={() => copy(webhookSecret.secret, 'Webhook secret')}>
                  <Copy className="h-4 w-4" /> Copy secret
                </Button>
                <Button variant="danger" size="sm" className="gap-2" loading={isRotating} onClick={handleRotateWebhook}>
                  <RefreshCw className="h-4 w-4" /> Rotate
                </Button>
              </div>
              <p className="text-xs text-text-muted">
                Rotating immediately invalidates the previous secret — update your endpoint before rotating.
              </p>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-6 text-center text-sm text-text-muted">
              Webhook secret unavailable. Reload after signing in.
            </div>
          )}
        </div>
      </Panel>

      <Panel icon={ShieldCheck} title="Quick start">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">Create an invoice from your own backend with the key:</p>
          <pre className="overflow-x-auto rounded-2xl border border-border-default bg-surface-2 p-4 font-mono text-xs leading-relaxed text-text-secondary">
{`curl -X POST ${QANTARA_BACKEND_URL || 'https://api.qantara.example'}/v1/invoices \\
  -H "Authorization: Bearer <your-secret>" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"10","token":"QIE","merchant":"${address ?? '0xyour-wallet'}","title":"Order #1001"}'`}
          </pre>
        </div>
      </Panel>
    </div>
  );
}
