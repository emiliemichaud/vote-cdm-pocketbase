const { v4: uuidv4 } = require('uuid');
const { customAlphabet } = require('nanoid');
const pool = require('../db');

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

const room = (code) => `session:${code}`;
const votersRoom = (code) => `voters:${code}`;
const hostRoom = (code) => `host:${code}`;

const tallyTimers = new Map();
const TALLY_PUSH_INTERVAL_MS = 200;

async function getSessionByCode(code) {
  const rows = await pool.query('SELECT * FROM sessions WHERE code = ?', [code]);
  return rows[0] || null;
}

// Agrégation faite en SQL plutôt qu'en JS 
async function getTally(sessionId) {
  const rows = await pool.query(
    `SELECT choice, COUNT(*) AS count FROM votes WHERE session_id = ? GROUP BY choice`,
    [sessionId]
  );
  const counts = { pour: 0, contre: 0, abstention: 0 };
  for (const row of rows) counts[row.choice] = Number(row.count);
  const total = counts.pour + counts.contre + counts.abstention;
  return { counts, total };
}

function onlineVoters(io, code) {
  return io.sockets.adapter.rooms.get(votersRoom(code))?.size || 0;
}

function scheduleTallyUpdate(io, code, sessionId) {
  if (tallyTimers.has(code)) return;

  const timer = setTimeout(async () => {
    tallyTimers.delete(code);
    try {
      const { counts, total } = await getTally(sessionId);
      io.to(hostRoom(code)).emit('results:update', { counts, total });
    } catch (err) {
      console.error('scheduleTallyUpdate', err);
    }
  }, TALLY_PUSH_INTERVAL_MS);

  timer.unref?.();
  tallyTimers.set(code, timer);
}

function cancelTallyUpdate(code) {
  const timer = tallyTimers.get(code);
  if (timer) clearTimeout(timer);
  tallyTimers.delete(code);
}

// Temps restant réel avant la fin du vote, calculé depuis voting_ends_at
// (stocké en base) 
function remainingSeconds(session) {
  if (session.status !== 'voting' || !session.voting_ends_at) return null;
  const ms = new Date(session.voting_ends_at).getTime() - Date.now();
  return Math.max(0, Math.round(ms / 1000));
}

