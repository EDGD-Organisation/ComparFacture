# Comparateur de factures fournisseurs (comparateur test Ozego)

Application web qui permet, pour un prospect donné, d'importer ses factures fournisseurs
(PDF/scan), d'en extraire automatiquement les lignes via IA, de les rapprocher d'un catalogue de
référence, puis de comparer le prix facturé au prix catalogue et au meilleur prix connu pour le
même produit (identifiant Ozego), y compris chez le même fournisseur, tous fournisseurs confondus,
ou seulement chez les fournisseurs préférés du prospect.

Application TanStack Start adossée à un projet Supabase ; ce dépôt fonctionne aussi en
développement **100 % local** grâce à Docker (voir plus bas).

## Sommaire

1. [Prérequis](#1-prérequis)
2. [Installation des dépendances](#2-installation-des-dépendances)
3. [Configuration des variables d'environnement](#3-configuration-des-variables-denvironnement)
4. [Base de données locale (Docker)](#4-base-de-données-locale-docker)
5. [Lancer l'application](#5-lancer-lapplication)
6. [Scripts disponibles](#6-scripts-disponibles)
7. [Aperçu des fonctionnalités](#7-aperçu-des-fonctionnalités)
8. [Aperçu de l'architecture](#8-aperçu-de-larchitecture)
9. [Dépannage](#9-dépannage)
10. [Ressources utiles](#10-ressources-utiles)

## 1. Prérequis

| Outil                                                             | Version | Pourquoi                                                                              |
| ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| [Bun](https://bun.sh)                                             | ≥ 1.4   | Gestionnaire de paquets et runtime utilisé par le projet (`bun.lock`, `bunfig.toml`). |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | récente | Fait tourner la stack Supabase locale (Postgres, Auth, Storage, Studio…).             |
| [Git](https://git-scm.com/)                                       | récente | Cloner le dépôt.                                                                      |

Node.js n'est pas strictement nécessaire (Bun fait tout), mais `npm i` / `npm run <script>`
fonctionnent aussi si vous préférez npm — tous les scripts de `package.json` sont compatibles.

Testé avec Bun 1.4.0 et Node 22.17.1.

## 2. Installation des dépendances

```sh
git clone <url-du-depot>
cd "Invoice Matcher"
bun install
```

`bunfig.toml` impose un délai de sécurité de 24h sur les nouvelles versions de paquets
(`minimumReleaseAge`) — normal si `bun install` semble ignorer une version toute fraîche d'un
paquet, ce n'est pas une erreur.

## 3. Configuration des variables d'environnement

Le projet lit deux fichiers à la racine, avec `.env.local` prioritaire sur `.env` :

- **`.env.local`** — à créer vous-même pour le développement local. Une fois rempli, il **prend le
  pas sur `.env`** tant qu'il existe (pratique pour basculer entre stack locale et distante).
- **`.env`** — configuration par défaut / distante (le projet Supabase de production), si
  `.env.local` n'existe pas.

Ni l'un ni l'autre n'est suivi par Git (`.env` est ignoré explicitement, `.env.local` par le motif
`*.local`).

### Variables nécessaires

| Variable                                                     | Où l'obtenir                                                                                      | Obligatoire en local ?                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `SUPABASE_URL` / `VITE_SUPABASE_URL`                         | Sortie de `bunx supabase status` une fois la stack locale démarrée (§4)                           | Oui                                                      |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Idem                                                                                              | Oui                                                      |
| `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID`           | Idem (référence du projet, voir `supabase/config.toml`)                                           | Oui                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`                                  | Idem (clé service-role, ne jamais exposer côté client)                                            | Oui, pour les fonctions serveur admin                    |
| `GEMINI_API_KEY`                                             | [Google AI Studio](https://aistudio.google.com/) — clé API directe (pas de passerelle intermédiaire) | **Oui** — sans elle, l'extraction IA des factures échoue |
| `COMPARATIF_API_KEY`                                         | Fournie par le backend ERP externe ("oze-back") si vous synchronisez le catalogue depuis leur API | Non (seulement pour la synchro catalogue automatique)    |

Exemple de `.env.local` minimal une fois la stack Docker démarrée :

```env
SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
SUPABASE_PROJECT_ID="<project_ref de supabase/config.toml>"
VITE_SUPABASE_PROJECT_ID="<project_ref de supabase/config.toml>"
SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
GEMINI_API_KEY="<votre clé Google AI Studio>"
```

## 4. Base de données locale (Docker)

Le développement local n'utilise **pas** le projet Supabase distant (production) mais une stack
Postgres complète tournant dans Docker sur votre machine.

### Démarrage

1. **Lancer Docker Desktop** et attendre qu'il soit prêt (`docker ps` doit répondre sans erreur).
2. Démarrer la stack :
   ```sh
   bunx supabase start
   ```
   La première exécution télécharge les images Docker et rejoue toutes les migrations de
   `supabase/migrations/` — ça peut prendre quelques minutes. Les suivantes sont rapides.
3. La commande affiche un JSON avec toutes les URLs et clés locales (`DB_URL`, `API_URL`,
   `PUBLISHABLE_KEY`, `SERVICE_ROLE_KEY`…) — reportez-les dans `.env.local` (§3). Vous pouvez
   réafficher ces informations à tout moment avec :
   ```sh
   bunx supabase status
   ```
4. Studio (interface d'administration de la base, façon phpMyAdmin) est disponible sur
   [http://127.0.0.1:54323](http://127.0.0.1:54323).

### Arrêt

```sh
bunx supabase stop
```

Les données persistent dans un volume Docker entre deux arrêts/démarrages. Pour repartir d'une
base vierge : `bunx supabase stop --no-backup`.

### Particularités à connaître

- **Service `vector` en crash-loop sur Windows** : le conteneur de collecte de logs (sans rapport
  avec l'extension `pgvector` utilisée pour la recherche sémantique) peut boucler en erreur
  "Network unreachable" à cause de l'accès au socket Docker. Sans conséquence sur le
  fonctionnement de l'app (l'onglet Logs de Studio reste juste vide) — on peut l'ignorer, le
  supprimer (`docker rm -f supabase_vector_<project_ref>`), ou démarrer sans lui
  (`bunx supabase start -x vector`).
- **Une migration historique volontairement non corrigée** : `supabase/migrations/20260824094934_*.sql`
  contient une faute de syntaxe SQL qui bloque le rejeu des migrations. Une migration corrective
  (`20260831101103_fix_prospects_status_check_constraint.sql`) la compense pour tout ce qui suit —
  ne modifiez jamais le fichier historique, ajoutez toujours une nouvelle migration corrective à la
  suite (voir les fichiers `2026083*` pour le modèle à suivre).
- **Erreur Windows "ports are not available" / "access forbidden by its access permissions"** au
  démarrage : voir la section [Dépannage](#9-dépannage).

## 5. Lancer l'application

Une fois les dépendances installées, `.env.local` rempli et la stack Docker démarrée :

```sh
bun run dev
```

Le serveur de développement (Vite) démarre sur [http://localhost:8080](http://localhost:8080)
(ou le premier port libre suivant si occupé — l'URL exacte s'affiche dans le terminal).

## 6. Scripts disponibles

| Commande                                                   | Effet                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run dev`                                              | Démarre l'application en mode développement (`vite dev`).                                                                                                                            |
| `bun run build`                                            | Build de production (`vite build`).                                                                                                                                                  |
| `bun run build:dev`                                        | Build en mode développement (utile pour déboguer un build).                                                                                                                          |
| `bun run preview`                                          | Sert le build de production en local.                                                                                                                                                |
| `bun run lint`                                             | ESLint sur tout le projet (inclut la vérification du formatage Prettier).                                                                                                            |
| `bun run format`                                           | Reformate tout le projet avec Prettier.                                                                                                                                              |
| `bun run multimodal:test <fichiers…> --out resultats.json` | Teste l'extraction IA (Gemini) directement sur des fichiers locaux (PDF/image), sans toucher à Supabase — utile pour juger la qualité d'extraction sur un nouveau format de facture. |

Il n'y a pas de suite de tests automatisés dans ce dépôt (pas de runner configuré).

## 7. Aperçu des fonctionnalités

- **Import et extraction de factures** : dépôt d'un PDF/scan, extraction automatique de l'en-tête
  et des lignes par IA multimodale (Google Gemini, envoi direct de l'image/PDF — pas d'étape OCR
  intermédiaire).
- **Rapprochement catalogue** : chaque ligne de facture est associée à un produit du catalogue via,
  dans l'ordre : correspondances déjà apprises, référence/EAN exacts, recherche lexicale
  (trigrammes Postgres), puis recherche sémantique (embeddings calculés localement, sans API
  externe).
- **Comparatif de prix** : écart entre le prix facturé et le prix catalogue, et entre le prix
  facturé et le meilleur prix connu pour le même groupe de produits (identifiant Ozego) — avec
  trois angles de comparaison possibles : même fournisseur, tous fournisseurs (le moins cher), ou
  seulement les fournisseurs préférés du prospect.
- **Synchronisation catalogue** : import manuel (CSV) ou automatique depuis une API ERP externe
  (réglages disponibles dans l'onglet "Réglages" de l'application).

## 8. Aperçu de l'architecture

- **Framework** : [TanStack Start](https://tanstack.com/start) (routage par fichiers dans
  `src/routes/`), React 19, Tailwind CSS, composants [shadcn/ui](https://ui.shadcn.com/).
- **Backend** : Supabase (Postgres + PostgREST + Auth + Storage), consommé via deux clients
  distincts — un client navigateur (clé publique) et un client serveur (clé service-role, jamais
  exposée au navigateur).
- **IA** : extraction de factures via l'API Gemini directe ; recherche sémantique via un modèle
  d'embedding local (`@huggingface/transformers`, aucune clé API requise).

Ce fichier couvre l'installation et le lancement ; pour le détail technique de l'architecture
(convention `*.server.ts` vs `*.functions.ts`, schéma de base de données, pipeline de
rapprochement…), voir [CLAUDE.md](CLAUDE.md) — rédigé pour l'assistance au développement, mais qui
reste la référence technique la plus à jour du projet.

## 9. Dépannage

**`docker ps` ne répond pas / timeout**
Docker Desktop n'est pas démarré ou pas encore prêt. Lancez-le et attendez quelques dizaines de
secondes avant de relancer `bunx supabase start`.

**Erreur au démarrage : `ports are not available: ... bind: An attempt was made to access a socket
in a way forbidden by its access permissions`** (Windows)
Problème réseau Windows classique après une mise en veille ou un redémarrage de Docker Desktop
(le service `winnat` retient une réservation de port périmée). Dans un terminal **PowerShell en
administrateur** :

```powershell
net stop winnat
net start winnat
```

Puis relancez `bunx supabase start`. Un redémarrage complet de Windows a le même effet si vous
préférez ne pas toucher au service directement.

**`bunx supabase start` échoue toujours après le correctif ci-dessus**
Essayez de quitter complètement Docker Desktop (pas juste arrêter les conteneurs) puis de le
relancer, avant de refaire `bunx supabase start`.

**L'extraction de facture échoue silencieusement**
Vérifiez que `GEMINI_API_KEY` est bien défini dans `.env.local` (ou `.env`) et correspond à une clé
valide de Google AI Studio.

**Le catalogue reste vide / les prix Ozego n'apparaissent jamais**
Le catalogue doit être importé au moins une fois (import manuel CSV ou synchronisation API ERP
depuis l'onglet Réglages) avant que les comparatifs aient des données à afficher.

## 10. Ressources utiles

- [Documentation TanStack Start](https://tanstack.com/start/latest)
- [Documentation Supabase CLI](https://supabase.com/docs/guides/local-development)
- [Google AI Studio](https://aistudio.google.com/) (clé `GEMINI_API_KEY`)
- [CLAUDE.md](CLAUDE.md) — référence technique détaillée du projet
