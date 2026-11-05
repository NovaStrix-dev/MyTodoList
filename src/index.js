// Voice2Issue Worker: thin authenticated proxy between the PWA and GitHub.
// Static files in /public are served by Cloudflare before this code runs.

import { isValidRepoName, makeTitle, makeBody, cleanText, BODY_MAX, TITLE_MAX } from "./text.js";
import { listRepos, findRepo, labelExists, createIssue, GitHubError, VOICE_LABEL } from "./github.js";

const MAX_REQUEST_BYTES = 100_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Rate limit first, so brute-forcing APP_TOKEN is throttled too.
      if (!(await allowRequest(request, env))) {
        return error(429, "rate_limited", "Trop de requêtes, réessaie dans une minute.", cors);
      }

      if (!env.APP_TOKEN || !env.GITHUB_TOKEN) {
        return error(500, "not_configured", "Secrets GITHUB_TOKEN / APP_TOKEN manquants côté Worker.", cors);
      }
      if (!(await isAuthorized(request, env))) {
        return error(401, "unauthorized", "Jeton d'application invalide.", cors);
      }

      if (url.pathname === "/api/repos" && request.method === "GET") {
        const repos = await listRepos(env, { force: url.searchParams.has("refresh") });
        return json({ repos }, 200, cors);
      }

      if (url.pathname === "/api/issues" && request.method === "POST") {
        return await handleCreateIssue(request, env, cors);
      }

      return error(404, "not_found", "Route inconnue.", cors);
    } catch (err) {
      return githubError(err, cors);
    }
  },
};

async function handleCreateIssue(request, env, cors) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_REQUEST_BYTES) {
    return error(413, "too_large", "Texte trop long.", cors);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return error(400, "bad_json", "Requête invalide.", cors);
  }

  const repo = typeof input?.repo === "string" ? input.repo.trim() : "";
  const text = typeof input?.body === "string" ? input.body.trim() : "";
  const rawTitle = typeof input?.title === "string" ? input.title : "";

  if (!isValidRepoName(repo)) {
    return error(400, "bad_repo", "Nom de dépôt invalide (attendu : propriétaire/nom).", cors);
  }
  if (!text) {
    return error(400, "empty", "Le texte est vide.", cors);
  }
  if (text.length > BODY_MAX) {
    return error(400, "too_long", `Texte trop long (max ${BODY_MAX} caractères).`, cors);
  }

  // Only repos from my own list are allowed.
  const known = await findRepo(env, repo);
  if (!known) {
    return error(403, "repo_not_allowed", "Ce dépôt n'est pas dans ta liste.", cors);
  }
  if (!known.has_issues) {
    return error(409, "issues_disabled", "Les issues sont désactivées sur ce dépôt.", cors);
  }

  const title = makeTitle(rawTitle.trim() ? cleanText(rawTitle) : text, TITLE_MAX);
  const body = makeBody(text);
  const labels = (await labelExists(env, known.full_name, VOICE_LABEL)) ? [VOICE_LABEL] : [];

  const issue = await createIssue(env, known.full_name, { title, body, labels });
  return json({ ...issue, repo: known.full_name, labels }, 201, cors);
}

// --- Auth -------------------------------------------------------------------

async function isAuthorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqualStrings(match[1].trim(), env.APP_TOKEN);
}

// Hash both sides first so lengths are equal, then compare in constant time.
async function timingSafeEqualStrings(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// --- Rate limiting ----------------------------------------------------------

// Fallback when the RATE_LIMITER binding is unavailable: per-isolate window.
const memoryHits = new Map();
const MEMORY_LIMIT = 30;
const MEMORY_WINDOW_MS = 60_000;

async function allowRequest(request, env) {
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.RATE_LIMITER?.limit) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key });
      return success;
    } catch {
      /* fall through to memory limiter */
    }
  }
  const now = Date.now();
  const entry = memoryHits.get(key);
  if (!entry || now - entry.start > MEMORY_WINDOW_MS) {
    memoryHits.set(key, { start: now, count: 1 });
    if (memoryHits.size > 1000) memoryHits.clear();
    return true;
  }
  entry.count++;
  return entry.count <= MEMORY_LIMIT;
}

// --- Responses --------------------------------------------------------------

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function error(status, code, message, cors) {
  return json({ error: code, message }, status, cors);
}

function githubError(err, cors) {
  if (err instanceof GitHubError) {
    const map = {
      401: [502, "github_auth", "Token GitHub invalide ou expiré."],
      403: [502, "github_forbidden", "GitHub refuse l'accès (permissions du token ou quota GitHub)."],
      404: [502, "github_not_found", "Dépôt introuvable pour ce token GitHub."],
      410: [409, "issues_disabled", "Les issues sont désactivées sur ce dépôt."],
      422: [502, "github_invalid", "GitHub a refusé l'issue : " + err.message],
    };
    const [status, code, message] = map[err.status] || [502, "github_error", `Erreur GitHub (${err.status}).`];
    return error(status, code, message, cors);
  }
  console.error("Unexpected error", err);
  return error(500, "internal", "Erreur interne du Worker.", cors);
}
