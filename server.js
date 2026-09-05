require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { registerHandlers, cleanupExpiredSessions } = require('./sockets/handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/typ', express.static(path.join(__dirname, 'typ')));

// Lien court /CODE -> bulletin de vote 
app.get('/:code', (req, res, next) => {
  const code = req.params.code;
  if (!/^[A-Z0-9]{4,10}$/i.test(code)) return next();
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

io.on('connection', (socket) => {
  registerHandlers(io, socket);
});

setInterval(() => cleanupExpiredSessions(io), 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`vote-cdm démarré sur http://localhost:${PORT}`);
});
