# Voice2Issue — Notes vocales vers issues GitHub

## Contexte

Je veux une application accessible en un clic sur mon téléphone Android pour dicter une idée et la transformer en issue GitHub dans le projet de mon choix.

Flux visé :

1. J'ouvre l'app depuis l'écran d'accueil du téléphone.
2. Je choisis le projet (dépôt GitHub) dans un sélecteur.
3. J'appuie sur le micro et je dicte mon idée.
4. Je vérifie le texte, je valide, et une issue est créée dans le dépôt choisi.

## État d'avancement (05/11/2026)

- **Code** : terminé et testé en local (Worker + PWA + tests).
- **Dépôt** : https://github.com/NovaStrix-dev/MyTodoList, branche `main`. Ce fichier y est versionné dans `docs/project.md`.
- **Reste à faire (moi)** : créer le token GitHub, générer l'`APP_TOKEN`, déployer, déclarer les secrets, installer sur Android et valider la dictée réelle. Procédure dans le `README.md`.

## Décisions déjà prises

- **Téléphone** : Android.
- **Destination** : création d'issues GitHub (pas de fichier TODO.md).
- **Projets concernés** : tous les dépôts de mon compte GitHub (`affiliation=owner`, archivés exclus).
- **Choix du projet** : sélecteur dans l'app. Pas d'API Anthropic ni de détection automatique dans la phrase.
- **Hébergement** : Cloudflare (compte gratuit déjà créé). Objectif : coût 0 €.
  - Fonction serveur : Cloudflare Workers (offre gratuite : 100 000 requêtes par jour).
  - App web : servie par le même Worker (static assets). Les requêtes vers les static assets sont gratuites et illimitées ; seuls les appels `/api/*` comptent (1 à l'ouverture + 1 par issue).
- **Dictée** : Web Speech API du navigateur (gratuit), langue `fr-FR`.

## Architecture

```
Android (PWA installée) ──HTTPS──> Cloudflare Worker ──> API GitHub
        │                               │
   dictée vocale                  secrets : GITHUB_TOKEN, APP_TOKEN
   sélecteur de projet
```

Les clés ne sont jamais dans le téléphone ni dans le code : elles sont stockées comme secrets Cloudflare. Seul l'`APP_TOKEN` est saisi une fois sur le téléphone (localStorage).

### Structure du code

| Chemin | Rôle |
|---|---|
| `src/index.js` | Routage, authentification, limitation de débit, CORS, erreurs |
| `src/github.js` | Client GitHub minimal (liste paginée des dépôts, label, création d'issue) |
| `src/text.js` | Titre, corps, date, validation du nom de dépôt (fonctions pures) |
| `public/` | PWA : `index.html`, `app.js`, `style.css`, `sw.js`, manifeste, icônes, `_headers` (CSP) |
| `test/` | Faux GitHub local, tests unitaires, tests de bout en bout |
| `wrangler.jsonc` | Configuration du Worker (assets, rate limiter, variables) |

### Endpoints du Worker

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/repos` | Liste mes dépôts (nom complet, triés par activité récente, archivés exclus). `?refresh=1` force le rafraîchissement du cache (5 min) |
| POST | `/api/issues` | Crée une issue `{ repo, body, title? }` et renvoie `{ number, url, title, repo, labels }`. Sans `title`, le titre est dérivé de `body` |

Les deux routes exigent l'en-tête `Authorization: Bearer <APP_TOKEN>`. Le Worker gère aussi le CORS si l'app est servie depuis un autre domaine (variable `ALLOWED_ORIGIN`).

### Règles de création d'issue

- **Titre** : début de la dictée, nettoyé et tronqué proprement (80 caractères max, coupé sur un mot, « … » final). Si la dictée commence par une phrase courte, elle sert de titre.
- **Corps** : transcription complète, plus une ligne « Créée par note vocale le JJ/MM/AAAA » (heure de Paris).
- **Label** : `idée-vocale` si le label existe dans le dépôt, sinon aucun (ne pas faire échouer la création).

## Interface (PWA)

Écran unique, pensé pour une main, ouverture en un clic :

- Sélecteur de projet en haut (recherche rapide, dernier projet utilisé présélectionné, liste mise en cache localement et rafraîchie en arrière-plan, bouton ↻).
- Gros bouton micro au centre. Appui pour démarrer la dictée, appui pour arrêter. Sessions courtes relancées automatiquement (plus fiable sur Chrome Android), arrêt après ~3 silences.
- Zone de texte éditable avec la transcription, pour corriger avant envoi. Brouillon conservé sur le téléphone.
- Bouton « Créer l'issue » puis confirmation avec lien vers l'issue créée.
- Messages d'erreur clairs (micro refusé, pas de réseau, échec GitHub).
- Manifeste PWA + icône + service worker, pour pouvoir « Ajouter à l'écran d'accueil » depuis Chrome Android.
- Au premier lancement, saisie unique de l'`APP_TOKEN`, stocké en localStorage. Réglages ⚙ pour le changer.
- Thème clair et sombre automatique.

## Sécurité

- Token GitHub **fine-grained** limité aux permissions strictement nécessaires : lecture des métadonnées et lecture/écriture des **Issues**, sur tous mes dépôts.
- `GITHUB_TOKEN` et `APP_TOKEN` stockés via `wrangler secret put`, jamais commités (`.dev.vars` ignoré par git).
- `APP_TOKEN` : longue chaîne aléatoire générée par moi, comparée côté Worker en temps constant (SHA-256 puis `timingSafeEqual`).
- Limitation du débit côté Worker : 30 requêtes/minute par IP (binding `ratelimits` de Cloudflare, repli en mémoire), appliquée avant l'authentification.
- Validation du champ `repo` (format `propriétaire/nom` et présence dans ma liste de dépôts) avant tout appel de création à GitHub.
- CSP stricte sur la PWA, réponses API en `no-store`.

## Plan de réalisation

1. ✅ Initialiser le projet (`wrangler`, structure `src/` pour le Worker et `public/` pour la PWA).
2. ✅ Implémenter le Worker : authentification, `GET /api/repos`, `POST /api/issues`, gestion d'erreurs.
3. ✅ Construire la PWA : sélecteur, dictée, édition, envoi, manifeste, service worker.
4. ✅ Tester en local (`wrangler dev`) avec un faux GitHub (13 tests de bout en bout + tests unitaires). Test contre un vrai dépôt de test possible via `.dev.vars`.
5. ⏳ Me guider pas à pas pour : créer le token GitHub fine-grained, générer l'`APP_TOKEN`, déclarer les secrets, déployer (`wrangler deploy`). Instructions dans le `README.md`.
6. ⏳ Installer l'app sur mon Android et valider le parcours complet (dictée réelle non testable hors téléphone).
7. ✅ Rédiger un `README.md` court : déploiement, rotation des tokens, dépannage.

## Évolutions possibles (hors périmètre initial)

- Mise en file hors ligne : stocker les notes sans réseau et les envoyer au retour de la connexion (aujourd'hui : le brouillon est conservé, envoi manuel).
- Choix du label ou de l'assigné au moment de la dictée.
- Détection automatique du projet dans la phrase via l'API Claude.
- Widget ou raccourci Android dédié.

## Consignes pour Claude

- Réponds en français. Code, commentaires et noms de variables en anglais.
- Reste minimaliste : HTML/CSS/JS natifs, pas de framework lourd, pas de dépendance inutile.
- Avant d'écrire du code, confirme le plan en quelques lignes, puis avance étape par étape.
- Pour chaque action que je dois faire moi-même (Cloudflare, GitHub, téléphone), donne des instructions courtes et numérotées.
- Ne me demande jamais de coller un token dans le chat : je les saisis moi-même dans `wrangler secret put`.
- Vérifie la limite gratuite de Cloudflare avant de proposer toute fonctionnalité qui augmente les requêtes.
- Le code vit dans https://github.com/NovaStrix-dev/MyTodoList : garde `docs/project.md` synchronisé avec ce fichier et commite chaque changement.
