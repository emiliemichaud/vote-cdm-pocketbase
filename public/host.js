let code = new URLSearchParams(window.location.search).get("s");
let hostSecret = new URLSearchParams(window.location.search).get("t");

if (code && hostSecret) {
  sessionStorage.setItem("hostCode", code);
  sessionStorage.setItem("hostSecret", hostSecret);
  window.history.replaceState({}, '', '/host.html');
} else {
  if (!code) code = sessionStorage.getItem("hostCode");
  if (!hostSecret) hostSecret = sessionStorage.getItem("hostSecret");
}

const app = document.getElementById("app");

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
let lastReqsJson = "";

function render() {
  if (session === "closed") return;
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
  } else {
    const onlineHtml = !presentationMode ? `<div class="turnout" style="margin-bottom:8px;">${onlineCount} connexion${onlineCount > 1 ? "s" : ""} en ce moment</div>` : "";
    lowerContent = `
    <div class="card">
      <div class="eyebrow center" style="display:block; margin-bottom:6px;">Dépouillement en direct</div>
      ${onlineHtml}
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
    <button class="panel-toggle-btn danger" id="waitingRoomBtn" style="display:none; top: 74px;">Salle d'attente</button>

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
          <div class="stack">
            <button id="downloadPdfBtn" class="secondary">Télécharger les résultats</button>
            <button id="closeBtn" class="danger">Clôture de session</button>
          </div>
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

  const dlBtn = document.getElementById("downloadPdfBtn");
  dlBtn.onclick = downloadPdf;
  updateWaitingRoomBadge();
  dlBtn.style.display = total > 0 ? "block" : "none";
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

async function startVoting() {
  beginVoteTimer(DEFAULT_VOTE_SECONDS);
  try {
    const endsAt = new Date(Date.now() + DEFAULT_VOTE_SECONDS * 1000).toISOString();
    await pb.collection('sessions').update(session.id, { status: 'voting', voting_ends_at: endsAt });
  } catch(err) {
    clearVoteTimer();
    alert("Erreur : " + err.message);
  }
}

async function prolongVoting() {
  if (!session || session.status === "prolonged") return;
  try {
    await pb.collection('sessions').update(session.id, { status: 'prolonged', voting_ends_at: "" });
  } catch(err) { alert("Erreur : " + err.message); }
}

async function stopVoting() {
  try {
    await pb.collection('sessions').update(session.id, { status: 'stopped', voting_ends_at: "" });
  } catch(err) { alert("Erreur : " + err.message); }
}

async function showResults() {
  try {
    await pb.collection('sessions').update(session.id, { status: 'results' });
  } catch(err) { alert("Erreur : " + err.message); }
}

async function closeSessionPermanently() {
  if (!confirm("Clôturer définitivement cette session ? Tous les votes seront supprimés et le lien ne fonctionnera plus. Cette action est irréversible.")) {
    return;
  }
  const closeBtn = document.getElementById("closeBtn");
  if (closeBtn) closeBtn.disabled = true;

  try {
    await pb.collection('sessions').delete(session.id);
    clearVoteTimer();
    session = "closed";
    app.innerHTML = `<div class="card center hint">Cette session a été clôturée et ses données ont été supprimées. <a href="index.html">Démarrer une nouvelle session</a></div>`;
  } catch(err) {
    alert("Erreur : " + err.message);
    if (closeBtn) closeBtn.disabled = false;
  }
}

async function resetSessionForNewItem() {
  const newBtn = document.getElementById("newBtn");
  if (newBtn) newBtn.disabled = true;
  
  try {
    if (total > 0 || session.status === "results") {
      const historyList = await pb.collection('history').getFullList({ filter: `session="${session.id}"` });
      await pb.collection('history').create({
        session: session.id,
        numero: historyList.length + 1,
        pour: counts.pour,
        contre: counts.contre,
        abstention: counts.abstention,
        total: total
      });
    }

    const votes = await pb.collection('votes').getFullList({ filter: `session="${session.id}"` });
    await Promise.all(votes.map(v => pb.collection('votes').delete(v.id)));
    await pb.collection('sessions').update(session.id, { status: 'idle', voting_ends_at: "" });
  } catch(e) {
    alert("Erreur : " + e.message);
  } finally {
    if (newBtn) newBtn.disabled = false;
  }
}

let listenersAttached = false;
async function attachPbListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  pb.collection('sessions').subscribe(session.id, (e) => {
    if (e.action === 'delete') {
      clearVoteTimer();
      session = "closed";
      app.innerHTML = `<div class="card center hint">Cette session a été clôturée et ses données ont été supprimées. <a href="index.html">Démarrer une nouvelle session</a></div>`;
      return;
    }
    const previousStatus = session.status;
    session = e.record;

    if (session.status === "voting" && previousStatus !== "voting") {
      const remainingMs = session.voting_ends_at ? new Date(session.voting_ends_at).getTime() - Date.now() : DEFAULT_VOTE_SECONDS * 1000;
      beginVoteTimer(Math.max(0, remainingMs / 1000));
    } else if (session.status !== "voting") {
      clearVoteTimer();
    }
    if (session.status === "idle" && previousStatus !== "idle") {
      counts = { pour: 0, contre: 0, abstention: 0 };
      total = 0;
    }
    render();
  });

  pb.collection('votes').subscribe('*', (e) => {
    if (e.record.session === session.id) {
      if (e.action === 'create') {
        counts[e.record.choice]++;
        total++;
        render();
      } else if (e.action === 'delete') {
        counts[e.record.choice]--;
        total--;
        render();
      }
    }
  });
}

async function joinSession() {
  if (!code) {
    app.innerHTML = `<div class="card center hint">Lien invalide. <a href="index.html">Démarrer une nouvelle session</a></div>`;
    return;
  }
  if (!hostSecret) {
    return showWaitingRoomRequest();
  }
  
  try {
    session = await pb.collection('sessions').getFirstListItem(`code="${code}"`);
    if (session.hostSecret !== hostSecret) throw new Error("Invalid secret");
    
    const votes = await pb.collection('votes').getFullList({ filter: `session="${session.id}"` });
    counts = { pour: 0, contre: 0, abstention: 0 };
    total = votes.length;
    for (const v of votes) counts[v.choice]++;
    
    attachPbListeners();

    subscribeToPresence(session.id, (count) => {
      onlineCount = count;
      render();
    });

    if (session.status === "voting" && session.voting_ends_at) {
      const remaining = new Date(session.voting_ends_at).getTime() - Date.now();
      if (remaining > 0) beginVoteTimer(Math.round(remaining/1000));
      else stopVoting();
    }
    
    render();
  } catch(err) {
    app.innerHTML = `<div class="card center hint">Lien invalide ou expiré. <a href="index.html">Démarrer une nouvelle session</a></div>`;
  }
}

joinSession();

// Typst generation logic (unchanged except removing onlineCount parameter usage)
let isTypstInitialized = false;

async function downloadPdf() {
  const btn = document.getElementById("downloadPdfBtn");
  const originalText = btn.innerHTML;
  btn.innerHTML = "Génération...";
  btn.disabled = true;

  try {
    const { $typst } = await import('https://cdn.jsdelivr.net/npm/@myriaddreamin/typst.ts/dist/esm/contrib/all-in-one-lite.bundle.js');
    if (!isTypstInitialized) {
      await $typst.setCompilerInitOptions({
        getModule: () => 'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0/pkg/typst_ts_web_compiler_bg.wasm'
      });
      
      const fontUrls = [
        'fonts/Arial.ttf',
        'fonts/Arial Bold.ttf',
        'fonts/Courier New.ttf',
        'fonts/FiraCode-Regular.ttf',
        'fonts/Helvetica.ttc',
        'fonts/Menlo.ttc'
      ];
      const fontBuffers = (await Promise.all(
        fontUrls.map(path => fetch(path).then(r => r.arrayBuffer()).catch(() => null))
      )).filter(Boolean).map(buf => new Uint8Array(buf));

      if (fontBuffers.length) {
        const { TypstSnippet } = await import('https://cdn.jsdelivr.net/npm/@myriaddreamin/typst.ts/dist/esm/contrib/all-in-one-lite.bundle.js');
        $typst.use(TypstSnippet.preloadFonts(fontBuffers));
      }
      isTypstInitialized = true;
    }

    const fetchTypstFile = async (path) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Impossible de charger ${path}`);
      return res.text();
    };

    const [libTyp, translationsTyp, showy, func, id, pre, sections, shadows] = await Promise.all([
      fetchTypstFile('/typ/vote-card/lib.typ'),
      fetchTypstFile('/typ/vote-card/translations.typ'),
      fetchTypstFile('/typ/showybox/showy.typ'),
      fetchTypstFile('/typ/showybox/lib/func.typ'),
      fetchTypstFile('/typ/showybox/lib/id.typ'),
      fetchTypstFile('/typ/showybox/lib/pre-rendering.typ'),
      fetchTypstFile('/typ/showybox/lib/sections.typ'),
      fetchTypstFile('/typ/showybox/lib/shadows.typ')
    ]);

    $typst.addSource('/typ/vote-card/lib.typ', libTyp);
    $typst.addSource('/typ/vote-card/translations.typ', translationsTyp);
    
    $typst.addSource('/typ/showybox/showy.typ', showy);
    $typst.addSource('/typ/showybox/lib/func.typ', func);
    $typst.addSource('/typ/showybox/lib/id.typ', id);
    $typst.addSource('/typ/showybox/lib/pre-rendering.typ', pre);
    $typst.addSource('/typ/showybox/lib/sections.typ', sections);
    $typst.addSource('/typ/showybox/lib/shadows.typ', shadows);

    const historyList = await pb.collection('history').getFullList({ filter: `session="${session.id}"`, sort: '+numero' });
    const allResults = historyList.map(h => ({ numero: h.numero, pour: h.pour, contre: h.contre, abstention: h.abstention, total: h.total }));

    if (total > 0 || (session && session.status === "results")) {
      allResults.push({ numero: allResults.length + 1, pour: counts.pour, contre: counts.contre, abstention: counts.abstention, total: total });
    }

    const cardsTypst = allResults.map(r => `  [#vote-card(numero: ${r.numero}, pour: ${r.pour}, contre: ${r.contre}, abstention: ${r.abstention}, connexions: ${r.total})]`).join(',\n');

    const dateStr = new Date().toLocaleString('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const typstCode = `
#import "/typ/vote-card/lib.typ": vote-card
#import "/typ/showybox/showy.typ": *

#set page(margin: 1.5cm, fill: rgb("#ffffff"), footer: align(center)[Page #context here().page() sur #context counter(page).final().at(0) ])
#set text(font: ("Helvetica", "Arial", "sans-serif"))

#showybox(
  frame: (
    radius: 0pt,
    thickness: 0.5pt,
  ),
  shadow: (
    offset: 3pt,
  ),
  align: center,
  align(center)[#text(size: 15pt)[Résultats des votes de la session ${session ? session.code : ''}]],
)

#v(2em)
Document généré le ${dateStr}

#v(2em)
#grid(
  columns: 3,
  stroke: .0pt,
  column-gutter: 1em,
  row-gutter: 1em,
  inset: 5pt,
  align: center + horizon,
${cardsTypst}
)
`;

    $typst.addSource('/main.typ', typstCode);
    const pdfBytes = await $typst.pdf({ mainFilePath: '/main.typ' });

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    alert("Erreur lors de la génération du PDF : " + err.message);
    console.error(err);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}


async function showWaitingRoomRequest() {
  app.innerHTML = `
    <div class="card center" style="padding: 25px; max-width: 350px;">
      <h3 style="margin-bottom:10px;">Demande d'accès organisateur</h3>
      <p style="margin-bottom:20px;">Session : <strong>${code}</strong></p>
      <input type="text" id="reqName" placeholder="Votre prénom..." style="width:100%; margin-bottom:15px; padding:10px; border-radius:5px; border:1px solid #ccc; font-size:16px;" />
      <button id="reqBtn" class="primary" style="width:100%">Demander l'accès</button>
      <p id="reqErr" class="hint" style="color:var(--danger); display:none; margin-top:15px;"></p>
    </div>
  `;
  document.getElementById("reqBtn").onclick = async () => {
    const name = document.getElementById("reqName").value.trim();
    const btn = document.getElementById("reqBtn");
    const err = document.getElementById("reqErr");
    if (!name) return;
    
    btn.disabled = true;
    err.style.display = "none";
    try {
      const sessionObj = await pb.collection('sessions').getFirstListItem(`code="${code}"`);
      const req = await pb.collection('host_requests').create({
        session: sessionObj.id,
        name: name,
        status: 'pending'
      });
      app.innerHTML = `<div class="card center hint">Demande envoyée.<br><br>En attente de l'approbation de l'organisateur principal...</div>`;
      
      pb.collection('host_requests').subscribe(req.id, (e) => {
        if (e.action === 'update' && e.record.status === 'approved') {
           sessionStorage.setItem("hostCode", code);
           sessionStorage.setItem("hostSecret", e.record.secret_delivery);
           window.location.reload();
        } else if (e.action === 'update' && e.record.status === 'rejected') {
           app.innerHTML = `<div class="card center hint" style="color:var(--danger)">L'accès vous a été refusé.</div>`;
        } else if (e.action === 'delete') {
           app.innerHTML = `<div class="card center hint">Cette session a été clôturée et n'est plus disponible.<br><br><a href="index.html">Retour à l'accueil</a></div>`;
        }
      });
    } catch(e) {
      err.textContent = "Erreur : " + e.message;
      err.style.display = "block";
      btn.disabled = false;
    }
  };
}

