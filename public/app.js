"use strict";

// --- Config & storage ------------------------------------------------------

const API_BASE = (document.querySelector('meta[name="api-base"]')?.content || "").replace(/\/+$/, "");
const KEYS = {
  token: "v2i.token",
  repos: "v2i.repos",
  lastRepo: "v2i.lastRepo",
  draft: "v2i.draft",
};

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  },
  getJson(key, fallback) {
    try { return JSON.parse(this.get(key)) ?? fallback; } catch { return fallback; }
  },
};

const $ = (id) => document.getElementById(id);
const el = {
  setup: $("setup"), setupForm: $("setup-form"), tokenInput: $("token-input"),
  setupSubmit: $("setup-submit"), setupError: $("setup-error"),
  app: $("app"), repoButton: $("repo-button"), repoName: $("repo-name"),
  settingsButton: $("settings-button"), mic: $("mic-button"), micHint: $("mic-hint"),
  text: $("text"), interim: $("interim"), status: $("status"),
  success: $("success"), successTitle: $("success-title"), successLink: $("success-link"),
  send: $("send-button"),
  picker: $("picker"), pickerSearch: $("picker-search"), pickerList: $("picker-list"),
  pickerEmpty: $("picker-empty"), pickerRefresh: $("picker-refresh"), pickerClose: $("picker-close"),
  settings: $("settings"), resetToken: $("reset-token"), settingsClose: $("settings-close"),
};

const state = {
  repos: store.getJson(KEYS.repos, []),
  repo: store.get(KEYS.lastRepo) || "",
  sending: false,
};

// --- API -------------------------------------------------------------------

class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function api(path, { method = "GET", body, token = store.get(KEYS.token) } = {}) {
  if (!navigator.onLine) {
    throw new ApiError("offline", "Pas de réseau. Ton texte est conservé, réessaie une fois connecté.");
  }
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("offline", "Impossible de joindre le serveur. Vérifie ta connexion.");
  }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new ApiError(data.error || "http_error", data.message || `Erreur serveur (${res.status}).`, res.status);
  }
  return data;
}

// --- UI helpers ------------------------------------------------------------

function showStatus(message, kind = "info") {
  el.status.textContent = message;
  el.status.className = `msg msg-${kind}`;
  el.status.hidden = !message;
}

function clearStatus() {
  showStatus("");
}

function showScreen(name) {
  el.setup.hidden = name !== "setup";
  el.app.hidden = name !== "app";
}

function updateSendButton() {
  el.send.disabled = state.sending || !state.repo || !el.text.value.trim();
  el.send.textContent = state.sending ? "Création…" : "Créer l'issue";
}

function shortName(fullName) {
  return fullName.split("/")[1] || fullName;
}

// --- Setup (APP_TOKEN) -----------------------------------------------------

function showSetup(errorMessage = "") {
  showScreen("setup");
  el.setupError.textContent = errorMessage;
  el.setupError.hidden = !errorMessage;
  el.tokenInput.value = "";
  el.tokenInput.focus();
}

el.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = el.tokenInput.value.trim();
  if (!token) return;
  el.setupSubmit.disabled = true;
  el.setupSubmit.textContent = "Vérification…";
  try {
    const { repos } = await api("/api/repos", { token });
    store.set(KEYS.token, token);
    setRepos(repos);
    startApp();
  } catch (err) {
    showSetup(err.status === 401 ? "Jeton refusé par le serveur." : err.message);
  } finally {
    el.setupSubmit.disabled = false;
    el.setupSubmit.textContent = "Enregistrer";
  }
});

// --- Repositories ----------------------------------------------------------

function setRepos(repos) {
  state.repos = Array.isArray(repos) ? repos : [];
  store.set(KEYS.repos, JSON.stringify(state.repos));
  const exists = state.repos.some((r) => r.full_name === state.repo);
  if (!exists) selectRepo(state.repos[0]?.full_name || "");
  else renderRepoButton();
}

function selectRepo(fullName) {
  state.repo = fullName;
  if (fullName) store.set(KEYS.lastRepo, fullName);
  renderRepoButton();
  updateSendButton();
}

