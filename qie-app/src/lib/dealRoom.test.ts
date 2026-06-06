import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeDealMessageBody } from './dealRoom';

describe('deal room helpers', () => {
  it('strips scripts and tags from chat messages', () => {
    expect(sanitizeDealMessageBody('<script>alert(1)</script><b>Hello</b> merchant')).toBe('Hello merchant');
  });
});
