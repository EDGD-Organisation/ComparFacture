# Comparateur de factures fournisseurs

Oui, c'est parfaitement viable. L'application extrait les lignes de produits d'une facture (PDF texte ou scan), les rapproche automatiquement du catalogue de référence, affiche l'écart de prix ligne par ligne, et permet de corriger ou de créer chaque rapprochement à la main.

## Parcours utilisateur

1. **Import d'une facture** — glisser-déposer un PDF (texte ou scanné) ou une photo. Le fichier est stocké et analysé.
2. **Extraction** — l'IA lit le document et renvoie l'en-tête (fournisseur, numéro, date, total) et les lignes : référence, libellé, quantité, prix unitaire, remise, total ligne.
3. **Rapprochement automatique** — pour chaque ligne, trois passes successives :
   - référence fournisseur exacte → match certain,
   - similarité textuelle sur le libellé → match probable avec score,
   - recherche sémantique IA (embeddings) → meilleur candidat + score de confiance.
     Chaque ligne reçoit un statut : `Confirmé`, `À vérifier`, `Non trouvé`.
4. **Écran de comparaison** — tableau par ligne : produit facture / produit catalogue / prix facture / prix catalogue / écart en € et en % / statut. Les écarts défavorables sont mis en évidence, avec un seuil de tolérance paramétrable.
5. **Correction manuelle** — sur chaque ligne : bouton « Modifier le rapprochement » ouvrant une recherche dans le catalogue (par référence, libellé, EAN), sélection du bon produit, ou marquage « Aucun équivalent ». Le choix est mémorisé.
6. **Apprentissage** — chaque correction manuelle enregistre une correspondance `référence fournisseur → produit catalogue`, réutilisée automatiquement sur les factures suivantes du même fournisseur.
7. **Synthèse & export** — total facturé vs total catalogue, montant d'écart global, nombre de lignes hors tolérance, export CSV/Excel.

## Catalogue produits (ERP externe)

Le catalogue vient d'une API externe. Comme les détails de cette API ne sont pas encore connus, la première version prévoit :

- une couche de synchronisation isolée : un connecteur qui récupère les produits (référence, libellé, EAN, prix, unité) et les stocke en base locale pour la recherche et le comparatif ;
- un import CSV/Excel comme source de secours et pour démarrer immédiatement les tests ;
- un bouton « Synchroniser le catalogue » avec date de dernière synchro.

Il faudra ensuite fournir l'URL de l'API, le mode d'authentification et un exemple de réponse pour brancher le connecteur réel.

## Écrans

- **Accueil / Factures** — liste des factures traitées avec statut, montant, écart total.
- **Détail facture** — document à gauche, tableau des lignes rapprochées à droite.
- **Catalogue** — liste consultable/cherchable des produits, état de la synchronisation, import de fichier.
- **Réglages** — seuil de tolérance, gestion des correspondances mémorisées.

## Détails techniques

- Backend Lovable Cloud (base de données + stockage des fichiers). Tables : `suppliers`, `invoices`, `invoice_lines`, `catalog_products`, `product_mappings` (correspondances apprises), `catalog_sync_runs`.
- Extraction : le PDF/l'image est envoyé à un modèle multimodal via Lovable AI avec sortie structurée (schéma JSON strict). Cela couvre à la fois les PDF texte et les scans, sans pipeline OCR séparé.
- Similarité texte : normalisation (accents, casse, ponctuation) + trigrammes Postgres (`pg_trgm`) pour le rapprochement flou sur libellé.
- Recherche sémantique : embeddings des libellés catalogue stockés dans `pgvector`, recalculés à la synchro ; la ligne de facture est embarquée puis comparée en distance cosinus.
- Score de confiance combiné (référence > trigramme > sémantique) et seuils : au-dessus de X → confirmé, entre X et Y → à vérifier, en dessous → non trouvé.
- Toute la logique serveur passe par des server functions ; les clés API restent côté serveur.
- Pas d'authentification pour cette version (usage personnel).

## Hors périmètre pour cette première version

- Multi-utilisateurs et gestion des droits.
- Validation/rejet de factures avec workflow d'approbation.
- Écriture en retour dans l'ERP.
