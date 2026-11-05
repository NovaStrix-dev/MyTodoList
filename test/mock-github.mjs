// Tiny fake GitHub API for local tests (port 8788). No real token needed.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8788);
const BASE = `http://localhost:${PORT}`;

const page1 = [
  { full_name: "me/alpha", private: false, archived: false, pushed_at: "2026-11-04T10:00:00Z" },
  { full_name: "me/old-stuff", private: false, archived: true, pushed_at: "2026-11-03T10:00:00Z" },
  { full_name: "me/gamma", private: true, archived: false, pushed_at: "2026-10-01T10:00:00Z" },
];
const page2 = [
  { full_name: "me/delta", private: false, archived: false, pushed_at: "2026-11-01T10:00:00Z" },
  { full_name: "me/no-issues", private: false, archived: false, has_issues: false, pushed_at: "2025-01-01T10:00:00Z" },
];
const labels = { "me/alpha": ["idée-vocale"] };
const issues = [];

function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const path = decodeURIComponent(url.pathname);

  if (path === "/__issues") return send(res, 200, issues);
  if (!req.headers.authorization?.startsWith("Bearer ") || !req.headers["user-agent"]) {
    return send(res, 401, { message: "Bad credentials" });
  }

  if (req.method === "GET" && path === "/user/repos") {
    if (url.searchParams.get("page") === "2") return send(res, 200, page2);
    return send(res, 200, page1, { Link: `<${BASE}/user/repos?affiliation=owner&per_page=100&page=2>; rel="next"` });
  }

  let m = path.match(/^\/repos\/([^/]+\/[^/]+)\/labels\/(.+)$/);
  if (req.method === "GET" && m) {
    return (labels[m[1]] || []).includes(m[2]) ? send(res, 200, { name: m[2] }) : send(res, 404, { message: "Not Found" });
  }

  m = path.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/);
  if (req.method === "POST" && m) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    const number = issues.length + 1;
    issues.push({ repo: m[1], ...payload });
    return send(res, 201, { number, title: payload.title, html_url: `https://github.com/${m[1]}/issues/${number}` });
  }

  send(res, 404, { message: "Not Found" });
});

server.listen(PORT, () => console.log(`Mock GitHub on ${BASE}`));
