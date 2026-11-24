// Service worker: tiene in memoria la pagina e le librerie, così l'app si apre anche senza rete.
// Se modifichi i file della pagina, cambia il numero di VERSIONE qui sotto.
const VERSIONE = "dl-1";
const FILE = ["./", "index.html", "app.js", "logic.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSIONE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || !(u.origin === location.origin || u.hostname === "www.gstatic.com")) return;
  e.respondWith(caches.open(VERSIONE).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net; // risposta subito dalla memoria e aggiornamento in sottofondo
  }));
});