function renderRepoButton() {
  el.repoName.textContent = state.repo || (state.repos.length ? "Choisir un projet" : "Aucun dépôt");
  el.repoButton.title = state.repo;
}

async function refreshRepos({ force = false, silent = true } = {}) {
  try {
    const { repos } = await api(force ? "/api/repos?refresh=1" : "/api/repos");
    setRepos(repos);
    if (el.picker.open) renderPicker();
  } catch (err) {
    if (err.status === 401) {
      store.remove(KEYS.token);
      showSetup("Jeton refusé. Saisis-le à nouveau.");
    } else if (!silent || !state.repos.length) {
      showStatus(err.message, "error");
    }
  }
}

function renderPicker() {
  const query = el.pickerSearch.value.trim().toLowerCase();
  const items = state.repos.filter((r) => r.full_name.toLowerCase().includes(query));
  el.pickerList.replaceChildren(
    ...items.map((repo) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(repo.full_name === state.repo));
      const [owner, name] = repo.full_name.split("/");
      const label = document.createElement("span");
      const ownerSpan = document.createElement("span");
      ownerSpan.className = "owner";
      ownerSpan.textContent = owner + "/";
      label.append(ownerSpan, name);
      button.append(label);
      if (repo.private) button.insertAdjacentHTML("afterbegin", '<svg class="lock" viewBox="0 0 24 24" aria-label="privé"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>');
      button.addEventListener("click", () => {
        selectRepo(repo.full_name);
        el.picker.close();
      });
      li.append(button);
      return li;
    })
  );
  el.pickerEmpty.hidden = items.length > 0;
}

el.repoButton.addEventListener("click", () => {
  el.pickerSearch.value = "";
  renderPicker();
  el.picker.showModal();
  el.pickerSearch.focus();
});
el.pickerSearch.addEventListener("input", renderPicker);
el.pickerSearch.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  el.pickerList.querySelector("button")?.click();
});
el.pickerClose.addEventListener("click", () => el.picker.close());
el.pickerRefresh.addEventListener("click", async () => {
  el.pickerRefresh.disabled = true;
  await refreshRepos({ force: true, silent: false });
  el.pickerRefresh.disabled = false;
});
// Tap on the backdrop closes the sheet.
for (const dialog of [el.picker, el.settings]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// --- Dictation (Web Speech API) --------------------------------------------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const dictation = {
  active: false,      // user wants to keep listening
  recognition: null,
  base: "",           // text present before the current session
  sessionFinal: "",   // final text of the current session
  emptySessions: 0,
  onStopped: null,
};

function joinText(a, b) {
  b = b.trim();
  if (!b) return a;
  if (!a.trim()) return b.charAt(0).toUpperCase() + b.slice(1);
  return a.replace(/\s*$/, " ") + b;
}

function setListeningUi(listening) {
  el.mic.classList.toggle("listening", listening);
  el.mic.setAttribute("aria-pressed", String(listening));
  el.mic.setAttribute("aria-label", listening ? "Arrêter la dictée" : "Démarrer la dictée");
  el.micHint.textContent = listening ? "J'écoute… appuie pour arrêter" : "Appuie pour dicter";
  el.text.readOnly = listening;
  if (!listening) el.interim.textContent = "";
}

// Short sessions restarted automatically: more reliable on Chrome Android
// than continuous mode, which tends to duplicate results.
function startSession() {
  const rec = new SpeechRecognition();
  rec.lang = "fr-FR";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  dictation.recognition = rec;
  dictation.sessionFinal = "";

  rec.onresult = (event) => {
    let finalText = "";
    let interim = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    dictation.sessionFinal = finalText;
    el.text.value = joinText(dictation.base, finalText);
    el.interim.textContent = interim;
  };

  rec.onerror = (event) => {
    const fatal = {
      "not-allowed": "Micro refusé. Autorise le micro pour ce site : icône à gauche de l'adresse → Autorisations → Micro.",
      "service-not-allowed": "La reconnaissance vocale est bloquée sur cet appareil.",
      "audio-capture": "Aucun micro détecté.",
      "network": "La dictée a besoin du réseau. Vérifie ta connexion.",
      "language-not-supported": "Le français n'est pas disponible pour la dictée sur cet appareil.",
    }[event.error];
    if (fatal) {
      dictation.active = false;
      showStatus(fatal, "error");
    }
    // "no-speech" and "aborted" are handled by onend.
  };

  rec.onend = () => {
    const spoken = dictation.sessionFinal.trim();
    dictation.base = joinText(dictation.base, spoken);
    el.text.value = dictation.base;
    store.set(KEYS.draft, el.text.value);
    dictation.emptySessions = spoken ? 0 : dictation.emptySessions + 1;

    // Stop after ~3 silent sessions to avoid an endless loop.
    if (dictation.active && dictation.emptySessions < 3) {
      try {
        startSession();
        return;
      } catch {
        /* fall through and stop */
      }
    }
    dictation.active = false;
    dictation.recognition = null;
    setListeningUi(false);
    updateSendButton();
    el.text.focus({ preventScroll: true });
    dictation.onStopped?.();
    dictation.onStopped = null;
  };

  rec.start();
}

