const code = getSessionCodeFromLocation();
const app = document.getElementById("app");
const socket = getSocket();

let session = null;
let hasVoted = false;
let counts = { pour: 0, contre: 0, abstention: 0 };
let total = 0;
let voting = false;
const voterId = getVoterId();
const DEFAULT_VOTE_SECONDS = 15;
let countdownDeadline = null;
let countdownDuration = null;
let countdownInterval = null;

function statusLabel(s) {
  return { idle: "En attente du début du vote", voting: "Vote en cours", prolonged: "Vote en cours", stopped: "Vote clos", results: "Résultats" }[s] || s;
}

function render() {
  if (!session) { app.innerHTML = `<div class="card center hint">Chargement…</div>`; return; }

  if (session.status === "results") {
    renderResults();
    return;
  }

  const isVotingMode = (session.status === "voting" || session.status === "prolonged");

  if (isVotingMode && !hasVoted) {
    app.innerHTML = `
      <div class="card center">
        <div class="status-banner voting">Vote en cours</div>
        ${timerMarkup()}
        <p class="hint">Choisissez une option. Vous ne pourrez voter qu'une seule fois.</p>
      </div>
      <div class="choice-grid">
        <button class="choice-btn pour" data-choice="pour">Pour</button>
        <button class="choice-btn contre" data-choice="contre">Contre</button>
        <button class="choice-btn abst" data-choice="abstention">Abstention</button>
      </div>
    `;
    app.querySelectorAll(".choice-btn").forEach((b) => {
      b.onclick = () => castVote(b.dataset.choice);
    });
    return;
  }

  if (hasVoted && session.status !== "results") {
    app.innerHTML = `<div class="card center">${isVotingMode ? timerMarkup() : ""}<div class="locked-msg">✓ Votre vote a été enregistré.<br><span class="hint">${isVotingMode ? "En attente de la clôture du vote." : "Les votes sont clos."}</span></div></div>`;
    return;
  }

  const banner = session.status === "stopped" ? `<div class="status-banner stopped">Vote clos</div>` : `<div class="status-banner">${statusLabel(session.status)}</div>`;
  app.innerHTML = `<div class="card center">${banner}<p class="locked-msg" style="margin-top:0;">${session.status === "stopped" ? "Les votes sont clos." : "En attente du début du vote…"}</p></div>`;
}

function timerMarkup() {
  if (session.status === "prolonged") return `<div class="vote-timer-extended">Temps prolongé</div>`;
  const remainingMs = countdownDeadline ? Math.max(0, countdownDeadline - Date.now()) : 0;
  const pct = countdownDuration ? (remainingMs / countdownDuration) * 100 : 0;
  const warningClass = remainingMs <= 3000 ? "warning" : "";
  return `<div class="timer-bar-track"><div id="timerBarFill" class="timer-bar-fill ${warningClass}" style="width: ${pct}%"></div></div>`;
}

function stopLocalTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  countdownDeadline = null;
}

function beginLocalTimer(seconds = DEFAULT_VOTE_SECONDS) {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownDuration = seconds * 1000;
  countdownDeadline = Date.now() + countdownDuration;
  countdownInterval = setInterval(() => {
    const remainingMs = Math.max(0, countdownDeadline - Date.now());
    const timerBarFill = document.getElementById("timerBarFill");
    if (timerBarFill) {
      const pct = (remainingMs / countdownDuration) * 100;
      timerBarFill.style.width = pct + "%";
      if (remainingMs <= 3000) timerBarFill.classList.add("warning");
    }
    if (remainingMs <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 50);
  render();
}

function renderResults() {
  const t = total;
  let verdict = "Égalité";
  let verdictClass = "";
  if (counts.pour > counts.contre) { verdict = "Résultat : Pour"; verdictClass = "pour"; }
  else if (counts.contre > counts.pour) { verdict = "Résultat : Contre"; verdictClass = "contre"; }

  app.innerHTML = `
    <div class="card">
      <div class="verdict ${verdictClass}">${verdict}</div>
      <div class="turnout">${t} votant${t > 1 ? "s" : ""}</div>
      <div class="tally">
        ${tallyRow("Pour", "pour", counts.pour, t)}
        ${tallyRow("Contre", "contre", counts.contre, t)}
        ${tallyRow("Abstention", "abst", counts.abstention, t)}
      </div>
    </div>
  `;
}

function tallyRow(label, cls, count, total) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="label ${cls}">${label}</div>
    <div class="count">${count}</div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
  `;
}

function castVote(choice) {
  if (voting) return;
  voting = true;
  app.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = true));

  socket.emit("cast-vote", { code: session.code, voterId, choice }, (res) => {
    voting = false;
    if (!res.ok) {
      alert("Erreur : " + res.error);
      app.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = false));
      return;
    }
    hasVoted = true;
    render();
  });
}

// --- Écoute des événements serveur (diffusion + resynchronisation) ---

let listenersAttached = false;
function attachSocketListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  socket.on("session-updated", (payload) => {
    if (!session) return;
    const previousStatus = session.status;
    session.status = payload.status;

    if (session.status === "voting" && previousStatus !== "voting") {
      beginLocalTimer(payload.seconds || DEFAULT_VOTE_SECONDS);
    } else if (session.status === "prolonged" && previousStatus !== "prolonged") {
      stopLocalTimer();
      render();
    } else if (session.status !== "voting" && session.status !== "prolonged") {
      stopLocalTimer();
    }

    if (session.status === "results") {
      counts = payload.counts;
      total = payload.total;
      render();
    } else if (payload.reset) {
      hasVoted = false;
      counts = { pour: 0, contre: 0, abstention: 0 };
      total = 0;
      render();
    } else {
      render();
    }
  });

  socket.on("session-closed", () => {
    session = null;
    const expiryNote = document.getElementById("expiryNote");
    if (expiryNote) expiryNote.style.display = "none";
    app.innerHTML = `<div class="card center hint">Cette session a été clôturée et n'est plus disponible.</div>`;
  });
}

// Rejoint la session : appelé à la connexion initiale ET à chaque
// reconnexion socket (coupure Wi-Fi/4G), pour ne jamais rester bloqué
// sur un état obsolète après une coupure.
function joinSession() {
  if (!code) {
    app.innerHTML = `<div class="card center hint">Aucun code de session fourni.</div>`;
    return;
  }
  socket.emit("join-as-voter", { code, voterId }, (res) => {
    if (!res.ok) {
      if (!session) {
        app.innerHTML = `<div class="card center hint">Session introuvable. Vérifiez le code : <strong>${code}</strong></div>`;
      }
      return;
    }
    const wasVoting = session && (session.status === "voting" || session.status === "prolonged");
    session = res.session;
    hasVoted = res.hasVoted;
    counts = res.counts;
    total = res.total;

    const expiryNote = document.getElementById("expiryNote");
    const expiry = formatExpiryDate(session);
    if (expiryNote && expiry) {
      expiryNote.textContent = `Cette session expirera automatiquement le ${expiry}.`;
      expiryNote.style.display = "block";
    }

    if (session.status === "voting" && !countdownInterval) {
      // Temps réellement restant calculé côté serveur, évite de redonner 15s pleines à quelqu'un qui se reconnecte en fin de vote.
      beginLocalTimer(res.remainingSeconds > 0 ? res.remainingSeconds : 0);
    } else if (session.status === "prolonged") {
      stopLocalTimer();
      render();
    } else if (!wasVoting) {
      stopLocalTimer();
      render();
    } else {
      render();
    }
  });
}

attachSocketListeners();
socket.on("connect", joinSession);