function registerHandlers(io, socket) {
  // --- Création de session ---
  socket.on('create-session', async (_payload, ack) => {
    try {
      const id = uuidv4();
      const hostSecret = uuidv4();
      let code;
      for (let i = 0; i < 5; i++) {
        code = generateCode();
        if (!(await getSessionByCode(code))) break;
      }
      await pool.query(
        `INSERT INTO sessions (id, code, status, host_secret) VALUES (?, ?, 'idle', ?)`,
        [id, code, hostSecret]
      );
      ack?.({ ok: true, code, hostSecret });
    } catch (err) {
      console.error('create-session', err);
      ack?.({ ok: false, error: 'Erreur lors de la création de la session' });
    }
  });

  // --- L'organisateur rejoint le dashboard d'une session ---
  // Appelé aussi bien à la connexion initiale qu'à chaque reconnexion socket.
  socket.on('join-as-host', async ({ code, hostSecret }, ack) => {
    try {
      const session = await getSessionByCode(code);
      if (!session || session.host_secret !== hostSecret) {
        return ack?.({ ok: false, error: 'Lien invalide ou expiré' });
      }
      socket.join(room(code));
      socket.join(hostRoom(code));
      socket.data.code = code;
      const { counts, total } = await getTally(session.id);
      ack?.({
        ok: true,
        session,
        counts,
        total,
        onlineCount: onlineVoters(io, code),
        remainingSeconds: remainingSeconds(session),
      });
    } catch (err) {
      console.error('join-as-host', err);
      ack?.({ ok: false, error: 'Erreur serveur' });
    }
  });

  // --- Un participant rejoint le bulletin de vote ---
  socket.on('join-as-voter', async ({ code, voterId }, ack) => {
    try {
      const session = await getSessionByCode((code || '').toUpperCase());
      if (!session) return ack?.({ ok: false, error: 'Session introuvable' });

      socket.join(room(session.code));
      socket.join(votersRoom(session.code));
      socket.data.code = session.code;

      const existing = await pool.query(
        'SELECT id FROM votes WHERE session_id = ? AND voter_id = ?',
        [session.id, voterId]
      );
      const hasVoted = existing.length > 0;

      let counts = { pour: 0, contre: 0, abstention: 0 };
      let total = 0;
      if (session.status === 'results') ({ counts, total } = await getTally(session.id));

      io.to(hostRoom(session.code)).emit('presence-updated', { onlineCount: onlineVoters(io, session.code) });

      ack?.({
        ok: true,
        session,
        hasVoted,
        counts,
        total,
        remainingSeconds: remainingSeconds(session),
      });
    } catch (err) {
      console.error('join-as-voter', err);
      ack?.({ ok: false, error: 'Erreur serveur' });
    }
  });

  // --- Un participant vote ---
  socket.on('cast-vote', async ({ code, voterId, choice }, ack) => {
    try {
      if (!['pour', 'contre', 'abstention'].includes(choice)) {
        return ack?.({ ok: false, error: 'Choix invalide' });
      }
      const session = await getSessionByCode(code);
      if (!session) return ack?.({ ok: false, error: 'Session introuvable' });
      if (!['voting', 'prolonged'].includes(session.status)) {
        return ack?.({ ok: false, error: "Le vote n'est pas ouvert" });
      }

      try {
        await pool.query(
          'INSERT INTO votes (session_id, voter_id, choice) VALUES (?, ?, ?)',
          [session.id, voterId, choice]
        );
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return ack?.({ ok: true, alreadyVoted: true });
        }
        throw err;
      }

      scheduleTallyUpdate(io, session.code, session.id);

      ack?.({ ok: true, alreadyVoted: false });
    } catch (err) {
      console.error('cast-vote', err);
      ack?.({ ok: false, error: "Impossible d'enregistrer le vote" });
    }
  });

  // --- Actions de l'organisateur ---
  async function withHost(code, hostSecret, ack, fn) {
    const session = await getSessionByCode(code);
    if (!session || session.host_secret !== hostSecret) {
      return ack?.({ ok: false, error: 'Non autorisé' });
    }
    return fn(session);
  }

  socket.on('start-voting', ({ code, hostSecret, seconds }, ack) =>
    withHost(code, hostSecret, ack, async (session) => {
      const secondsVal = seconds || 15;
      const endsAt = new Date(Date.now() + secondsVal * 1000);
      await pool.query(
        `UPDATE sessions SET status = 'voting', voting_ends_at = ? WHERE id = ?`,
        [endsAt, session.id]
      );
      io.to(room(code)).emit('session-updated', { status: 'voting', seconds: secondsVal });
      ack?.({ ok: true });
    })
  );

  socket.on('prolong-voting', ({ code, hostSecret }, ack) =>
    withHost(code, hostSecret, ack, async (session) => {
      await pool.query(
        `UPDATE sessions SET status = 'prolonged', voting_ends_at = NULL WHERE id = ?`,
        [session.id]
      );
      io.to(room(code)).emit('session-updated', { status: 'prolonged' });
      ack?.({ ok: true });
    })
  );

  socket.on('stop-voting', ({ code, hostSecret }, ack) =>
    withHost(code, hostSecret, ack, async (session) => {
      await pool.query(
        `UPDATE sessions SET status = 'stopped', voting_ends_at = NULL WHERE id = ?`,
        [session.id]
      );
      io.to(room(code)).emit('session-updated', { status: 'stopped' });
      ack?.({ ok: true });
    })
  );

  socket.on('show-results', ({ code, hostSecret }, ack) =>
    withHost(code, hostSecret, ack, async (session) => {
      await pool.query(`UPDATE sessions SET status = 'results' WHERE id = ?`, [session.id]);
      const { counts, total } = await getTally(session.id);
      io.to(room(code)).emit('session-updated', { status: 'results', counts, total });
      ack?.({ ok: true });
    })
  );

  socket.on('new-item', ({ code, hostSecret }, ack) =>
    withHost(code, hostSecret, ack, async (session) => {
      cancelTallyUpdate(code);
      await pool.query('DELETE FROM votes WHERE session_id = ?', [session.id]);
      await pool.query(
        `UPDATE sessions SET status = 'idle', voting_ends_at = NULL WHERE id = ?`,
        [session.id]
      );
      io.to(room(code)).emit('session-updated', { status: 'idle', reset: true });
      ack?.({ ok: true });
    })
  );

  socket.on('close-session', ({ code, hostSecret }, ack) =>
    withHost(code, hostSecret, ack, async (session) => {
      cancelTallyUpdate(code);
      await pool.query('DELETE FROM votes WHERE session_id = ?', [session.id]);
      await pool.query('DELETE FROM sessions WHERE id = ?', [session.id]);
      io.to(room(code)).emit('session-closed', { reason: 'closed' });
      ack?.({ ok: true });
    })
  );

  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (code) {
      io.to(hostRoom(code)).emit('presence-updated', { onlineCount: onlineVoters(io, code) });
    }
  });
}

// Sessions supprimées automatiquement 15h après leur création 
async function cleanupExpiredSessions(io) {
  try {
    const expired = await pool.query(
      `SELECT id, code FROM sessions WHERE created_at < (NOW() - INTERVAL 15 HOUR)`
    );
    for (const s of expired) {
      await pool.query('DELETE FROM sessions WHERE id = ?', [s.id]);
      io.to(room(s.code)).emit('session-closed', { reason: 'expired' });
    }
  } catch (err) {
    console.error('cleanupExpiredSessions', err);
  }
}

module.exports = { registerHandlers, cleanupExpiredSessions };
