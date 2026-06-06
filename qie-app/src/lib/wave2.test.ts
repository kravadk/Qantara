import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import uk from '../locales/uk.json';
import { checkEnv } from './assertEnv';

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('checkEnv', () => {
  it('reports missing required public config', () => {
    const result = checkEnv({});
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('VITE_QANTARA_BACKEND_URL');
    expect(result.missing).toContain('VITE_QANTARA_ADDRESS');
  });

  it('passes when required vars are present', () => {
    const result = checkEnv({
      VITE_QANTARA_BACKEND_URL: 'https://api.example',
      VITE_QANTARA_ADDRESS: '0x0000000000000000000000000000000000000001',
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('treats blank values as missing', () => {
    const result = checkEnv({ VITE_QANTARA_BACKEND_URL: '   ', VITE_QANTARA_ADDRESS: '' });
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(2);
  });
});

describe('i18n locale parity', () => {
  it('en and uk expose identical key sets', () => {
    const enKeys = new Set(flatKeys(en as Record<string, unknown>));
    const ukKeys = new Set(flatKeys(uk as Record<string, unknown>));
    const missingInUk = [...enKeys].filter((k) => !ukKeys.has(k));
    const missingInEn = [...ukKeys].filter((k) => !enKeys.has(k));
    expect(missingInUk, `missing in uk: ${missingInUk.join(', ')}`).toHaveLength(0);
    expect(missingInEn, `missing in en: ${missingInEn.join(', ')}`).toHaveLength(0);
  });
});
