const params = new URLSearchParams(window.location.search);
const code = params.get("s");
const hostSecret = params.get("t");
const app = document.getElementById("app");
const socket = getSocket();

let session = null;
let counts = { pour: 0, contre: 0, abstention: 0 };
let total = 0;
let onlineCount = 0;

const DEFAULT_VOTE_SECONDS = 15;
let countdownDeadline = null;
let countdownDuration = null;
let countdownInterval = null;
let autoStopInProgress = false;
let presentationMode = false;

function statusLabel(s) {
  return { idle: "En attente", voting: "Vote en cours", prolonged: "Vote en cours", stopped: "Vote clos", results: "Résultats affichés" }[s] || s;
}

let isQrModalOpen = false;
let isDrawerOpen = false;

function render() {
  if (!session) {
    app.innerHTML = `<div class="card center hint">Chargement…</div>`;
    return;
  }
  const url = voteUrlForCode(session.code);
  const isVotingMode = (session.status === "voting" || session.status === "prolonged");
  const bannerClass = isVotingMode ? "voting" : session.status === "stopped" ? "stopped" : "";

  let timerHtml = "";
  if (isVotingMode) {
    if (session.status === "prolonged") {
      timerHtml = `<div class="vote-timer-extended">Temps prolongé</div>`;
    } else {
      const remainingMs = countdownDeadline ? Math.max(0, countdownDeadline - Date.now()) : 0;
      const pct = countdownDuration ? (remainingMs / countdownDuration) * 100 : 0;
      const warningClass = remainingMs <= 3000 ? "warning" : "";
      timerHtml = `<div class="timer-bar-track"><div id="timerBarFill" class="timer-bar-fill ${warningClass}" style="width: ${pct}%"></div></div>`;
    }
  }

  let lowerContent = "";
  if (session.status === "results") {
    lowerContent = buildResultCard(counts, total, presentationMode, onlineCount);
  } else if (!presentationMode) {
    lowerContent = `
    <div class="card">
      <div class="eyebrow center" style="display:block; margin-bottom:6px;">Dépouillement en direct</div>
      <div class="turnout" style="margin-bottom:8px;">${onlineCount} connexion${onlineCount > 1 ? "s" : ""} en ce moment</div>
      <div class="tally">
        ${tallyRow("Pour", "pour", counts.pour, total)}
        ${tallyRow("Contre", "contre", counts.contre, total)}
        ${tallyRow("Abstention", "abst", counts.abstention, total)}
      </div>
      <div class="turnout" style="margin-top:14px;">${total} vote${total > 1 ? "s" : ""} enregistré${total > 1 ? "s" : ""}</div>
    </div>
    `;
  }

  const startBtnText = session.status === "idle" ? "Démarrer les votes" : "Prolonger le vote de 15 secondes";
  const extendBtnDisabled = (session.status === "idle" || session.status === "prolonged") ? "disabled" : "";

  app.innerHTML = `
    <button class="panel-toggle-btn" id="openPanelBtn">☰ Infos Session</button>

    <div class="side-panel ${isDrawerOpen ? 'open' : ''}" id="sidePanel">
      <button class="panel-close-btn" id="closePanelBtn">&times;</button>
      <h3 style="margin-bottom: 16px; color: var(--navy-2); text-align: center;">Rejoindre</h3>
      <div class="code-display" style="padding: 0 0 10px 0;">${session.code}</div>
      <div class="qrcode-wrap" id="qrClickable" title="Agrandir le QR code" style="cursor: zoom-in;"><div id="qrcode"></div></div>
      <div class="url-line">${url}</div>
      <p class="hint">Les participants scannent ce QR code ou saisissent le code sur ${window.location.origin}</p>
    </div>

    <div class="layout-container">
      <div class="main-content">
        <div class="card center">
          <div class="status-banner ${bannerClass}">${statusLabel(session.status)}</div>
          ${timerHtml}
          <p class="hint">Cette session expirera automatiquement le ${formatExpiryDate(session)}.</p>
        </div>

        <div class="card">
          <div class="stack">
            <button id="startBtn" ${isVotingMode ? "disabled" : ""}>${startBtnText}</button>
            <button id="extendBtn" class="secondary" ${extendBtnDisabled}>Prolonger sans limite de temps</button>
            <button id="stopBtn" ${isVotingMode ? "" : "disabled"}>Arrêter les votes</button>
            <button id="resultsBtn" ${total === 0 ? "disabled" : ""}>Afficher les résultats des votes</button>
            <button id="newBtn" class="secondary">Nouveau vote (même session)</button>
          </div>
        </div>

        <div class="segmented-control" title="Basculer le mode d'affichage">
          <input type="radio" id="mode-org" name="display-mode" value="org" ${!presentationMode ? "checked" : ""}>
          <label for="mode-org">Organisateur</label>
          <input type="radio" id="mode-pres" name="display-mode" value="pres" ${presentationMode ? "checked" : ""}>
          <label for="mode-pres">Présentation</label>
          <div class="segment-slider"></div>
        </div>

        ${lowerContent}

        <div class="card">
          <button id="closeBtn" class="danger">Clôture de session</button>
          <p class="hint" style="margin-top:10px;">Ferme définitivement cette session et supprime tous ses votes de la base de données. Action irréversible.</p>
        </div>
      </div>
    </div>

    <div id="qrModal" class="modal-overlay" style="display: ${isQrModalOpen ? 'flex' : 'none'};">
      <div class="modal-content">
        <span class="modal-close" id="qrModalClose">&times;</span>
        <div class="code-display" style="font-size: 54px; margin-bottom: 20px;">${session.code}</div>
        <div id="qrcode-large"></div>
        <div class="url-line" style="font-size: 20px; margin-top: 20px;">${url}</div>
      </div>
    </div>
  `;

  new QRCode(document.getElementById("qrcode"), {
    text: url, width: 180, height: 180, colorDark: "#1c2321", colorLight: "#ffffff",
  });
  new QRCode(document.getElementById("qrcode-large"), {
    text: url, width: 400, height: 400, colorDark: "#1c2321", colorLight: "#ffffff",
  });

  document.getElementById("startBtn").onclick = startVoting;
  document.getElementById("extendBtn").onclick = prolongVoting;
  document.getElementById("stopBtn").onclick = stopVoting;
  document.getElementById("resultsBtn").onclick = showResults;
  document.getElementById("newBtn").onclick = resetSessionForNewItem;
  document.getElementById("closeBtn").onclick = closeSessionPermanently;
  document.getElementsByName("display-mode").forEach(radio => {
    radio.onchange = (event) => {
      presentationMode = (event.target.value === "pres");
      render();
    };
  });

  document.getElementById("openPanelBtn").onclick = () => {
    isDrawerOpen = true;
    document.getElementById("sidePanel").classList.add("open");
  };
  document.getElementById("closePanelBtn").onclick = () => {
    isDrawerOpen = false;
    document.getElementById("sidePanel").classList.remove("open");
  };

  const qrModal = document.getElementById("qrModal");
  document.getElementById("qrClickable").onclick = () => {
    isQrModalOpen = true;
    qrModal.style.display = "flex";
  };
  document.getElementById("qrModalClose").onclick = () => {
    isQrModalOpen = false;
    qrModal.style.display = "none";
  };
  qrModal.onclick = (e) => {
    if (e.target === qrModal) {
      isQrModalOpen = false;
      qrModal.style.display = "none";
    }
  };
}

