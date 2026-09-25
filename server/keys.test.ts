import { afterEach, describe, expect, it } from 'vitest';
import { loadKey } from './keys';

const envName = 'AIRBAG_TEST_KEY_SECRET';
afterEach(() => { delete process.env[envName]; });

describe('key configuration errors', () => {
  it('does not echo invalid secret input', () => {
    const marker = 'private-material-that-must-not-be-logged';
    process.env[envName] = marker;
    expect(() => loadKey(envName, 'unused', false)).toThrow(`invalid ${envName}: expected a valid 64-byte keypair JSON array`);
    try { loadKey(envName, 'unused', false); } catch (error) {
      expect(String(error)).not.toContain(marker);
    }
  });
});
