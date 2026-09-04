# vote-cdm - Application de Vote en Temps Réel
vote-cdm est une application web légère de vote interactif et en temps réel, conçue pour animer des séances, assemblées ou réunions. Elle offre une interface d'administration pour piloter les votes et une interface simple pour les participants.


## Installation

```bash
mysql -u root -p -e "CREATE DATABASE votecdm CHARACTER SET utf8mb4;"
mysql -u root -p votecdm < sql/schema.sql
cp .env.example .env   # renseigner les id MariaDB
npm install
```

### Le fichier `.env` doit être déployé à la main

Le fichier `.env` (avec les identifiants MariaDB remplis) doit être physiquement présent sur le VPS, dans le même dossier que `server.js`, avant de lancer `pm2 start ecosystem.config.js`. 
Ne pas oublier de le créer ou le copier à la main sur le serveur, séparément du reste du code.

### Comment vérifier avant l'événement

Sur le VPS, avant `pm2 start` :

```bash
ls -la /chemin/vers/vote-cdm/.env
cat /chemin/vers/vote-cdm/.env
```

Vérifie que le fichier existe et contient bien tes vraies valeurs (pas `changeme`). Et après avoir démarré, `pm2 logs vote-cdm` doit afficher `vote-cdm démarré sur http://localhost:3000` sans erreur juste après.

## Lancement en production

Ne pas lancer avec `npm start` en direct pour un événement public — utiliser un superviseur qui redémarre le process automatiquement en cas de crash.

**Avec PM2**  :
```bash
# 1. Installer PM2 globalement (une seule fois sur le serveur)
npm install -g pm2
# 2. Dans le dossier du projet :
npm install
# 3. Démarrer l'appli via PM2
pm2 start ecosystem.config.js
# 4. Faire en sorte que PM2 redémarre vote-cdm automatiquement si le VPS reboote
pm2 startup
# (cette commande affiche une ligne à copier-coller et exécuter avec sudo —
#  c'est elle qui enregistre PM2 comme service système au démarrage)
pm2 save
```


### Piloter au quotidien pendant l'événement

- `pm2 logs vote-cdm` — suivre les logs en direct (utile pour repérer un problème en temps réel le jour J)
- `pm2 status` — voir en un coup d'œil si le process tourne, depuis combien de temps, combien de fois il a redémarré
- `pm2 restart vote-cdm` — redémarrage manuel si besoin (par exemple après avoir modifié le `.env`)
- `pm2 monit` — vue en direct de la CPU/RAM consommée, pratique pour surveiller pendant les pics de connexions



## Structure

- `server.js` — Express (sert `public/`) + Socket.io + route `/CODE` (remplace le trick `404.html` de GitHub Pages)
- `db.js` — pool MariaDB
- `sockets/handlers.js` — logique métier : créer/rejoindre/voter/piloter une session
- `sql/schema.sql` — tables `sessions` et `votes`
- `public/` — même structure que l'original (`index/host/vote.html`, `app.js`, `style.css`, `vendor/qrcode.min.js`)
- `ecosystem.config.js` / `deploy/vote-cdm.service` — supervision du process

## Dimensionnement

- **`DB_CONNECTION_LIMIT`** dans `.env` est monté à 30 par défaut (au lieu de 5). À ajuster selon `max_connections` du serveur MariaDB et observé sous charge réelle.
- **Comptage des votes agrégé en SQL** (`GROUP BY choice` dans `getTally()`), pas recompté en JS à partir de la liste complète des votes à chaque nouveau vote — évite un coût qui grandit avec le nombre de votes déjà enregistrés lors des rafales en début de vote.
- **Reconnexion automatique** : `host.js` et `vote.js` réémettent `join-as-host` / `join-as-voter` à chaque événement `connect` du socket (connexion initiale et reconnexions après coupure réseau), pour resynchroniser l'état plutôt que de rester bloqué sur une vue obsolète. Le serveur stocke `voting_ends_at` (échéance exacte du vote) en base, donc à la reconnexion chacun retrouve le temps réellement restant — pas une durée fixe. Si le délai était déjà écoulé pendant la coupure, l'organisateur clôt automatiquement le vote dès sa reconnexion plutôt que d'afficher un minuteur obsolète.
- **Process supervisé** (PM2 ou systemd, voir ci-dessus) pour redémarrer automatiquement en cas de crash, plutôt qu'un `node server.js` lancé à la main.

