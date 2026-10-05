import { test } from "node:test";
import assert from "node:assert/strict";
import { fixPrompt, maskSecret, riskyFile, scanText } from "./secrets.ts";

// Fake keys are put together at runtime, so this file never contains anything that looks real.
const fake = (prefix: string, length: number) => prefix + "q7Zp2Lw9Xk4Rt8Vb3Nm6Hj1Cd5Fg0Sa".repeat(4).slice(0, length);

test("finds well-known keys and hides most of them", () => {
  const code = [
    `const openai = new OpenAI({ apiKey: "${fake("sk-proj-", 48)}" });`,
    `stripe("${fake("sk_" + "live_", 24)}")`,
    `const gh = "${fake("gh" + "p_", 36)}";`,
    `DATABASE_URL=postgres://app:${fake("", 18)}@db.example.com:5432/app`,
    "-----BEGIN RSA " + "PRIVATE KEY-----",
  ].join("\n");
  const found = scanText("src/app.ts", code);
  assert.deepEqual(
    found.map((f) => [f.line, f.label]),
    [
      [1, "OpenAI API key"],
      [2, "Stripe secret key"],
      [3, "GitHub token"],
      [4, "Database address with a password"],
      [5, "Private key"],
    ],
  );
  assert.ok(found.every((f) => f.preview.includes("•")));
  assert.ok(!found[0].preview.includes(fake("sk-proj-", 48).slice(8, 20)), "the secret itself isn't shown");
});

test("finds random-looking values assigned to secret names", () => {
  const found = scanText("config.py", `API_TOKEN = "${fake("", 32)}"`);
  assert.equal(found.length, 1);
  assert.match(found[0].label, /API_TOKEN/);
});

test("leaves placeholders, environment variables and ordinary code alone", () => {
  const code = [
    'const apiKey = process.env.OPENAI_API_KEY;',
    'password: "your-password-here",',
    'API_KEY=<paste your key>',
    'const token = getToken(user);',
    'DATABASE_URL=postgres://postgres:password@localhost:5432/app',
    'const passwordLabel = "Enter your password";',
    `const testKey = "${fake("sk-proj-", 48)}"; // flowcommit:allow-secret`,
  ].join("\n");
  assert.deepEqual(scanText("src/app.ts", code), []);
});

test("skips dependencies and lockfiles", () => {
  const key = `"${fake("sk-proj-", 48)}"`;
  assert.deepEqual(scanText("node_modules/x/index.js", key), []);
  assert.deepEqual(scanText("package-lock.json", key), []);
});

test("knows which files usually hold secrets", () => {
  assert.ok(riskyFile(".env"));
  assert.ok(riskyFile("apps/api/.env.production"));
  assert.equal(riskyFile(".env.example"), null);
  assert.ok(riskyFile("certs/server.pem"));
  assert.ok(riskyFile("id_ed25519"));
  assert.equal(riskyFile("src/environment.ts"), null);
});

test("masking keeps the start and end only", () => {
  assert.equal(maskSecret("short"), "••••••••");
  assert.match(maskSecret("abcdefghijklmnopqrstuvwxyz"), /^abcd•+yz$/);
});

test("the advice for the AI names every place", () => {
  const prompt = fixPrompt(
    { findings: [{ file: "src/a.ts", line: 3, label: "OpenAI API key", preview: "sk-p••yz" }], files: [{ file: ".env", reason: "" }] },
    { inHistory: true },
  );
  assert.match(prompt, /src\/a\.ts \(line 3, OpenAI API key\)/);
  assert.match(prompt, /\.env/);
  assert.match(prompt, /unpushed commits/);
});
