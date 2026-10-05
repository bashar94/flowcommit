/**
 * Finds passwords, API keys and other secrets before they're saved in a version or pushed to
 * GitHub, where they'd stay in the history for anyone to see. AI-written code often pastes a
 * key straight in, so this runs on every save that includes code and on every push.
 *
 * It looks for well-known key formats, for values assigned to names like `api_key` that look
 * random, and for files that usually hold secrets (like `.env`). A line containing
 * `flowcommit:allow-secret` is skipped, for test values that only look real.
 */

export type SecretFinding = {
  file: string;
  line: number;
  /** What it looks like, in words: "OpenAI API key". */
  label: string;
  /** The secret with most of it hidden, so the warning itself doesn't leak it. */
  preview: string;
  /** For a secret in the design, the step it's written in. */
  step?: { id: string; title: string };
};

export type RiskyFile = { file: string; reason: string };

export type SecretReport = { findings: SecretFinding[]; files: RiskyFile[] };

export const hasSecrets = (r: SecretReport) => r.findings.length > 0 || r.files.length > 0;

type Rule = { label: string; pattern: RegExp; group?: number };

/** Well-known formats. Each is specific enough that a match is almost always a real key. */
const RULES: Rule[] = [
  { label: "Private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { label: "AWS access key", pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/, group: 1 },
  {
    label: "AWS secret key",
    pattern: /aws_?secret_?(?:access_?)?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+]{40})\b/i,
    group: 1,
  },
  { label: "GitHub token", pattern: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,})\b/, group: 1 },
  { label: "GitHub token", pattern: /\b(github_pat_[A-Za-z0-9_]{40,})\b/, group: 1 },
  { label: "Anthropic API key", pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,})/, group: 1 },
  { label: "OpenAI API key", pattern: /\b(sk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,})/, group: 1 },
  { label: "Stripe secret key", pattern: /\b((?:sk|rk)_live_[0-9A-Za-z]{20,})\b/, group: 1 },
  { label: "Slack token", pattern: /\b(xox[abprs]-[0-9A-Za-z-]{10,})\b/, group: 1 },
  { label: "Slack webhook", pattern: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,})/, group: 1 },
  { label: "Google API key", pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/, group: 1 },
  { label: "SendGrid API key", pattern: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/, group: 1 },
  { label: "npm token", pattern: /\b(npm_[A-Za-z0-9]{36})\b/, group: 1 },
  { label: "Hugging Face token", pattern: /\b(hf_[A-Za-z0-9]{34,})\b/, group: 1 },
  {
    label: "Database address with a password",
    pattern: /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp):\/\/[^:\s/"'@]+:([^@\s/"']{3,})@[^\s"']+)/,
    group: 1,
  },
];

/** `api_key = "…"`, `"password": "…"`, `SECRET_TOKEN=…` and similar. */
const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|pwd|private[_-]?key|client[_-]?secret|access[_-]?key|auth)[A-Za-z0-9_]*)["']?\s*(?::|=|=>)\s*["'`]?([^\s"'`,;)}]{12,})/i;

/** Values that are obviously not real: placeholders, references to environment variables, code. */
const PLACEHOLDER =
  /^(?:your|my|example|sample|test|dummy|fake|placeholder|changeme|change[_-]?me|replace|todo|xxx|none|null|undefined|true|false|secret|password|token|redacted)|<[^>]*>|\$\{|\{\{|process\.env|import\.meta|os\.environ|getenv|env\(|env\.|config\.|settings\.|\(|\)|x{4,}|\*{4,}|\.{3}/i;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A value that looks randomly generated, like a real key, rather than a word or a name. */
function looksRandom(v: string): boolean {
  if (v.length < 16) return false;
  if (!/[a-z]/i.test(v) || !/\d/.test(v)) return false;
  return entropy(v) >= 3.3;
}

export function maskSecret(s: string): string {
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}${"•".repeat(Math.min(12, s.length - 6))}${s.slice(-2)}`;
}

/** Paths that are never worth scanning: dependencies, build output, lockfiles, images. */
const SKIP_PATH = /(^|\/)(node_modules|dist|build|\.next|vendor|coverage)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|woff2?|ttf|mp4|mov|mp3)$/i;

export const skipPath = (file: string) => SKIP_PATH.test(file);

/** Finds secrets in some lines of one file. Line numbers are the file's own. */
export function scanLines(file: string, lines: { line: number; text: string }[]): SecretFinding[] {
  if (skipPath(file)) return [];
  const found: SecretFinding[] = [];
  const seen = new Set<string>();
  const add = (line: number, label: string, secret: string) => {
    const key = `${line}:${secret}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ file, line, label, preview: maskSecret(secret) });
  };
  for (const { line, text: raw } of lines) {
    if (raw.includes("flowcommit:allow-secret")) continue;
    const text = raw.length > 20_000 ? raw.slice(0, 20_000) : raw;
    let matched = false;
    for (const rule of RULES) {
      const m = rule.pattern.exec(text);
      if (!m) continue;
      const secret = rule.group ? m[rule.group] : m[0];
      // A database address whose password is a placeholder ("password", "pass") isn't a leak.
      if (rule.label.startsWith("Database") && PLACEHOLDER.test(m[2] ?? "")) continue;
      if (rule.label.startsWith("Database") && /^(pass|pw|root|admin|postgres|user)$/i.test(m[2] ?? "")) continue;
      add(line, rule.label, secret);
      matched = true;
    }
    if (matched) continue;
    const a = ASSIGNMENT.exec(text);
    if (a && !PLACEHOLDER.test(a[2]) && looksRandom(a[2])) add(line, `Value for "${a[1]}"`, a[2]);
  }
  return found;
}

export function scanText(file: string, text: string): SecretFinding[] {
  return scanLines(
    file,
    text.split("\n").map((t, i) => ({ line: i + 1, text: t })),
  );
}

/** Files that usually hold secrets, whatever is in them. */
export function riskyFile(file: string): string | null {
  const name = file.split("/").pop() ?? file;
  if (/^\.env(\..+)?$/i.test(name) && !/\.(example|sample|template|dist|defaults?)$/i.test(name)) {
    return "Environment file, which usually holds passwords and keys";
  }
  if (/\.(pem|key|p12|pfx|jks|keystore|ppk)$/i.test(name)) return "Key or certificate file";
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return "SSH private key";
  if (/^(\.npmrc|\.pypirc|\.netrc|\.htpasswd)$/.test(name)) return "Settings file that can hold passwords or tokens";
  if (/^(credentials|service[-_]?account.*|client_secret.*)\.json$/i.test(name)) return "Credentials file";
  return null;
}

/** Plain-language advice the person can hand to their AI builder. */
export function fixPrompt(report: SecretReport, opts: { inHistory: boolean }): string {
  const where = [
    ...new Set([...report.findings.map((f) => `${f.file} (line ${f.line}, ${f.label})`), ...report.files.map((f) => f.file)]),
  ];
  const lines = [
    "FlowCommit found secrets in this project that shouldn't be saved in Git:",
    ...where.map((w) => `- ${w}`),
    "",
    "Please move each secret out of the code into an environment variable, read it from a .env file that's listed in .gitignore, and add a .env.example with placeholder values so others know what to set.",
  ];
  if (opts.inHistory) {
    lines.push(
      "These secrets are also in commits that haven't been pushed yet. Rewrite those unpushed commits so the secrets aren't in them, without changing anything else, and tell me which keys I should replace (rotate) to be safe.",
    );
  }
  return lines.join("\n");
}
