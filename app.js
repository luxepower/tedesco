import { firebaseConfig } from "./config.js";
import { CATS, Review } from "./logic.js";

const $ = (s) => document.querySelector(s);
const VER = "10.14.1", BASE = `https://www.gstatic.com/firebasejs/${VER}/`;
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memoria piena o bloccata */ } },
};

const review = new Review();
review.dir = store.get("dl_dir", "de2it");
const saved = store.get("dl_cats", null);
if (Array.isArray(saved)) review.cats = saved.filter((k) => CATS.some((c) => c[0] === k));

let fb = null, uid = null, unsub = null, first = true, synced = false, online = navigator.onLine;
let meta = { pending: false };

const show = (id) => { for (const s of ["setup", "login", "app"]) $("#" + s).hidden = s !== id; };

// ---------- disegno
function btn(text, cls, fn) {
  const b = document.createElement("button");
  b.textContent = text; b.className = cls; b.onclick = fn;
  return b;
}
function renderChips() {
  const counts = review.counts(), box = $("#chips");
  box.innerHTML = "";
  for (const [k, lab] of CATS) {
    box.append(btn(`${lab} · ${counts[k] || 0}`, "chip" + (review.cats.includes(k) ? " on" : ""), () => {
      review.toggleCat(k); store.set("dl_cats", review.cats); renderAll();
    }));
  }
  box.append(btn("Tutte", "chip ghost", () => { review.allCats(); store.set("dl_cats", review.cats); renderAll(); }));
}
function renderCard() {
  const v = review.view(), act = $("#actions");
  act.innerHTML = "";
  if (!v) {
    const e = review.emptyInfo();
    $("#lang").textContent = ""; $("#word").textContent = e.title; $("#plural").textContent = "";
    $("#example").textContent = e.sub; $("#hint").textContent = "";
    return;
  }
  $("#lang").textContent = `${v.label}  ·  ${v.cat.toUpperCase()}`;
  $("#word").textContent = v.text;
  $("#plural").textContent = v.plural ? "Plurale: " + v.plural : "";
  $("#example").textContent = v.example;
  $("#hint").textContent = review.shown ? "" : "Tocca la carta per girarla";
  if (!review.shown) act.append(btn("Mostra risposta", "primary", flip));
  else act.append(btn("Non lo so", "", () => answer(false)), btn("Lo so", "primary", () => answer(true)));
}
function renderStatus() {
  const el = $("#status");
  let t = "Sincronizzato", c = "ok";
  if (!online) { t = "Offline"; c = "off"; }
  else if (meta.pending) { t = "Invio…"; c = ""; }
  else if (!synced) { t = "Connessione…"; c = ""; }
  el.textContent = t; el.className = c;
}
function renderAll() {
  for (const b of document.querySelectorAll("#dir button")) b.classList.toggle("on", b.dataset.dir === review.dir);
  renderChips(); renderCard(); renderStatus();
  $("#counter").textContent = `${review.done} fatte · ${review.due().length} da ripassare`;
  $("#barfill").style.width = Math.round(review.progress() * 100) + "%";
}

// ---------- azioni
function flip() { review.flip(); renderCard(); }
function answer(ok) {
  const upd = review.answer(ok);
  if (upd && fb) {
    const now = Date.now(); // solo i progressi: le parole le modifica il PC
    fb.fs.updateDoc(fb.fs.doc(fb.db, "users", uid, "words", upd.gid),
      { box: upd.box, next_ts: upd.next_ts, pupd: now, mod: now }).catch((e) => console.error(e));
  }
  renderAll();
}
$("#card").onclick = () => { if (review.cur && !review.shown) flip(); };
for (const b of document.querySelectorAll("#dir button")) b.onclick = () => { review.setDir(b.dataset.dir); store.set("dl_dir", review.dir); renderAll(); };
document.addEventListener("keydown", (e) => {
  if ($("#app").hidden) return;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (review.cur && !review.shown) flip(); }
  else if (e.key === "ArrowRight" && review.shown) answer(true);
  else if (e.key === "ArrowLeft" && review.shown) answer(false);
});
window.addEventListener("online", () => { online = true; renderStatus(); });
window.addEventListener("offline", () => { online = false; renderStatus(); });
setInterval(() => { if (!$("#app").hidden) { if (!review.cur) review.next(); renderAll(); } }, 30000);

// ---------- Firebase
function subscribe() {
  if (unsub) unsub();
  first = true; synced = false; review.words.clear(); review.cur = null;
  unsub = fb.fs.onSnapshot(fb.fs.collection(fb.db, "users", uid, "words"), { includeMetadataChanges: true }, (snap) => {
    meta = { pending: snap.metadata.hasPendingWrites };
    if (!snap.metadata.fromCache) synced = true;
    snap.docChanges().forEach((ch) => {
      if (ch.type === "removed") review.removeWord(ch.doc.id); else review.setWord(ch.doc.id, ch.doc.data());
    });
    if (first && review.words.size) { first = false; review.startSession(); } else if (!review.cur) review.next();
    renderAll();
  }, (err) => { $("#status").textContent = "Errore: " + (err.code || err.message); $("#status").className = "off"; });
}
const authErr = (e) => ({
  "auth/invalid-credential": "Email o password non corrette.", "auth/wrong-password": "Email o password non corrette.",
  "auth/user-not-found": "Email o password non corrette.", "auth/invalid-email": "Email non valida.",
  "auth/too-many-requests": "Troppi tentativi: riprova fra qualche minuto.", "auth/network-request-failed": "Nessuna connessione.",
}[e.code] || "Accesso non riuscito (" + (e.code || e.message) + ").");

async function boot() {
  const c = firebaseConfig;
  if (!c.apiKey || c.apiKey.startsWith("INCOLLA") || !c.projectId) return show("setup");
  show("login");
  let mods;
  try {
    mods = await Promise.all([import(BASE + "firebase-app.js"), import(BASE + "firebase-firestore.js"), import(BASE + "firebase-auth.js")]);
  } catch {
    $("#loginMsg").textContent = "Al primo avvio serve la connessione a internet.";
    return;
  }
  const [{ initializeApp }, fs, au] = mods;
  const app = initializeApp(c);
  let db;
  try { // copia dei dati sul telefono, per usare l'app anche senza rete
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch { db = fs.getFirestore(app); }
  const auth = au.getAuth(app);
  fb = { fs, au, db, auth };
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#loginMsg").textContent = "Accesso…";
    try { await au.signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#pw").value); $("#pw").value = ""; }
    catch (er) { $("#loginMsg").textContent = authErr(er); }
  };
  $("#logout").onclick = () => au.signOut(auth);
  au.onAuthStateChanged(auth, (u) => {
    if (!u) { if (unsub) unsub(); uid = null; $("#loginMsg").textContent = ""; return show("login"); }
    uid = u.uid; show("app"); subscribe(); renderAll();
  });
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
