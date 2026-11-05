// Minimal GitHub REST client for the Worker.

export const VOICE_LABEL = "idée-vocale";
const MAX_PAGES = 10; // 1,000 repos max, well under the 50 subrequests/request limit
const REPOS_TTL_MS = 5 * 60 * 1000;

// Per-isolate cache: avoids hitting GitHub on every request.
let reposCache = { at: 0, data: null };

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function apiBase(env) {
  return (env.GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
}

async function gh(env, path, init = {}) {
  const res = await fetch(apiBase(env) + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "voice2issue",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return res;
}

async function failFrom(res) {
  let detail = "";
  try {
    detail = (await res.json()).message || "";
  } catch {
    /* ignore */
  }
  return new GitHubError(res.status, detail || `GitHub HTTP ${res.status}`);
}

function nextLink(res) {
  const link = res.headers.get("Link") || "";
  const m = link.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

// All non-archived repos owned by the token owner, most recently pushed first.
export async function listRepos(env, { force = false } = {}) {
  if (!force && reposCache.data && Date.now() - reposCache.at < REPOS_TTL_MS) {
    return reposCache.data;
  }

  const repos = [];
  let path = "/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100";
  for (let page = 0; path && page < MAX_PAGES; page++) {
    const res = await gh(env, path);
    if (!res.ok) throw await failFrom(res);
    for (const r of await res.json()) {
      if (r.archived || r.disabled) continue;
      repos.push({
        full_name: r.full_name,
        private: Boolean(r.private),
        pushed_at: r.pushed_at,
        has_issues: r.has_issues !== false,
      });
    }
    const next = nextLink(res);
    path = next ? next.replace(apiBase(env), "") : null;
  }

  repos.sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)));
  reposCache = { at: Date.now(), data: repos };
  return repos;
}

export async function findRepo(env, fullName) {
  const wanted = fullName.toLowerCase();
  const pick = (list) => list.find((r) => r.full_name.toLowerCase() === wanted);
  let repo = pick(await listRepos(env));
  // Repo may have been created after the cache was filled: refresh once.
  if (!repo) repo = pick(await listRepos(env, { force: true }));
  return repo || null;
}

export async function labelExists(env, fullName, label) {
  try {
    const res = await gh(env, `/repos/${fullName}/labels/${encodeURIComponent(label)}`);
    return res.ok;
  } catch {
    return false; // never block issue creation on the label check
  }
}

export async function createIssue(env, fullName, { title, body, labels }) {
  const payload = { title, body };
  if (labels && labels.length) payload.labels = labels;
  const res = await gh(env, `/repos/${fullName}/issues`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await failFrom(res);
  const issue = await res.json();
  return { number: issue.number, url: issue.html_url, title: issue.title };
}
