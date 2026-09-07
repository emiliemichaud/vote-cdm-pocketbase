function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

document.getElementById("createBtn").addEventListener("click", async () => {
  const btn = document.getElementById("createBtn");
  const err = document.getElementById("err");
  btn.disabled = true;
  err.style.display = "none";

  try {
    let code = '';
    let isUnique = false;
    for (let i = 0; i < 5; i++) {
      code = generateCode();
      try {
        await pb.collection('sessions').getFirstListItem(`code="${code}"`);
      } catch (e) {
        // If it throws, it means it doesn't exist, which is what we want
        isUnique = true;
        break;
      }
    }

    if (!isUnique) throw new Error("Impossible de générer un code unique.");

    const hostSecret = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    
    await pb.collection('sessions').create({
      code,
      hostSecret,
      status: 'idle'
    });

    const url = new URL("host.html", window.location.href);
    url.searchParams.set("s", code);
    url.searchParams.set("t", hostSecret);
    window.location.href = url.toString();
  } catch (error) {
    err.textContent = "Erreur : " + error.message;
    err.style.display = "block";
    btn.disabled = false;
  }
});

document.getElementById("joinHostBtn").addEventListener("click", (e) => {
    e.preventDefault();
    const joinErr = document.getElementById("joinErr");
    const code = document.getElementById("joinCode").value.trim().toUpperCase();
    joinErr.style.display = "none";
    if (!code) {
      joinErr.textContent = "Veuillez d'abord saisir un code de session.";
      joinErr.style.display = "block";
      return;
    }
    const url = new URL("host.html", window.location.href);
    url.searchParams.set("s", code);
    window.location.href = url.toString();
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