function startDictation() {
  if (!SpeechRecognition) {
    showStatus("La dictée n'est pas disponible dans ce navigateur. Utilise Chrome, ou tape ton texte.", "error");
    return;
  }
  clearStatus();
  el.success.hidden = true;
  dictation.active = true;
  dictation.base = el.text.value;
  dictation.emptySessions = 0;
  setListeningUi(true);
  try {
    startSession();
  } catch {
    dictation.active = false;
    setListeningUi(false);
    showStatus("Impossible de démarrer la dictée.", "error");
  }
}

function stopDictation() {
  return new Promise((resolve) => {
    if (!dictation.recognition) {
      dictation.active = false;
      setListeningUi(false);
      resolve();
      return;
    }
    dictation.active = false;
    dictation.onStopped = resolve;
    dictation.recognition.stop();
  });
}

el.mic.addEventListener("click", () => {
  if (dictation.active || dictation.recognition) stopDictation();
  else startDictation();
});

// --- Text & sending --------------------------------------------------------

el.text.addEventListener("input", () => {
  store.set(KEYS.draft, el.text.value);
  updateSendButton();
});

el.send.addEventListener("click", async () => {
  if (dictation.active || dictation.recognition) await stopDictation();
  const body = el.text.value.trim();
  if (!body || !state.repo || state.sending) return;

  state.sending = true;
  updateSendButton();
  clearStatus();
  el.success.hidden = true;

  try {
    const issue = await api("/api/issues", { method: "POST", body: { repo: state.repo, body } });
    el.successTitle.textContent = `Issue #${issue.number} créée dans ${shortName(issue.repo)}`;
    el.successLink.href = issue.url;
    el.success.hidden = false;
    el.text.value = "";
    store.remove(KEYS.draft);
    navigator.vibrate?.(30);
  } catch (err) {
    if (err.status === 401) {
      store.remove(KEYS.token);
      showSetup("Jeton refusé. Saisis-le à nouveau (ton texte est conservé).");
    } else {
      showStatus(err.message, "error");
      if (err.code === "repo_not_allowed") refreshRepos({ force: true });
    }
  } finally {
    state.sending = false;
    updateSendButton();
  }
});

window.addEventListener("offline", () => showStatus("Hors ligne. Ton texte est conservé.", "info"));
window.addEventListener("online", () => {
  if (el.status.textContent.startsWith("Hors ligne")) clearStatus();
});

// --- Settings --------------------------------------------------------------

el.settingsButton.addEventListener("click", () => el.settings.showModal());
el.settingsClose.addEventListener("click", () => el.settings.close());
el.resetToken.addEventListener("click", () => {
  el.settings.close();
  store.remove(KEYS.token);
  showSetup();
});

// --- Boot ------------------------------------------------------------------

function startApp() {
  showScreen("app");
  clearStatus();
  renderRepoButton();
  updateSendButton();
}

function boot() {
  el.text.value = store.get(KEYS.draft) || "";
  if (!SpeechRecognition) {
    el.micHint.textContent = "Dictée indisponible ici : tape ton texte";
    el.mic.disabled = true;
  }
  if (!store.get(KEYS.token)) {
    showSetup();
  } else {
    startApp();
    refreshRepos(); // cached list shown immediately, refreshed in background
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* app works without it */ });
  }
}

boot();
