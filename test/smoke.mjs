// End-to-end smoke test: needs `npm run mock` and `npm run dev` running,
// with .dev.vars copied from .dev.vars.example.
import assert from "node:assert/strict";

const BASE = process.env.WORKER_URL || "http://localhost:8787";
const MOCK = process.env.MOCK_URL || "http://localhost:8788";
const TOKEN = process.env.APP_TOKEN || "local-dev-app-token-change-me";

const call = async (path, { method = "GET", body, token = TOKEN } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  return { status: res.status, data, res };
};

const checks = [];
const check = async (name, fn) => {
  try { await fn(); checks.push(`ok   ${name}`); }
  catch (err) { checks.push(`FAIL ${name}: ${err.message}`); process.exitCode = 1; }
};

await check("PWA is served as static asset", async () => {
  const res = await fetch(BASE + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Voice2Issue/);
  assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
});

await check("manifest and service worker are served", async () => {
  assert.equal((await fetch(BASE + "/manifest.webmanifest")).status, 200);
  assert.equal((await fetch(BASE + "/sw.js")).status, 200);
});

await check("no token -> 401", async () => {
  const { status } = await call("/api/repos", { token: "" });
  assert.equal(status, 401);
});

await check("wrong token -> 401", async () => {
  const { status } = await call("/api/repos", { token: "nope" });
  assert.equal(status, 401);
});

await check("GET /api/repos: paginated, archived excluded, sorted by push date", async () => {
  const { status, data } = await call("/api/repos");
  assert.equal(status, 200);
  assert.deepEqual(data.repos.map((r) => r.full_name), ["me/alpha", "me/delta", "me/gamma", "me/no-issues"]);
});

await check("POST /api/issues with label when it exists", async () => {
  const body = "il faudrait ajouter une page de paramètres pour choisir la langue de la dictée et aussi le thème";
  const { status, data } = await call("/api/issues", { method: "POST", body: { repo: "me/alpha", body } });
  assert.equal(status, 201, JSON.stringify(data));
  assert.match(data.url, /^https:\/\/github\.com\/me\/alpha\/issues\/\d+$/);
  const sent = (await (await fetch(MOCK + "/__issues")).json()).at(-1);
  assert.deepEqual(sent.labels, ["idée-vocale"]);
  assert.ok(sent.title.length <= 80);
  assert.match(sent.body, /Créée par note vocale le \d{2}\/\d{2}\/\d{4}/);
});

await check("POST /api/issues without label when missing (case-insensitive repo)", async () => {
  const { status } = await call("/api/issues", { method: "POST", body: { repo: "ME/Delta", body: "test" } });
  assert.equal(status, 201);
  const sent = (await (await fetch(MOCK + "/__issues")).json()).at(-1);
  assert.equal(sent.repo, "me/delta");
  assert.equal(sent.labels, undefined);
});

await check("unknown repo refused before GitHub call", async () => {
  const before = (await (await fetch(MOCK + "/__issues")).json()).length;
  const { status, data } = await call("/api/issues", { method: "POST", body: { repo: "someone/else", body: "x" } });
  assert.equal(status, 403);
  assert.equal(data.error, "repo_not_allowed");
  assert.equal((await (await fetch(MOCK + "/__issues")).json()).length, before);
});

await check("archived repo refused", async () => {
  const { status } = await call("/api/issues", { method: "POST", body: { repo: "me/old-stuff", body: "x" } });
  assert.equal(status, 403);
});

await check("issues disabled -> 409", async () => {
  const { status } = await call("/api/issues", { method: "POST", body: { repo: "me/no-issues", body: "x" } });
  assert.equal(status, 409);
});

await check("invalid inputs -> 400", async () => {
  assert.equal((await call("/api/issues", { method: "POST", body: { repo: "bad", body: "x" } })).status, 400);
  assert.equal((await call("/api/issues", { method: "POST", body: { repo: "me/alpha", body: "   " } })).status, 400);
  const res = await fetch(BASE + "/api/issues", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: "{" });
  assert.equal(res.status, 400);
});

await check("unknown API route -> 404, no-store", async () => {
  const { status, res } = await call("/api/nothing");
  assert.equal(status, 404);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

await check("rate limit kicks in", async () => {
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) {
    limited = (await call("/api/repos", { token: "wrong" })).status === 429;
  }
  assert.ok(limited, "expected a 429 after many requests");
});

console.log(checks.join("\n"));
