// Pure text helpers (no Worker APIs), unit-tested with Node.

export const TITLE_MAX = 80;
export const BODY_MAX = 60000; // GitHub limit is 65,536 chars

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function isValidRepoName(repo) {
  return typeof repo === "string" && REPO_RE.test(repo) && !repo.endsWith("/.") && !repo.endsWith("/..");
}

// Collapse whitespace, trim, capitalize the first letter.
export function cleanText(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toLocaleUpperCase("fr-FR") + t.slice(1) : "";
}

// Title = start of the dictation, cut cleanly on a word (~80 chars).
export function makeTitle(text, max = TITLE_MAX) {
  let t = cleanText(text);
  if (!t) return "";

  // Prefer the first sentence when it is short enough and meaningful.
  const sentence = t.match(/^(.{15,}?[.!?])(\s|$)/);
  if (sentence && sentence[1].length <= max) t = sentence[1];

  if (t.length > max) {
    const slice = t.slice(0, max - 1);
    const lastSpace = slice.lastIndexOf(" ");
    t = (lastSpace >= max / 2 ? slice.slice(0, lastSpace) : slice) + "…";
  }

  // Drop trailing punctuation except "?" and "!" (they carry meaning).
  return t.replace(/[\s.,;:\-–—]+(…?)$/, "$1").trim();
}

// "05/11/2026" in Paris time.
export function formatDateFr(date = new Date()) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function makeBody(text, date = new Date()) {
  const t = String(text ?? "").trim();
  return `${t}\n\n---\n_Créée par note vocale le ${formatDateFr(date)}_`;
}
