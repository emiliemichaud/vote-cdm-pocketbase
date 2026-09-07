// ============================================================
// Fonctions partagées entre host.html et vote.html
// ============================================================

const pb = new PocketBase(window.POCKETBASE_URL || 'http://127.0.0.1:8090');

// Identifiant anonyme et persistant du votant, propre à ce navigateur
function getVoterId() {
  let id = localStorage.getItem("voter_id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    localStorage.setItem("voter_id", id);
  }
  return id;
}

// Lien court : https://ton-domaine/CODE
function voteUrlForCode(code) {
  return window.location.origin + "/" + code;
}

const RESERVED_PATH_NAMES = ["", "vote", "index.html", "vote.html", "host.html", "404.html"];

function getSessionCodeFromLocation() {
  let code = new URLSearchParams(window.location.search).get("s");

  if (!code) {
    const segment = window.location.pathname.split("/").filter(Boolean).pop() || "";
    if (segment && !RESERVED_PATH_NAMES.includes(segment.toLowerCase())) {
      code = segment;
    }
  }

  if (code) {
    // Sauvegarde en session pour survivre aux rafraîchissements (F5)
    sessionStorage.setItem("currentSessionCode", code);
    // Masque le code de l'URL pour plus de discrétion (réécrit en /vote)
    window.history.replaceState({}, '', '/vote');
    return code;
  }

  // Si pas de code dans l'URL (ex: suite à un rafraîchissement), on cherche en session
  return sessionStorage.getItem("currentSessionCode");
}

// created_at + 15h, au format "JJ.MM.AAAA à HH:MM"
function formatExpiryDate(session) {
  if (!session || !session.created_at) return null;
  const created = new Date(session.created_at);
  const expiry = new Date(created.getTime() + 15 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(expiry.getDate())}.${pad(expiry.getMonth() + 1)}.${expiry.getFullYear()} à ${pad(expiry.getHours())}:${pad(expiry.getMinutes())}`;
}

function tallyCounts(votes) {
  const counts = { pour: 0, contre: 0, abstention: 0 };
  for (const v of votes) {
    if (counts[v.choice] !== undefined) counts[v.choice]++;
  }
  return counts;
}

// === PRESENCE TEMPS REEL ===
let presenceRecord = null;
async function startPresencePing(sessionId, vId) {
  try {
    const existing = await pb.collection('presence').getFullList({ filter: `session="${sessionId}" && voterId="${vId}"` });
    for (const e of existing) await pb.collection('presence').delete(e.id);
  } catch(e) {}
  try { presenceRecord = await pb.collection('presence').create({ session: sessionId, voterId: vId }); } catch(e) {}
  
  setInterval(async () => {
    if (presenceRecord) {
      try { await pb.collection('presence').update(presenceRecord.id, {}); }
      catch(e) {
        try { presenceRecord = await pb.collection('presence').create({ session: sessionId, voterId: vId }); } catch(err) {}
      }
    }
  }, 10000);

  window.addEventListener('beforeunload', () => {
    if (presenceRecord) pb.collection('presence').delete(presenceRecord.id);
  });
}

async function subscribeToPresence(sessionId, onUpdate) {
  const fetchCount = async () => {
    try {
      const d = new Date(Date.now() - 15000);
      const str = d.toISOString().replace('T', ' ');
      const records = await pb.collection('presence').getFullList({ filter: `session="${sessionId}" && updated >= "${str}"`, fields: 'id' });
      onUpdate(records.length);
    } catch(e) {}
  };
  await fetchCount();
  setInterval(fetchCount, 5000); // Polling doux pour nettoyer les déconnexions sans delete
  
  pb.collection('presence').subscribe('*', (e) => {
    if (e.record.session === sessionId) fetchCount();
  });
}
