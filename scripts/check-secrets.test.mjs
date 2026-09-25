import { describe, it, expect } from 'vitest';
import { findSecrets, isSecretPath } from './check-secrets.mjs';

describe('publication secret guard', () => {
  it('detects credentials without returning their value', () => {
    const token = ['ghp', 'A'.repeat(36)].join('_');
    const findings = findSecrets(`value: ${token}`);
    expect(findings).toEqual([{ kind: 'provider token', line: 1 }]);
    expect(JSON.stringify(findings)).not.toContain(token);
  });
  it('detects key arrays, credential URLs and PEM keys', () => {
    const cases = [JSON.stringify(Array.from({ length: 64 }, (_, i) => i)),
      'https://node.quiknode.pro/' + 'x'.repeat(32),
      ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
      'https://rpc.example/?api-key=' + 'x'.repeat(32),
      'password = "' + 'x'.repeat(24) + '"'];
    for (const value of cases) expect(findSecrets(value).length).toBeGreaterThan(0);
  });
  it('allows public addresses and environment templates', () => {
    expect(findSecrets('PROGRAM_ID=Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky\nADMIN_SECRET=[...]')).toEqual([]);
    expect(isSecretPath('.env.example')).toBe(false);
    for (const path of ['.env.local', 'server/quote-authority.json', 'keys/a.pem', 'id.json']) expect(isSecretPath(path)).toBe(true);
  });
});
