# Voice2Issue — Notes vocales vers issues GitHub

## Contexte

Je veux une application accessible en un clic sur mon téléphone Android pour dicter une idée et la transformer en issue GitHub dans le projet de mon choix.

Flux visé :

1. J'ouvre l'app depuis l'écran d'accueil du téléphone.
2. Je choisis le projet (dépôt GitHub) dans un sélecteur.
3. J'appuie sur le micro et je dicte mon idée.
4. Je vérifie le texte, je valide, et une issue est créée dans le dépôt choisi.

## Décisions déjà prises

- **Téléphone** : Android.
- **Destination** : création d'issues GitHub (pas de fichier TODO.md).
- **Projets concernés** : tous les dépôts de mon compte GitHub.
- **Choix du projet** : sélecteur dans l'app. Pas d'API Anthropic ni de détection automatique dans la phrase.
- **Hébergement** : Cloudflare (compte gratuit déjà créé). Objectif : coût 0 €.
  - Fonction serveur : Cloudflare Workers (offre gratuite : 100 000 requêtes par jour).
  - App web : servie par le même Worker (static assets) ou par Cloudflare Pages.
- **Dictée** : Web Speech API du navigateur (gratuit), langue `fr-FR`.

## Architecture

```
Android (PWA installée) ──HTTPS──> Cloudflare Worker ──> API GitHub
        │                               │
   dictée vocale                  secrets : GITHUB_TOKEN, APP_TOKEN
   sélecteur de projet
```

Les clés ne sont jamais dans le téléphone ni dans le code : elles sont stockées comme secrets Cloudflare.

### Endpoints du Worker

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/repos` | Liste mes dépôts (nom complet, triés par activité récente, archivés exclus) |
| POST | `/api/issues` | Crée une issue `{ repo, title, body }` et renvoie l'URL de l'issue |

Les deux routes exigent l'en-tête `Authorization: Bearer <APP_TOKEN>`. Le Worker gère aussi le CORS si l'app est servie depuis un autre domaine.

### Règles de création d'issue

- **Titre** : début de la dictée, nettoyé et tronqué proprement (environ 80 caractères, coupé sur un mot).
- **Corps** : transcription complète, plus une ligne « Créée par note vocale le JJ/MM/AAAA ».
- **Label** : `idée-vocale` si le label existe dans le dépôt, sinon aucun (ne pas faire échouer la création).

## Interface (PWA)

Écran unique, pensé pour une main, ouverture en un clic :

- Sélecteur de projet en haut (recherche rapide, dernier projet utilisé présélectionné, liste mise en cache localement et rafraîchie en arrière-plan).
- Gros bouton micro au centre. Appui pour démarrer la dictée, appui pour arrêter.
- Zone de texte éditable avec la transcription, pour corriger avant envoi.
- Bouton « Créer l'issue » puis confirmation avec lien vers l'issue créée.
- Messages d'erreur clairs (micro refusé, pas de réseau, échec GitHub).
- Manifeste PWA + icône + service worker, pour pouvoir « Ajouter à l'écran d'accueil » depuis Chrome Android.
- Au premier lancement, saisie unique de l'`APP_TOKEN`, stocké en localStorage.

## Sécurité

- Token GitHub **fine-grained** limité aux permissions strictement nécessaires : lecture des métadonnées et lecture/écriture des **Issues**, sur tous mes dépôts.
- `GITHUB_TOKEN` et `APP_TOKEN` stockés via `wrangler secret put`, jamais commités.
- `APP_TOKEN` : longue chaîne aléatoire générée par moi, comparée côté Worker en temps constant.
- Limitation simple du débit côté Worker pour éviter l'abus si l'URL fuite.
- Validation du champ `repo` (format `propriétaire/nom` et présence dans ma liste de dépôts) avant tout appel à GitHub.

## Plan de réalisation

1. Initialiser le projet (`wrangler`, structure `src/` pour le Worker et `public/` pour la PWA).
2. Implémenter le Worker : authentification, `GET /api/repos`, `POST /api/issues`, gestion d'erreurs.
3. Construire la PWA : sélecteur, dictée, édition, envoi, manifeste, service worker.
4. Tester en local (`wrangler dev`) avec un dépôt de test.
5. Me guider pas à pas pour : créer le token GitHub fine-grained, générer l'`APP_TOKEN`, déclarer les secrets, déployer (`wrangler deploy`).
6. Installer l'app sur mon Android et valider le parcours complet.
7. Rédiger un `README.md` court : déploiement, rotation des tokens, dépannage.

## Évolutions possibles (hors périmètre initial)

- Mise en file hors ligne : stocker les notes sans réseau et les envoyer au retour de la connexion.
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
