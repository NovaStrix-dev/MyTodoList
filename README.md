# Voice2Issue

Dicte une idée sur ton Android, choisis le dépôt, valide : une issue GitHub est créée.

- **PWA** (`public/`) : HTML/CSS/JS natifs, dictée `fr-FR` via Web Speech API, installable.
- **Worker Cloudflare** (`src/`) : `GET /api/repos`, `POST /api/issues`, protégé par `APP_TOKEN`.
- **Coût : 0 €.** Les fichiers de la PWA sont des « static assets » (gratuits, illimités). Seuls les appels `/api/*` comptent dans les 100 000 requêtes/jour du plan gratuit : 1 à l'ouverture de l'app + 1 par issue.

## 1. Créer le token GitHub (fine-grained)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Nom : `voice2issue`. Expiration : 1 an (note la date).
3. **Resource owner** : ton compte. **Repository access** : **All repositories**.
4. **Permissions → Repository permissions** → **Issues : Read and write**. (*Metadata : Read-only* s'ajoute tout seul.) Rien d'autre.
5. **Generate token**, garde la page ouverte pour l'étape 3.

## 2. Générer l'APP_TOKEN

Dans un terminal :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Enregistre cette valeur dans ton gestionnaire de mots de passe : tu la saisiras une fois sur le téléphone.

## 3. Déployer

```bash
npm install
npx wrangler login                 # ouvre le navigateur, autorise Cloudflare
npx wrangler deploy                # affiche l'URL https://voice2issue.<toi>.workers.dev
npx wrangler secret put GITHUB_TOKEN   # colle le token GitHub quand demandé
npx wrangler secret put APP_TOKEN      # colle l'APP_TOKEN quand demandé
```

Les secrets prennent effet immédiatement, pas besoin de redéployer.

**Optionnel :** crée un label `idée-vocale` dans les dépôts où tu veux le voir appliqué (Issues → Labels → New label). Sans ce label, l'issue est créée sans label.

## 4. Installer sur Android

1. Ouvre l'URL `https://voice2issue.<toi>.workers.dev` dans **Chrome**.
2. Saisis l'`APP_TOKEN` (depuis ton gestionnaire de mots de passe) → **Enregistrer**.
3. Menu **⋮** → **Ajouter à l'écran d'accueil** → **Installer**.
4. Ouvre l'app depuis l'icône, appuie sur le micro, **Autoriser** l'accès au micro.
5. Dicte, corrige si besoin, **Créer l'issue** → le lien vers l'issue s'affiche.

## Développement local

```bash
cp .dev.vars.example .dev.vars
npm run mock        # faux GitHub sur :8788 (terminal 1)
npm run dev         # Worker + PWA sur :8787 (terminal 2)
npm test            # tests unitaires + tests de bout en bout (terminal 3)
```

Pour tester contre le vrai GitHub sur un dépôt de test : dans `.dev.vars`, mets ton vrai `GITHUB_TOKEN` et supprime la ligne `GITHUB_API`. `.dev.vars` est ignoré par git.

## Rotation des tokens

- **GitHub** (avant expiration ou en cas de doute) : génère un nouveau token (étape 1), `npx wrangler secret put GITHUB_TOKEN`, puis supprime l'ancien sur GitHub.
- **APP_TOKEN** (si l'URL ou le téléphone est compromis) : génère une nouvelle valeur, `npx wrangler secret put APP_TOKEN`, puis dans l'app : **⚙ → Changer le jeton d'application**.

## Dépannage

| Symptôme | Cause probable / solution |
|---|---|
| « Jeton refusé » | `APP_TOKEN` différent de celui du Worker. Ressaisis-le. |
| « Token GitHub invalide ou expiré » | Régénère le token GitHub (rotation ci-dessus). |
| « GitHub refuse l'accès » | Permission *Issues : Read and write* manquante, ou dépôt hors du périmètre du token. |
| Dépôt absent de la liste | Bouton ↻ dans le sélecteur. Les dépôts archivés sont masqués volontairement. |
| « Micro refusé » | Chrome : icône à gauche de l'adresse → Autorisations → Micro → Autoriser. |
| La dictée s'arrête seule | Normal après ~3 silences consécutifs. Réappuie sur le micro. |
| « Pas de réseau » | Le texte est conservé sur le téléphone ; renvoie une fois connecté. |
| « Trop de requêtes » | Limite de 30 appels/minute par IP. Attends une minute. |
| `wrangler deploy` refuse le bloc `ratelimits` | Supprime ce bloc de `wrangler.jsonc` : le Worker bascule sur une limite en mémoire. |
| L'app n'affiche pas la nouvelle version | Ferme-la complètement et rouvre-la (le service worker se met à jour au lancement). |

## Sécurité

- Aucune clé dans le code ni dans le dépôt : `GITHUB_TOKEN` et `APP_TOKEN` sont des secrets Cloudflare.
- `APP_TOKEN` comparé en temps constant ; limitation de débit appliquée avant l'authentification.
- Le champ `repo` est validé (format `propriétaire/nom`) et doit figurer dans ta liste de dépôts avant tout appel de création.
- CSP stricte sur la PWA (`public/_headers`), réponses API en `no-store`.
- Si tu sers la PWA ailleurs (Cloudflare Pages) : renseigne `ALLOWED_ORIGIN` dans `wrangler.jsonc`, l'URL du Worker dans `<meta name="api-base">` de `index.html`, et ajoute cette URL au `connect-src` de `_headers`.
