// Dependency-free publication guard. Reports locations, never matched values.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['provider token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk_(?:live_|proj-|ant-)[A-Za-z0-9_-]{20,}|xox[bpars]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})/g],
  ['signed token', /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g],
  ['Solana keypair array', /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g],
  ['credential URL', /(?:https?:\/\/[^\s"'`<>]*quiknode\.pro\/[A-Za-z0-9_-]{16,}|[?&](?:api[_-]?key|token|secret)=[A-Za-z0-9_-]{16,}|(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis|https?):\/\/[^\s/"'`:@]+:[^\s/"'`@]+@)/gi],
  ['literal credential', /(?:secret|password|api_?key|access_?token|private_?key|mnemonic|seed_?phrase)[\w]*\s*[=:]\s*["'`][A-Za-z0-9+/_= .-]{16,}["'`]/gi],
];

export function findSecrets(content) {
  const findings = [];
  for (const [kind, regex] of rules) {
    for (const match of content.matchAll(regex)) {
      if (kind === 'Solana keypair array' && JSON.parse(match[0]).some(n => n > 255)) continue;
      findings.push({ kind, line: content.slice(0, match.index).split('\n').length });
    }
  }
  return findings;
}

const git = (...args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
const forbiddenPath = /(?:^|\/)(?:\.env(?:\..+)?|id\.json|credentials\.json|DEPLOY-SECRETS\.local\.(?:md|txt)|(?:quote-authority|publisher-authority|trial-budget)\.json)$|(?:-keypair\.json|\.(?:pem|key|p12|pfx|keystore|secret|secrets))$/i;
export function isSecretPath(path) {
  return !/(?:^|\/)\.env\.example$/.test(path) && forbiddenPath.test(path);
}

export function runScan(staged = false) {
  let failed = false;
  let checked = 0;
  const inspect = (path, buffer, revision) => {
    checked++;
    const results = findSecrets(buffer.toString('utf8'));
    if (isSecretPath(path)) results.push({ kind: 'private file', line: 1 });
    for (const result of results) {
      // Values and surrounding source must never reach CI logs.
      console.error(`${JSON.stringify(path)}:${result.line} [${revision}] ${result.kind}`);
      failed = true;
    }
  };
  if (staged) {
    const paths = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').toString().split('\0').filter(Boolean);
    for (const path of paths) inspect(path, git('show', `:${path}`), 'staged');
  } else {
    // Include tracked edits and new non-ignored source files before staging.
    const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean);
    for (const path of new Set(paths)) {
      try { inspect(path, readFileSync(path), 'working tree'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const entries = git('rev-list', '--objects', '--all').toString().trim().split('\n');
    for (const entry of entries) {
      const space = entry.indexOf(' ');
      if (space < 0) continue;
      const hash = entry.slice(0, space);
      const path = entry.slice(space + 1);
      if (git('cat-file', '-t', hash).toString().trim() !== 'blob') continue;
      inspect(path, git('cat-file', 'blob', hash), hash.slice(0, 12));
    }
    inspect('commit messages', git('log', '--all', '--format=%B'), 'history');
  }
  console.log(`Secret check: ${checked} file versions checked; ${failed ? 'BLOCKED' : 'passed'}.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = runScan(process.argv.includes('--staged')); }
  catch { console.error('Secret check could not complete; refusing to pass.'); process.exitCode = 1; }
}
