const socket = getSocket();

document.getElementById("createBtn").addEventListener("click", () => {
  const btn = document.getElementById("createBtn");
  const err = document.getElementById("err");
  btn.disabled = true;
  err.style.display = "none";

  socket.emit("create-session", {}, (res) => {
    if (!res.ok) {
      err.textContent = "Erreur : " + res.error;
      err.style.display = "block";
      btn.disabled = false;
      return;
    }
    const url = new URL("host.html", window.location.href);
    url.searchParams.set("s", res.code);
    url.searchParams.set("t", res.hostSecret);
    window.location.href = url.toString();
  });
});

document.getElementById("joinBtn").addEventListener("click", () => {
  const joinErr = document.getElementById("joinErr");
  const code = document.getElementById("joinCode").value.trim().toUpperCase();
  joinErr.style.display = "none";
  if (!code) {
    joinErr.textContent = "Saisis d'abord un code de session.";
    joinErr.style.display = "block";
    return;
  }
  window.location.href = voteUrlForCode(code);
});

document.getElementById("joinCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("joinBtn").click();
});
