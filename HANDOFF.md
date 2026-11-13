# Handoff — 2026-11-12 (points client 1 à 7, couleurs des écarts et sélecteur de produit)

Notes pour la personne (ou l'agent) qui reprend le projet. Instantané ponctuel, pas une
documentation permanente : **CLAUDE.md reste la référence technique** (architecture, pipeline,
conventions) ; ce fichier ne couvre que ce qui a changé récemment et ce qui reste ouvert. À
remplacer ou supprimer dès qu'il est périmé.

## État du dépôt

- Branche `main`, HEAD `00ae21f` (« Rename roles to commercial/expert », 2026-10-08), identique à
  `origin/main` d'après les références locales (pas de `git fetch` fait : non vérifié en ligne).
- Tout le travail ci-dessous est **non commité** (17 fichiers modifiés, 26 non suivis au
  2026-11-09). Par thème :
  - rattachement fournisseurs : migrations `20261106150000`, `20261106160000`, `20261106180000`,
    script `supabase/apply-2026-11-06-all-in-one.sql`, `SupplierMultiSelect`, `matching.server.ts`,
    `supplier-match.ts` ;
  - vue « Tous les rapprochements » : `ProspectMatchingView`, `line-actions.ts`,
    `use-line-actions.ts`, `matching-view.ts`, `use-ozego-comparison.ts`, routes `comparatifs.$id`
    et `factures.$id` ;
  - identifiant Ozego et conditionnement : `ozego.ts`, `ozego-key.ts`, `pack.ts`, `PackFactorInput` ;
  - lecture paginée : `paginate.ts` (`fetchAllRows`) ;
  - tests et outillage : `src/lib/*.test.ts`, `test-types/`, `tsconfig.test.json`, script `test` ;
  - docs et configuration : `CLAUDE.md`, `README.md`, `.claude/agents/*`, `.claude/settings.json`,
    `supabase/production-bootstrap.sql` (avertissement en tête), `types.ts` (édité à la main).

Mise à jour 2026-11-09 : le travail se fait sur la branche `develop` (HEAD `252fb3c`) ; `7c991f1`
est déjà poussé (voir l'incident des marqueurs de conflit plus bas). Les lots UX et Ozego ci-dessous
sont non commités : se fier à `git status`, pas à ce paragraphe.

Mise à jour 2026-11-12 : `develop` porte 3 commits locaux non poussés (`71b352d` correctif RLS Ozego,
`72af6e4` recherche par désignation dans le sélecteur, `918330b` prix à 3 décimales et colonne
Fournisseur) ; `origin/develop` contient encore le commit cassé `7c991f1`. Les sections « Convention
de couleur des écarts » et « Fournisseur dans le sélecteur » ci-dessous sont **non commitées**.

## Ce qui a changé dans ce cycle (points client 1 à 7)

1. **Fournisseurs de rattachement** à la création du comparatif : `prospects.matching_suppliers`,
   composant `SupplierMultiSelect`, `matchLines` restreint à ces fournisseurs (liste vide = pas de
   restriction).
2. **Étape « Ozego Même fournisseur » supprimée** ; les lignes validées à cette étape passent à
   `fournisseur` (migration `20261106160000`).
3. **Vue « Tous les rapprochements »** avec la colonne « Désignation fournisseur ».
4. **Conditionnement par défaut à 1** (`normalizePackFactor`, `src/lib/pack.ts`).
5. **Identifiant Ozego tronqué** pour les produits similaires : `ozego-key.ts`, RPC
   `cheapest_by_ozego_key` et `catalog_variants_by_ozego_key`.
6. **Rapprochement par référence corrigé** : `supplier-match.ts`, catalogue lu en entier par tranches.
7. **Vue de tous les rapprochements d'un comparatif** (`ProspectMatchingView`, `line-actions`) avec
   re-rapprochement de toutes les factures en lot.
8. **Sous-onglets de la vue projet** : « Comparatif référence fournisseur », « Ozego · Autres fournisseurs (moins cher) » et « Ozego · Fournisseurs préférés » dans `ProspectMatchingView`, mêmes tableaux, verrous et actions que la page facture (tableaux extraits dans `StageComparisonTable.tsx`, calculs dans `stage-rows.ts`, exports dans `stage-export.ts`) ; données Ozego chargées pour la page affichée seulement, totaux « de la page ».

Ajouts : tests `bun test` (7 fichiers dans `src/lib/`), et les correctifs issus des relectures :
rejeu de `processInvoice` limité aux factures en attente pour les non-experts, CHECK de 50
fournisseurs maximum, REVOKE/GRANT des RPC, `fetchAllRows` partout où une table peut dépasser 1000
lignes (synthèse du comparatif et RPC Ozego compris), invalidation des caches de lignes unifiée
(`invalidateLineCaches`, y compris suppression d'une facture et re-rapprochement en lot).

## Lots d'amélioration UX (2026-11-09, non commités)

- **Lot 1, sécurité des actions** : confirmations de suppression (`ConfirmDialog`,
  `ConfirmDeleteDialog`, messages dans `delete-messages.ts`) avec toast « Annuler » après
  suppression ; compteurs sur les onglets (`TabCount`, `tab-counts.ts`) ; bouton « Prochaine ligne à
  vérifier » (`NextToReviewButton`, `review-navigation.ts`, `use-review-navigation.ts`).
- **Lot 2, navigation** : onglets et filtres portés par l'URL (`search-params.ts`, source de vérité,
  liens partageables) ; fil d'Ariane (`CrumbText`) ; `SectionTabs` ; parcours guidé du comparatif
  (`ProspectStepper`, `stepper.ts`).
- **Lot 3, tableaux** : `DataTable` (`DataTableCard`, squelettes de chargement), colonnes figées et
  en-tête figé, densité confortable/compacte mémorisée (`table-density.ts`), bandes de statut à
  gauche des lignes, validation en lot (`BulkSelection`, `bulk-validate.ts`,
  `use-bulk-validation.ts`), enregistrement optimiste des champs (`optimistic-patch.ts`,
  `use-saved-indicator.ts`). Les styles sont dans le bloc `.data-table-scroll` de `src/styles.css`.
- Correctifs visuels du 2026-11-09 sur le tableau « Comparatif référence fournisseur » : case des
  lignes centrée (elle était rognée par la bande de statut de 4 px), colonne « Produit catalogue »
  d'au moins 15 rem et mention courte « Rapproché par libellé » (phrase complète en info-bulle).
  Non exercé dans un navigateur.

## Prix à 3 décimales et colonne « Fournisseur » (2026-11-09)

- **3 décimales sur tous les prix** : `euro()` (`src/lib/format.ts`, constante `PRICE_DIGITS`) affiche
  toujours 3 décimales (PU, totaux, écarts, cartes de synthèse). Le champ éditable « PU facturé »
  affiche aussi 3 décimales (`priceInput`) ; un champ non modifié n'est jamais réenregistré, pour que
  la valeur arrondie n'écrase pas la valeur exacte. Les pourcentages (écart %, remise) et les
  quantités ne changent pas.
- **Exports Excel** : les valeurs restent exactes, seul le format de cellule `0.000` est posé sur les
  colonnes de prix (`src/lib/xlsx-format.ts` : `formatPriceColumns`, `formatPriceRows`, `rowOf`).
  Une colonne est un prix si son en-tête contient PU, prix, total, écart, facturé ou meilleur, sans « % ».
  Un nouvel en-tête d'export doit respecter ce vocabulaire pour être formaté.
- **Colonne « Fournisseur » en premier** (nom du fournisseur de la facture, `SupplierCell`) dans tous les
  tableaux de lignes : les 3 comparatifs et « Rapprochements » de la vue projet, et les 5 onglets de la
  page facture. Sur les tableaux partagés elle est activée par la prop `supplierName`. La cellule
  « Facture » ne répète plus le fournisseur dans son sous-titre (rappelé dans l'info-bulle). Dans les
  exports, « Fournisseur (facture) » est la première colonne (page facture : « Fournisseur »).
- Vérifié sur les données réelles (Chrome) : vue projet (Rapprochements et Ozego autres fournisseurs),
  page facture (Récapitulatif, Achat client, Comparatif fournisseur). Les fichiers Excel n'ont pas été
  ouverts : seul le format de cellule est couvert par des tests.

## Recherche du crayon « Modifier la correspondance » (2026-11-10)

- `ProductPicker` (utilisé par la page facture et la vue projet) propose deux boutons sous le champ :
  « Référence fournisseur » et « Désignation fournisseur » (de la ligne), qui remplissent la
  recherche d'un clic. Le champ reste prérempli avec la référence, sinon la désignation.
- La recherche est faite par **mots** (`src/lib/picker-search.ts`) : un filtre `or` par mot (référence,
  libellé sans accent, EAN), tous les mots devant être présents. Avant, la phrase entière devait être une
  sous-chaîne exacte, et une virgule dans la saisie cassait la requête (caractères `, ( ) " \ % *` retirés).
- Si aucun produit ne contient tous les mots (au moins 2), repli sur le RPC `search_catalog` (similarité,
  classé par score ; produits actifs seulement, sans famille). Vérifié dans Chrome sur la ligne « EPINARD
  HACHE GALET IQF BIO ST2.5KG X2 » : 0 résultat auparavant, maintenant le produit 77004 en 4e position.

## Fournisseur dans le sélecteur de produit (2026-11-12, non commité)

- Chaque résultat de `ProductPicker` affiche à gauche le **fournisseur du produit du catalogue**
  (`catalog_products.supplier_name`, 7 rem, tronqué, nom complet en info-bulle).
- La recherche trouve aussi par fournisseur : `supplier_name` est ajouté au filtre `or` de
  `tokenFilter` (« sysco saumon » fonctionne, chaque mot pouvant porter sur un champ différent). Le
  repli `search_catalog` (similarité) ne renvoie ni fournisseur ni famille : le sélecteur les relit par
  `id` pour les afficher.
- **Interprétation à confirmer** : « désignation fournisseur » du produit a été comprise comme le nom du
  fournisseur. Le catalogue n'a pas d'autre champ de ce type que `label` (déjà cherché) ; la désignation
  de la ligne de facture est déjà proposée en bouton sous le champ.
- Pas de nouvel index : `reference` n'en a déjà pas, le filtre `or` lit déjà la table entière.
- Pas exercé dans un navigateur.

## Convention de couleur des écarts (2026-11-12, non commité)

- **Écart = prix facturé − prix de référence.** Positif (on paie plus que la référence, donc économie
  possible) : **vert**. Négatif (perte) : **rouge**. Nul ou absent : sans couleur. Tout passe par
  `gapTone`, `gapTextClass` et `gapStatTone` dans `src/lib/format.ts` (inverser la convention = un
  seul test à changer). Appliquée aux colonnes d'écart, pieds de tableau, cartes de synthèse, fond des
  lignes hors tolérance (`data-out="gain|loss"`, `src/styles.css`), tableau Général et listes de
  `comparatifs.$id.tsx` (renommées « Plus fortes économies possibles » et « Lignes déjà moins chères que
  le catalogue »). Sur une ligne du tableau Général, une perte prime sur une économie pour le fond.
- **Pourcentage affiché en signe inverse** (`gapPercentLabel`) : économie = « − », perte = « + ». Le
  pourcentage est calculé par rapport à la **référence** (12,537 € contre 8,350 € : +50,1 % brut, affiché
  −50,1 %) ; par rapport à la facture ce serait 33,4 %. Affichage seulement : tolérance, anomalies et
  exports Excel (« Écart % ») gardent le signe brut, donc l'écran et Excel diffèrent.
- **Totaux de pied cohérents** : « Facturé − Meilleure offre = Écart » sur les mêmes lignes. Sous les
  colonnes Ozego, le facturé vient de `sumOzegoGaps` / `sumPreferredGaps` (lignes comparées dans
  l'étape) et non du catalogue (`sumReferencePrices`). Nouvelle cellule « Facturé (lignes comparées) »
  sur la page facture.
- Contrôle de calcul sur la ligne saumon : 12,537 vs 8,350, quantité 40 → écart unitaire 4,187, total
  167,480, +50,14 %. Le produit apparié est en 130-160 g contre 150/350 g facturés : calibre
  possiblement faux, à vérifier.
- Non fait : libellé Excel « Lignes déjà compétitives » inchangé ; couleurs non vérifiées dans un navigateur.

## Performance Ozego (2026-11-09)

- **Migrations** : `20261109100000_fix_ozego_key_rpcs_timeout.sql` (réécriture de
  `cheapest_by_ozego_key`, `variants_count` calculé une seule fois, `ozego_similar_key` en STRICT
  pour que l'index partiel serve) et `20261109110000_ozego_similar_key_inlinable.sql` (fonction de
  clé sans `SET` ni STRICT donc inlinable, index remplacé, `ANALYZE`). Elles sont les **étapes 4 et 5**
  du script unique `supabase/apply-2026-11-06-all-in-one.sql`, qui contient maintenant 6 étapes (la
  6e reprend `20261110100000_ozego_key_rpcs_security_definer.sql`, voir plus bas).
  Le remplacement de l'index ne supprime l'ancien qu'après construction du nouveau (`_new`, puis
  renommé), sous `lock_timeout` de 10 s : aucun `DROP` ne laisse la table sans index.
- **Mesures** : en local, `cheapest_by_ozego_key` passe de 151 s à 18 ms pour 121 clés. En ligne,
  avant la seconde migration : 0,9 à 1,3 s par appel (les fonctions à identifiant exact : 44 à
  180 ms). Après application de la seconde migration (2026-11-10, 3 passes) : `catalog_variants_by_ozego_key`
  ≈ 0,7 s, `cheapest_by_ozego_key` ≈ 0,7 à 0,8 s (2,5 s à froid), contre 47 à 94 ms pour
  `catalog_variants_by_ozego`. Cause **confirmée** par `EXPLAIN ANALYZE` de la même requête : 20 ms
  (451 blocs) sans RLS contre 4 038 ms (40 941 blocs, lecture complète) sous le rôle `authenticated`.
  `catalog_products` est sous RLS (`expert_all_catalog_products`, `USING is_expert()`) et `btrim`,
  `substr`, `ozego_similar_key` ne sont pas « leakproof » : l'index sur expression n'est jamais utilisé
  par l'application. Correctif `20261110100000_ozego_key_rpcs_security_definer.sql` : les deux
  fonctions à clé passent en `SECURITY DEFINER` avec la garde `WHERE public.is_expert()` (même
  visibilité que la politique ; un appelant `service_role` sans JWT recevrait un résultat vide).
  Une colonne générée `ozego_key` a été écartée : elle réécrirait la table et reconstruirait les index
  HNSW et GIN sous verrou exclusif. **Mesuré après application (2026-11-10, 4 passes)** :
  `catalog_variants_by_ozego_key` 48 à 94 ms, `cheapest_by_ozego_key` 41 à 71 ms (185 ms au premier
  appel), même nombre de lignes qu'avant ; 10 clés en 49 à 88 ms. Non testé : le comportement d'un
  compte `commercial` (résultat vide attendu, comme avec la politique).
- **Côté client** : une seule lecture Ozego par écran. `useOzegoComparison` ne demande plus que les
  variantes (`catalog_variants_by_ozego_key`, plus `catalog_variants_by_ozego` pour les identifiants
  sans point) et déduit `bestByOzego` (`bestByOzegoFromVariants`, `src/lib/ozego.ts`) : prix le plus
  bas, à égalité le plus petit `id`, comme le SQL. Les RPC `cheapest_by_ozego*` restent en base mais
  le client n'y touche plus. Écart assumé : `variants_count` (export « Références du groupe »)
  compte maintenant les offres **avec prix** du groupe ; l'ancienne RPC comptait aussi les offres
  actives sans prix. Résultat mis en cache 5 minutes par ensemble d'identifiants (clé triée), et
  invalidé après une synchronisation du catalogue.
- `fetchAllRows` ne fait plus de requête pour constater une page vide : voir la règle `max-rows`
  plus bas.

## À faire / ouvert

- **Timeout et lenteur Ozego** : réglés. `20261109100000`, `20261109110000` et
  `20261110100000` sont appliquées en ligne (appels à clé tronquée : 40 à 95 ms ; voir « Performance
  Ozego »). Reste à vérifier l'écran « Ozego » lui-même avec un compte `commercial`.
- **Export final au format du fichier LBN (2026-11-12, fait, non commité, jamais ouvert dans Excel)** :
  bouton « Export final (n) » de la vue projet (`ProspectMatchingView`, applique les filtres en cours).
  `src/lib/lbn-export.ts` (générateur pur, exceljs chargé à la demande) part du modèle nettoyé
  `src/assets/lbn-template.xlsx` (styles, logo, fusions, rouge/vert conditionnel du fichier client, SANS
  donnée client), fabriqué par `bun scripts/build-lbn-template.ts "<fichier client>.xlsx"`.
  `lbn-input.ts` prépare les données ; `lbn-layout.ts` porte les noms de feuilles (ceux du fichier
  d'origine, que ses XLOOKUP citent : « 2026,10 OZ al », « Prix le -cher »).
  - Feuille « Comparatif alimentaire » : récurrence fournisseur (`COUNTIF`), bloc Achats clients
    (PU `=prix/coef`, Qtés `=qté*coef`, CA), bloc milieu = produit rapproché par référence (XLOOKUP vers
    « 2026,10 OZ al »), bloc droite = meilleure offre du groupe Ozego (XLOOKUP vers « Prix le -cher »),
    écarts `(prix Ozego − prix client) / prix client` (négatif = économie, vert), totaux, économie, tableau
    « produits non référencés ». Valeurs de formules mises en cache, recalcul complet à l'ouverture.
  - Les deux feuilles de recherche ne contiennent que les produits utilisés (choix de l'utilisateur) ;
    une référence ou un nom en double les rend ambigus : la cellule est alors écrite en valeur.
  - Écarts avec le fichier d'origine : la cellule M« total+1 » (7780.21 saisi à la main) est une formule
    (CA du client sur les lignes qui ont un prix Ozego) ; le bloc de droite compare sur les lignes qui ont
    une offre ; produit sans prix = « Hors Mercuriale » en rouge ; les 5 feuilles masquées par fournisseur
    ne sont pas reproduites ; lignes triées par CA décroissant.
  - Données absentes de l'application : « Désignation fournisseur » de l'offre (remplacée par le nom
    Ozego, `catalog_products.label`), unité de négo (champ `unit` du catalogue, ignoré s'il est
    numérique), coefficient du catalogue (remplacé par le coefficient de la ligne de facture).
  - À faire : ouvrir un export dans Excel (XLOOKUP, styles, logo, mise en forme conditionnelle) ; ne PAS
    committer le fichier client `2026 10 09 - LBN … .xlsx` (données réelles, dépôt public).
- **Migrations** : coller `supabase/apply-2026-11-06-all-in-one.sql` dans le SQL Editor de Supabase.
  Ordre : script **avant** le déploiement du code. Son étape 3 (« Même fournisseur ») n'est sûre
  qu'après déploiement, ou si l'ancienne page n'est plus utilisée. Déjà appliqué ? **Non vérifié.**
- Régénérer `src/integrations/supabase/types.ts` (édité à la main pour `matching_suppliers` et les RPC).
- Relancer « Re-rapprocher toutes les factures » après le déploiement.
- **Décisions en attente** :
  - fichiers de factures réelles suivis par git dans un dépôt public : `Scan17-03-2026-131022.pdf`,
    `sysco 2.jpg`, `testfiles/*.jpg`, `*-results.json`, `comparatif-Montval…xlsx` ;
  - permissions de `.claude/settings.json` jugées trop larges par une relecture ;
  - saisie vide du facteur de conditionnement : elle écrase une valeur réelle par 1 ;
  - `bun test` absent de la CI (`.github/workflows/ci.yml` lance tsc, lint, build) ;
  - favicon manquant.
- **Dette** :
  - le parsing de `syncCatalogFromErp` devrait vivre dans `catalog.server.ts` ;
  - `supabase/production-bootstrap.sql` est périmé (avertissement en tête) ;
  - le `project_id` de `supabase/config.toml` ne correspond pas au projet Supabase en ligne de
    `.env` (ne **pas** écrire l'identifiant réel dans le dépôt, qui est public) ;
  - lectures non paginées jugées sûres en pratique, à reconsidérer si les volumes changent : liste
    des comparatifs (`index.tsx`), lignes d'une seule facture (`factures.$id.tsx`,
    `runInvoiceRematch`).
- L'étape « Valider » de la vue projet est alignée sur la page facture (`match_status !== "confirmed"`).
- Pas exercé dans un navigateur : le branchement des routes n'est couvert que par `tsc` et le build.

## Travaux antérieurs déjà sur develop (commit efa5ce9, octobre 2026)

14. **Test comparatif Claude vs Gemini** (2026-10-16, aucune modif de prod): script
    `scripts/compare-extraction.ts` (`bun run compare:extraction <fichiers> --out x.json`), SDK
    `@anthropic-ai/sdk` en devDependency, `ANTHROPIC_API_KEY` dans `.env`. Sur 5 vraies factures
    (`testfiles/`): Haiku 5.5 et Opus 5.5 lisent les 10 lignes de Scan17 (total 1679.26), Sonnet 5.5
    n'en lit que 5 (total 803.73, auto-cohérent mais faux) -> le critère "somme des lignes = total
    imprimé" ne détecte pas une page oubliée. Haiku 5.5: ~0,0015 $/facture (≈ Gemini), mais
    invoice_number null sur Scan17. Gemini a répondu 503 sur les 5 fichiers (pas de comparaison
    directe). Relancé le 2026-10-19: Gemini OK sur les 5 (lignes identiques à Haiku, mais total_ht
    null sur Scan17), ~0,0014 $/facture (7455 tokens in, 3370 out; tarif 0,25/1,50 $ par M) contre
    ~0,0015 $ pour Haiku 5.5; Gemini ~5,8 s vs ~9,6 s. Décision de migration non prise.

15. **Messages d'erreur lisibles** (2026-10-20): `src/lib/errors.ts` (`friendlyError`) traduit toute
    erreur technique (JSON Gemini 503, erreurs Supabase/RLS, réseau...) en phrase française;
    `src/lib/toast-error.ts` (`toastError`) l'affiche en toast sonner en haut à droite (avec bouton
    fermer) et remplace tous les `toast.error(error.message)`. `invoices.server.ts` stocke maintenant un
    message lisible dans `invoices.error_message` (détail brut dans les logs serveur) et la liste des
    factures applique aussi `friendlyError` (anciennes lignes en base contiennent encore le JSON brut).
    Pages 404/erreur traduites en français. Décision: on reste sur Gemini (test Claude abandonné,
    script `compare:extraction` conservé).

## Choses à savoir avant de toucher

- **Pas de ligne co-auteur Claude dans les commits** (consigne permanente). L'utilisateur
  (`jack0237`) commite et pousse lui-même ; vérifier `git log` et `git status` avant de croire
  qu'un correctif manque.
- **Les migrations ne s'appliquent pas depuis Claude** (ni jeton Supabase ni mot de passe de base
  ici). Donner le SQL exact à coller dans le SQL Editor, pas seulement « lancer la migration ».
- `supabase/migrations/20260824094934_*.sql` contient une faute de syntaxe connue et voulue : ne
  pas y toucher (voir CLAUDE.md, « Local database »).
- `.claude/settings.local.json` et `.env` contiennent des secrets : ne jamais les commiter ni les
  recopier.
- **Ne pas installer `@types/bun`** : `unplugin` le résout aussi et casse le typage de `fetch`.
  Les types de test sont dans `test-types/bun-test.d.ts`.
- La machine de développement a 8 Go de RAM : la pile Supabase locale Docker (~11 conteneurs) a
  fait tuer le serveur de dev par manque de mémoire. Préférer le Supabase en ligne via `.env`
  (attention : `.env.local` prend le pas sur `.env`).
- **`max-rows` mesuré = 1000 sur la production le 2026-11-09** (une demande `.range(0, 4999)` sur le
  catalogue de 17 782 produits renvoie 1000 lignes). Règle : toute lecture d'une table qui peut
  dépasser 1000 lignes passe par `fetchAllRows` (`src/lib/paginate.ts`) avec un `.order(...)`
  déterministe ; cela vaut aussi pour les RPC ensemblistes. `fetchAllRows` s'arrête à la première page
  de moins de `pageSize` lignes (borné à 1000), sans requête de fin : si le plafond serveur baissait
  un jour sous 1000, une page tronquée serait prise pour la dernière et les lectures seraient
  incomplètes sans erreur. Il faudrait alors baisser `POSTGREST_MAX_ROWS` en même temps.
  `catalog.server.ts` utilise désormais ce même `fetchAllRows` (l'erreur Supabase y est propagée).
- **Incident du 2026-11-09** : des marqueurs de conflit de fusion (`<<<<<<<`) ont été commités et
  poussés sur `develop` (`7c991f1`), puis corrigés localement. Bonne pratique : lancer
  `git diff --check` (et `grep -rn "^<<<<<<< " src`) avant chaque commit.
