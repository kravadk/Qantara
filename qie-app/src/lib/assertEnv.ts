/**
 * Startup validation for required public (VITE_*) configuration. Catches silent
 * misconfiguration in production builds instead of failing deep inside a flow.
 */

export interface EnvCheck {
  ok: boolean;
  missing: string[];
}

const REQUIRED = ['VITE_QANTARA_BACKEND_URL', 'VITE_QANTARA_ADDRESS'] as const;

export function checkEnv(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): EnvCheck {
  const missing = REQUIRED.filter((name) => {
    const value = env[name];
    return !value || String(value).trim().length === 0;
  });
  return { ok: missing.length === 0, missing };
}