async function updateWaitingRoomBadge() {
  if (!session) return;
  try {
    const reqs = await pb.collection('host_requests').getFullList({ filter: `session="${session.id}" && status="pending"` });
    const btn = document.getElementById("waitingRoomBtn");
    if (!btn) return;
    if (reqs.length > 0) {
      btn.textContent = `Salle d'attente (${reqs.length})`;
      btn.style.display = "block";
      btn.onclick = () => openWaitingRoomModal(reqs);
      const newReqsJson = JSON.stringify(reqs.map(r => r.id + r.name + r.status));
      if (document.getElementById("waitingModal") && lastReqsJson !== newReqsJson) {
        openWaitingRoomModal(reqs);
      }
      lastReqsJson = newReqsJson;
    } else {
      btn.style.display = "none";
      closeWaitingRoomModal();
    }
  } catch(e) {}
}

function openWaitingRoomModal(reqs) {
  closeWaitingRoomModal();
  let listHtml = reqs.map(r => `
    <div style="display:grid; grid-template-columns: minmax(0, 1fr) auto; align-items:center; margin-bottom:12px; background:var(--paper-2); padding:10px 15px; border-radius:var(--radius); border:1px solid var(--rule); gap: 15px;">
      <strong style="font-size:18px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${r.name.replace(/"/g, '&quot;')}">${r.name}</strong>
      <div style="display:flex; gap:10px;">
        <button onclick="approveRequest('${r.id}')">Approuver</button>
        <button class="danger" onclick="rejectRequest('${r.id}')">Refuser</button>
      </div>
    </div>
  `).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="waitingModal" style="display:flex; z-index: 1000;">
      <div class="modal-content" style="max-width:500px; width:80%; padding:20px;">
        <span class="modal-close" onclick="closeWaitingRoomModal()">&times;</span>
        <h3 style="margin-bottom:20px; color:var(--navy-1);">Demandes d'accès</h3>
        ${listHtml}
      </div>
    </div>
  `);
}

window.closeWaitingRoomModal = function() {
  const m = document.getElementById("waitingModal");
  if (m) m.remove();
}
window.approveRequest = async (reqId) => {
  try {
    await pb.collection('host_requests').update(reqId, { status: 'approved', secret_delivery: hostSecret });
    updateWaitingRoomBadge();
  } catch(e) { alert(e.message); }
};
window.rejectRequest = async (reqId) => {
  try {
    await pb.collection('host_requests').update(reqId, { status: 'rejected' });
    updateWaitingRoomBadge();
  } catch(e) { alert(e.message); }
};