function buildResultCard(counts, total, isPresentation, onlineCount) {
  let verdict = "Égalité";
  let verdictClass = "";
  if (counts.pour > counts.contre) { verdict = "Résultat : Pour"; verdictClass = "pour"; }
  else if (counts.contre > counts.pour) { verdict = "Résultat : Contre"; verdictClass = "contre"; }

  const onlineHtml = !isPresentation ? `<div class="turnout" style="margin-bottom:8px;">${onlineCount} connexion${onlineCount > 1 ? "s" : ""} en ce moment</div>` : "";

  return `
    <div class="card">
      <div class="verdict ${verdictClass}">${verdict}</div>
      ${onlineHtml}
      <div class="turnout">${total} votant${total > 1 ? "s" : ""}</div>
      <div class="tally">
        ${tallyRow("Pour", "pour", counts.pour, total)}
        ${tallyRow("Contre", "contre", counts.contre, total)}
        ${tallyRow("Abstention", "abst", counts.abstention, total)}
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

function clearVoteTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  countdownDeadline = null;
  autoStopInProgress = false;
}

function beginVoteTimer(seconds = DEFAULT_VOTE_SECONDS) {
  if (countdownInterval) clearInterval(countdownInterval);
  autoStopInProgress = false;
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
    if (remainingMs <= 0 && session && session.status === "voting" && !autoStopInProgress) {
      autoStopInProgress = true;
      clearInterval(countdownInterval);
      countdownInterval = null;
      stopVoting();
    }
  }, 50);
}

function startVoting() {
  beginVoteTimer(DEFAULT_VOTE_SECONDS);
  socket.emit("start-voting", { code, hostSecret, seconds: DEFAULT_VOTE_SECONDS }, (res) => {
    if (!res.ok) { clearVoteTimer(); alert("Erreur : " + res.error); return; }
  });
}

function prolongVoting() {
  if (!session || session.status === "prolonged") return;
  socket.emit("prolong-voting", { code, hostSecret }, (res) => {
    if (!res.ok) alert("Erreur : " + res.error);
  });
}

function stopVoting() {
  socket.emit("stop-voting", { code, hostSecret }, (res) => {
    if (!res.ok) alert("Erreur : " + res.error);
  });
}

function showResults() {
  socket.emit("show-results", { code, hostSecret }, (res) => {
    if (!res.ok) alert("Erreur : " + res.error);
  });
}

function closeSessionPermanently() {
  if (!confirm("Clôturer définitivement cette session ? Tous les votes seront supprimés et le lien ne fonctionnera plus. Cette action est irréversible.")) {
    return;
  }
  const closeBtn = document.getElementById("closeBtn");
  if (closeBtn) closeBtn.disabled = true;

  socket.emit("close-session", { code, hostSecret }, (res) => {
    if (!res.ok) {
      alert("Erreur : " + res.error);
      if (closeBtn) closeBtn.disabled = false;
      return;
    }
    clearVoteTimer();
    session = null;
    app.innerHTML = `<div class="card center hint">Cette session a été clôturée et ses données ont été supprimées. <a href="index.html">Démarrer une nouvelle session</a></div>`;
  });
}

function resetSessionForNewItem() {
  if (!confirm("Remettre les votes à zéro pour un nouvel objet, dans cette même session ? Les votes actuels seront définitivement supprimés.")) {
    return;
  }
  const newBtn = document.getElementById("newBtn");
  if (newBtn) newBtn.disabled = true;

  socket.emit("new-item", { code, hostSecret }, (res) => {
    if (!res.ok) {
      alert("Erreur : " + res.error);
      if (newBtn) newBtn.disabled = false;
      return;
    }
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

    if (payload.status === "voting" && previousStatus !== "voting") {
      beginVoteTimer(payload.seconds || DEFAULT_VOTE_SECONDS);
    } else if (payload.status !== "voting") {
      clearVoteTimer();
    }
    if (payload.status === "results" && payload.counts) {
      counts = payload.counts;
      total = payload.total;
    }
    if (payload.reset) {
      counts = { pour: 0, contre: 0, abstention: 0 };
      total = 0;
    }
    render();
  });

  socket.on("tally-updated", (payload) => {
    counts = payload.counts;
    total = payload.total;
    render();
  });

  socket.on("presence-updated", (payload) => {
    onlineCount = payload.onlineCount;
    render();
  });

  socket.on("session-closed", () => {
    clearVoteTimer();
    session = null;
    app.innerHTML = `<div class="card center hint">Cette session a été clôturée et ses données ont été supprimées. <a href="index.html">Démarrer une nouvelle session</a></div>`;
  });
}

// Rejoint le dashboard : appelé à la connexion initiale ET à chaque
// reconnexion socket (coupure Wi-Fi/4G), pour ne jamais rester bloqué
// sur un état obsolète après une coupure.
function joinSession() {
  if (!code || !hostSecret) {
    app.innerHTML = `<div class="card center hint">Lien invalide. <a href="index.html">Démarrer une nouvelle session</a></div>`;
    return;
  }
  socket.emit("join-as-host", { code, hostSecret }, (res) => {
    if (!res.ok) {
      if (!session) {
        app.innerHTML = `<div class="card center hint">Lien invalide ou expiré. <a href="index.html">Démarrer une nouvelle session</a></div>`;
      }
      return;
    }
    const wasVoting = session && (session.status === "voting" || session.status === "prolonged");
    session = res.session;
    counts = res.counts;
    total = res.total;
    onlineCount = res.onlineCount || 0;

    // Si le vote était en cours et qu'aucun minuteur local ne tourne
    // (ex : reprise après coupure réseau), on relance le minuteur sur le
    // temps réellement restant (calculé côté serveur depuis voting_ends_at),
    // pas sur une durée fixe.
    if (session.status === "voting" && !countdownInterval) {
      if (res.remainingSeconds > 0) {
        beginVoteTimer(res.remainingSeconds);
      } else {
        // Le délai était déjà écoulé pendant la coupure : on clôt tout
        // de suite plutôt que d'afficher un minuteur qui n'existe plus.
        render();
        stopVoting();
        return;
      }
    } else if (session.status !== "voting" && !wasVoting) {
      clearVoteTimer();
    }

    render();
  });
}

attachSocketListeners();
socket.on("connect", joinSession);
