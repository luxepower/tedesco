// Logica del ripasso: identica a quella dell'app sul PC (livelli e scadenze).
export const INTERVALS = [0, 1, 3, 7, 14, 30]; // giorni per livello
export const CATS = [["nome", "Nomi"], ["verbo", "Verbi"], ["agg", "Aggettivi"], ["avv", "Avverbi"], ["altro", "Altro"]];
export const CAT_NAME = { nome: "Nome", verbo: "Verbo", agg: "Aggettivo", avv: "Avverbio", altro: "Altro" };

// Dopo «Lo so» sale di livello e la carta torna più tardi; dopo «Non lo so» riparte da zero e torna fra 5 minuti.
export function grade(box, ok, nowSec) {
  if (ok) {
    const b = Math.min((box || 0) + 1, INTERVALS.length - 1);
    return { box: b, next_ts: nowSec + INTERVALS[b] * 86400 };
  }
  return { box: 0, next_ts: nowSec + 300 };
}

// Una carta è da ripassare se ha la traduzione ed è scaduta (le parole «da tradurre» restano fuori).
export const isDue = (w, nowSec) => !!w.it && (w.next_ts || 0) <= nowSec;

const catOf = (w) => w.cat || "altro";

export function dueList(words, cats, nowSec) {
  const sel = new Set(cats);
  return words.filter((w) => sel.has(catOf(w)) && isDue(w, nowSec));
}

export function dueCounts(words, nowSec) {
  const out = {};
  for (const w of words) if (isDue(w, nowSec)) out[catOf(w)] = (out[catOf(w)] || 0) + 1;
  return out;
}

// Fra quanti secondi scade la prossima carta delle categorie scelte (null se non ce ne sono).
export function nextDueIn(words, cats, nowSec) {
  const sel = new Set(cats);
  let best = null;
  for (const w of words) {
    if (!w.it || !sel.has(catOf(w))) continue;
    const t = (w.next_ts || 0) - nowSec;
    if (t > 0 && (best === null || t < best)) best = t;
  }
  return best;
}

export function fmtWait(sec) {
  if (sec < 90) return "meno di un minuto";
  if (sec < 3600) return `${Math.round(sec / 60)} minuti`;
  if (sec < 86400) return `${Math.round(sec / 3600)} ore`;
  return `${Math.round(sec / 86400)} giorni`;
}

// Carta casuale, evitando di ripetere subito l'ultima se c'è altra scelta.
export function pick(list, lastGid, rnd = Math.random) {
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter((w) => w.gid !== lastGid) : list;
  return pool[Math.floor(rnd() * pool.length)];
}

// Stato del ripasso (senza interfaccia: così si può provare da solo).
export class Review {
  constructor(now = () => Date.now() / 1000, rnd = Math.random) {
    this.now = now; this.rnd = rnd;
    this.words = new Map();
    this.cats = CATS.map((c) => c[0]);
    this.dir = "de2it"; // de2it = tedesco → italiano
    this.cur = null; this.shown = false; this.done = 0; this.total = 0; this.last = null;
  }
  setWord(gid, data) {
    this.words.set(gid, { ...data, gid });
    if (this.cur && this.cur.gid === gid) this.cur = this.words.get(gid);
  }
  removeWord(gid) {
    this.words.delete(gid);
    if (this.cur && this.cur.gid === gid) { this.cur = null; this.shown = false; }
  }
  all() { return [...this.words.values()]; }
  due() { return dueList(this.all(), this.cats, this.now()); }
  counts() { return dueCounts(this.all(), this.now()); }
  startSession() { this.done = 0; this.total = this.due().length; this.next(); }
  next() {
    this.cur = pick(this.due(), this.last, this.rnd);
    this.shown = false;
    if (this.cur) this.last = this.cur.gid;
    return this.cur;
  }
  toggleCat(k) {
    const i = this.cats.indexOf(k);
    if (i >= 0) this.cats.splice(i, 1); else this.cats.push(k);
    this.startSession();
  }
  allCats() { this.cats = CATS.map((c) => c[0]); this.startSession(); }
  setDir(d) { this.dir = d; }
  flip() { if (this.cur) this.shown = true; }
  // Registra la risposta: restituisce i campi da salvare nel cloud (o null) e passa alla carta dopo.
  answer(ok) {
    if (!this.cur || !this.shown) return null;
    const g = grade(this.cur.box, ok, this.now());
    Object.assign(this.cur, g);
    this.done++;
    const out = { gid: this.cur.gid, ...g };
    this.next();
    return out;
  }
  progress() { return this.done / Math.max(this.total, this.done + this.due().length, 1); }
  // Cosa mostrare sulla carta (come sul PC: il plurale compare dove c'è il tedesco).
  view() {
    const w = this.cur;
    if (!w) return null;
    const de2it = this.dir === "de2it";
    const showing = this.shown ? !de2it : de2it; // true = la parte visibile è il tedesco
    return {
      cat: CAT_NAME[w.cat || "altro"],
      label: showing ? "TEDESCO" : "ITALIANO",
      text: this.shown ? (de2it ? w.it : w.de) : (de2it ? w.de : w.it),
      plural: w.pl && (de2it || this.shown) ? w.pl : "",
      example: this.shown ? (w.es || "") : "",
    };
  }
  emptyInfo() {
    if (!this.cats.length) return { title: "Nessuna categoria selezionata", sub: "Attiva almeno una categoria qui sopra." };
    if (!this.words.size) return { title: "Nessuna parola", sub: "Le parole arrivano dal PC: apri l’app sul PC per sincronizzarle." };
    const t = nextDueIn(this.all(), this.cats, this.now());
    return { title: "Tutto ripassato ✓", sub: t === null ? "Non ci sono altre carte." : `Prossima carta fra ${fmtWait(t)}.` };
  }
}
