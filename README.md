# vote-cdm - Application de Vote en Temps Réel
vote-cdm est une application web légère de vote interactif et en temps réel, conçue pour animer des séances, assemblées ou réunions. 
Elle offre une interface d'administration pour piloter les votes et une interface simple pour les participants.


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


## Lancement en production

Ne pas lancer avec `npm start` en direct pour un événement public : on utilisera le superviseur PM2 qui redémarre le process automatiquement en cas de crash.

**Avec PM2 (gestionnaire de process Node.js)**  :
```bash
# 1. Installer PM2 
npm install -g pm2
# 2. Dans le dossier du projet :
npm install
# 3. Démarrer l'appli via PM2
pm2 start ecosystem.config.js
# 4. Faire en sorte que PM2 redémarre vote-cdm automatiquement si le VPS reboote
pm2 startup
# (cette commande affiche une ligne à copier-coller et exécuter avec sudo —
#  enregistre PM2 comme service système au démarrage)
pm2 save
```


### Piloter au quotidien pendant l'événement

- `pm2 logs vote-cdm` — suivre les logs en direct
- `pm2 status` — voir si le process tourne, depuis combien de temps, combien de fois il a redémarré
- `pm2 restart vote-cdm` — redémarrage manuel si besoin (par exemple après avoir modifié le `.env`)
- `pm2 monit` — vue en direct de la CPU/RAM consommée



## Structure

- `server.js` — Express (sert `public/`) + Socket.io + route `/CODE`
- `db.js` — pool MariaDB
- `sockets/handlers.js` — logique métier : créer/rejoindre/voter/piloter une session
- `sql/schema.sql` — tables `sessions` et `votes`
- `public/` — `index/host/vote.html`, `app.js`, `style.css`, `vendor/qrcode.min.js`
- `ecosystem.config.js` — supervision du process


