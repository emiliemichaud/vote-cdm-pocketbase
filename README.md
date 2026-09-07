# vote-cdm - Application de Vote en Temps Réel

vote-cdm est une application web légère de vote interactif et en temps réel, conçue pour animer des séances, assemblées ou réunions. 
Elle a été réécrite pour fonctionner sans serveur Node.js ni MariaDB, afin d'être hébergée facilement sur **Cloudflare Pages**, en utilisant **PocketBase** comme backend (Base de données et temps réel).

## Tester en local (Docker)

Le projet contient tout ce qu'il faut pour lancer un environnement complet en local, incluant le frontend (servi par Caddy) et le backend (PocketBase).

1. Lancez l'environnement avec docker Compose (ou Docker Compose) :
   ```bash
   docker-compose up -d
   ```
2. **Backend (PocketBase)** : Allez sur `http://127.0.0.1:8090/_/` et créez votre premier compte Superuser.
   - Allez dans **Settings** > **Sync > Import collections**.
   - Collez le contenu du fichier `pb_schema.json` et validez (compatible avec PocketBase v0.23+).
3. **Frontend (Site web)** : Allez sur `http://localhost:8788`. Tout est fonctionnel, y compris les liens de vote courts !

##  Déploiement en Production

### 1. Hébergement Frontend (Cloudflare Pages)

Ce dépôt contient uniquement le code frontend (dossier `public/`) qui peut être directement déployé sur Cloudflare Pages.
1. Connectez ce dépôt GitHub à Cloudflare Pages.
2. Paramétrez le **Framework preset** sur `None`.
3. Le **Build output directory** (répertoire de sortie) doit être réglé sur `public`.

Le fichier `public/_redirects` inclus s'occupera d'orienter les routes dynamiques (ex: `/ABCD5`) vers `vote.html`.

### 2. Backend (PocketBase)

L'application communique directement avec une instance PocketBase.
Vous devez configurer votre propre instance (par exemple sur un VPS, ou via pockethost.io).
1. Démarrez votre instance PocketBase.
2. Rendez-vous dans le panneau d'administration (Admin UI) -> `Settings` -> `Sync` -> `Import collections`.
3. Copiez-collez le contenu du fichier `pb_schema.json` fourni et importez-le.
4. Les collections `sessions` et `votes` seront créées avec les règles d'accès adéquates.

### 3. Configurer l'URL du Backend pour le Frontend

Dans vos fichiers HTML (`public/index.html`, `public/host.html`, et `public/vote.html`), mettez à jour l'URL de votre instance PocketBase de production :
```html
<script>
  // CHANGEZ CETTE URL VERS VOTRE INSTANCE POCKETBASE EN PRODUCTION
  window.POCKETBASE_URL = "https://pb.votre-domaine.com";
</script>
```

## Architecture et Fichiers Clés

Voici la structure des fichiers les plus importants du projet :

```text
vote-cdm/
├── public/                 # Dossier racine pour Cloudflare Pages
│   ├── _redirects          # Gère le routage des liens de vote (ex: /ABCD5)
│   ├── index.html          # Page d'accueil (Créer ou rejoindre)
│   ├── host.html           # Tableau de bord de l'organisateur
│   ├── vote.html           # Interface de vote du participant
│   ├── app.js              # Initialisation de PocketBase et fonctions communes
│   ├── host.js             # Logique d'administration et d'affichage des résultats
│   ├── vote.js             # Logique de participation et soumission des votes
│   └── typ/                # Modèles Typst pour la génération de PDF
├── pb_hooks/               # Scripts serveur PocketBase (Cron jobs)
│   └── cleanup.pb.js       # Script de nettoyage automatique (15 heures)
├── pb_schema.json          # Structure de la base de données (voir détails ci-dessous)
├── compose.yaml            # Fichier de lancement local docker/Docker
└── Caddyfile               # Configuration du serveur web local (émule Cloudflare)
```

### La Base de Données (`pb_schema.json`)

Ce fichier contient la déclaration des trois tables (collections) utilisées par l'application sur PocketBase :

1. **`sessions`** : Gère les instances de vote créées par les organisateurs.
   - Contient le code d'invitation (ex: `ABCD5`), l'état actuel (`idle`, `voting`, `results`, etc.), et la clé secrète de l'organisateur (`hostSecret`) qui sécurise les actions d'administration de la session.
2. **`votes`** : Stocke les bulletins déposés.
   - Chaque vote est lié à une session. Il contient l'identifiant unique et anonyme du votant (`voterId`) pour bloquer le double vote, et son choix (`pour`, `contre`, `abstention`).
3. **`presence`** : Gère le compteur de personnes en ligne.
   - Les participants actifs y enregistrent silencieusement leur présence toutes les 10 secondes. Le tableau de bord de l'organisateur écoute cette table et compte le nombre de personnes ayant mis à jour leur présence récemment.
4. **`history`** : Sauvegarde permanente de l'historique des votes.
   - À chaque fois qu'un vote est "Relancé", l'application supprime les bulletins individuels (`votes`) pour faire place nette, mais sauvegarde au préalable un résumé global (nombre de pour, contre, abstention) dans cette table. C'est elle qui permet de générer le PDF de fin de séance avec l'intégralité des tours de vote !

*(Astuce : Pour arrêter l'environnement de test local, lancez `docker-compose down -v` dans le terminal).*

### 💡 Comment fonctionne le compteur de présence en temps réel ?

Puisque l'application n'utilise plus de serveur Node.js ni de connexions WebSocket persistantes via *socket.io*, le système de présence a été astucieusement réécrit pour être 100% serverless :

1. **Connexion immédiate** : Dès qu'un votant ouvre la page, une ligne est instantanément créée dans la table `presence`. PocketBase envoie un évènement "Création", et le compteur de l'organisateur s'incrémente en temps réel.
2. **Déconnexion propre** : Quand le votant ferme son onglet, le navigateur intercepte la fermeture (`beforeunload`) et demande la suppression de sa ligne. PocketBase déclenche un évènement "Suppression" et le compteur baisse en temps réel.
3. **Le "Ping" de sécurité** : Si le votant perd brusquement internet (empêchant la déconnexion propre), son appareil ne pourra plus s'annoncer. Or, l'application est conçue pour envoyer un ping toutes les 10 secondes (mettant à jour le champ `updated`). De son côté, le tableau de bord de l'organisateur ignore automatiquement tous les pings plus vieux de 15 secondes. Ainsi, les "fantômes" disparaissent naturellement du compteur au bout de quelques secondes !

*(Note : Pour bénéficier de la suppression automatique des vieilles sessions, copiez également le dossier `pb_hooks` à côté de l'exécutable PocketBase de votre serveur).*
