const code = getSessionCodeFromLocation();
const app = document.getElementById("app");

let session = null;
let hasVoted = false;
let counts = { pour: 0, contre: 0, abstention: 0 };
let total = 0;
let onlineCount = 0;
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
  if (session === "closed") return;
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

async function castVote(choice) {
  if (voting) return;
  voting = true;
  app.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = true));

  try {
    if (!['voting', 'prolonged'].includes(session.status)) {
       throw new Error("Le vote n'est pas ouvert");
    }
    
    const existing = await pb.collection('votes').getFullList({ filter: `session="${session.id}" && voterId="${voterId}"` });
    if (existing.length > 0) {
      hasVoted = true;
      voting = false;
      render();
      return;
    }

    await pb.collection('votes').create({
      session: session.id,
      voterId: voterId,
      choice: choice
    });
    hasVoted = true;
    render();
  } catch(err) {
    alert("Erreur : " + err.message);
    app.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = false));
  } finally {
    voting = false;
  }
}

let listenersAttached = false;
function attachPbListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  pb.collection('sessions').subscribe(session.id, (e) => {
    if (e.action === 'delete') {
      session = "closed";
      const expiryNote = document.getElementById("expiryNote");
      if (expiryNote) expiryNote.style.display = "none";
      app.innerHTML = `<div class="card center hint">Cette session a été clôturée et n'est plus disponible.</div>`;
      return;
    }
    
    const previousStatus = session.status;
    session = e.record;

    if (session.status === "voting" && previousStatus !== "voting") {
      const remainingMs = session.voting_ends_at ? new Date(session.voting_ends_at).getTime() - Date.now() : DEFAULT_VOTE_SECONDS * 1000;
      beginLocalTimer(Math.max(0, remainingMs / 1000));
    } else if (session.status === "prolonged" && previousStatus !== "prolonged") {
      stopLocalTimer();
      render();
    } else if (session.status !== "voting" && session.status !== "prolonged") {
      stopLocalTimer();
    }

    if (session.status === "idle" && previousStatus !== "idle") {
      hasVoted = false;
      counts = { pour: 0, contre: 0, abstention: 0 };
      total = 0;
      render();
    } else {
      render();
    }
  });
  
  pb.collection('votes').subscribe('*', (e) => {
    if (e.record.session === session.id) {
       if (e.action === 'create') {
         counts[e.record.choice]++;
         total++;
         if (session.status === 'results') render();
       }
    }
  });
}

async function joinSession() {
  if (!code) {
    app.innerHTML = `<div class="card center hint">Aucun code de session fourni.</div>`;
    return;
  }
  
  try {
    session = await pb.collection('sessions').getFirstListItem(`code="${code}"`);
    
    const votes = await pb.collection('votes').getFullList({ filter: `session="${session.id}"` });
    counts = { pour: 0, contre: 0, abstention: 0 };
    total = votes.length;
    for (const v of votes) counts[v.choice]++;
    
    const myVote = votes.find(v => v.voterId === voterId);
    hasVoted = !!myVote;

    const expiryNote = document.getElementById("expiryNote");
    const expiry = formatExpiryDate(session);
    if (expiryNote && expiry) {
      expiryNote.textContent = `Cette session expirera automatiquement le ${expiry}.`;
      expiryNote.style.display = "block";
    }
    
    attachPbListeners();
    startPresencePing(session.id, voterId);

    if (session.status === "voting" && session.voting_ends_at) {
      const remaining = new Date(session.voting_ends_at).getTime() - Date.now();
      if (remaining > 0) beginLocalTimer(Math.round(remaining/1000));
      else { stopLocalTimer(); render(); }
    } else if (session.status === "prolonged") {
      stopLocalTimer();
      render();
    } else {
      stopLocalTimer();
      render();
    }
  } catch (err) {
    app.innerHTML = `<div class="card center hint">Session introuvable. Vérifiez le code : <strong>${code}</strong></div>`;
  }
}

joinSession();
