import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTitle, makeBody, isValidRepoName, formatDateFr } from "../src/text.js";

test("short dictation becomes the title, capitalized", () => {
  assert.equal(makeTitle("  ajouter un mode sombre  "), "Ajouter un mode sombre");
});

test("long dictation is cut on a word, under 80 chars", () => {
  const text = "il faudrait ajouter une page de paramètres pour choisir la langue de la dictée et aussi le thème de couleur";
  const title = makeTitle(text);
  assert.ok(title.length <= 80, title);
  assert.ok(title.endsWith("…"));
  assert.ok(text.toLowerCase().startsWith(title.slice(0, -1).toLowerCase()));
  assert.ok(!/\s…$/.test(title));
});

test("first sentence is used when present", () => {
  assert.equal(makeTitle("Corriger le bug de connexion. Il apparaît sur mobile seulement."), "Corriger le bug de connexion");
  assert.equal(makeTitle("Pourquoi le build est lent ? À creuser."), "Pourquoi le build est lent ?");
});

test("body contains transcription and dated footer", () => {
  const body = makeBody("mon idée", new Date("2026-11-05T09:00:00Z"));
  assert.match(body, /^mon idée\n/);
  assert.match(body, /Créée par note vocale le 05\/11\/2026/);
  assert.equal(formatDateFr(new Date("2026-12-31T23:30:00Z")), "01/01/2027"); // Paris time
});

test("repo name validation", () => {
  assert.ok(isValidRepoName("me/alpha"));
  assert.ok(isValidRepoName("my-org/repo.name_2"));
  for (const bad of ["alpha", "me/", "/alpha", "me/alpha/x", "me/../x", "me/..", "-me/x", "me/al pha", ""]) {
    assert.ok(!isValidRepoName(bad), bad);
  }
});
