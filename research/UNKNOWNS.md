# UNKNOWNS — valori non estratti

Regola applicata: se non l'ho misurato, non lo scrivo nello spec e non lo invento. Qui c'è tutto ciò che manca, con quanto pesa sulla Fase 2.

Aggiornato dopo la **Fase 1-bis** (2026-08-06). Due dei tre bloccanti sono chiusi.

---

## ✅ CHIUSI in Fase 1-bis

### ~~1. Stagger di apertura del pannello Filters~~ → **non esiste**
Run mirato (`measure/03-phase1bis.js`): apertura del pannello con campionamento a 60fps di `getComputedStyle` + `getAnimations()` su tutte le voci per 2200 ms.

`getAnimations()` restituisce **insieme vuoto** su tutti i 54 campioni. `animation` computed = `none`. Le voci compaiono già al valore finale di opacity (`1` inattive, `0.6` attiva), senza alcun valore intermedio campionato.

**Nessuno stagger, nessun fade d'ingresso.** L'unica cosa animata all'apertura è lo scrim navbar (`height 215% → 260%`, `0.3s ease`). Documentato in ANIMATION_SPEC §D1.

### ~~2. Algoritmo del layout "Natural Grid"~~ → **estratto**
Nessun chunk lazy: il codice era già nei bundle iniziali (classe `svelte-wgw4ly`). È una CSS grid reale (`repeat(var(--columns), 1fr)`, `--columns: 10` desktop / `4` mobile) con scroll nativo sul contenitore e parallasse per-item guidata da due custom properties calcolate in JS.

25 parametri estratti, tutti M1. Documentato in ANIMATION_SPEC §E2.

---

## 🟡 Aperto — non bloccante per la home

### 3. Trigger della transizione home ↔ /info
**Cosa manca:** il CSS dichiara la View Transitions API (`view-transition-name: navbar`, `::view-transition-old/new(work-page)` a `0.35s ease-out`), ma **non ho trovato una chiamata letterale a `startViewTransition`** in nessuno dei 21 bundle.

**Perché ora lo declasso a non bloccante:** la Fase 1-bis ha confermato per misura che /info è un overlay `position: fixed`, `z-index: 9`, montato **sopra** il canvas che resta vivo, e che il passaggio percepito è il crossfade dei layer — la cui curva ho verificato per fitting (`ease`, 396 ms misurati vs 400 ms dichiarati, RMS 0.0145). Quindi per la home la meccanica è chiusa e misurata.

Le regole `::view-transition-*(work-page)` restano rilevanti **solo per `/works/*`**, che nel tuo brief non è nello scope (il brief dice "home"). Se in Fase 2 vuoi anche le pagine opera, va riaperto.

---

### ~~4. Tre costanti del componente griglia non identificate~~ → **RISOLTE**
`N0:652-654` definisce tre valori nello stesso blocco delle costanti che ho decodificato:

| Simbolo | Valore | Uso (risolto in PARITY-MASK §4) |
|---|---|---|
| `N` | `50` | ms per frame del **galoppo di intro** (`setInterval`, N0:872) |
| `I` | `400` | ms di **pausa** tra fine galoppo e zoom-in finale (N0:872) |
| `ce` | `1800` | ms dello **zoom-in finale** 0.4 → 1.5, easeInOutCubic (N0:878) |

Erano illeggibili perché il bundle riusa gli identificatori tra scope: è stato il
contesto della maschera (`playFrames`) a renderle interpretabili.

L'ipotesi che `1800` e `400` fossero durate in ms era corretta. Ora sono usate
nell'implementazione, con riferimento.

---

### 5. Istante di inizio del fade di loading
**Valore misurato:** ~1790 ms da `DOMContentLoaded` (M2, singolo run).
**Perché resta a confidenza media:** dipende dalla latenza di rete e dalla decodifica delle immagini Sanity, non da una costante. Non c'è delay artificiale nel codice: il fade parte quando le immagini sono pronte.
**Impatto:** nessuno. Nel clone partirà quando sono pronte le *tue* immagini. Non è un numero da replicare.

---

## Note di metodo

**M3 (fitting frame-by-frame) è servito una sola volta**, per il crossfade del View toggle (§E1) — e ha **confermato** il letterale CSS invece di sostituirlo. Tutte le altre curve del sito sono in forma chiusa: due funzioni di easing esplicite nel JS (easeInOutCubic `N0:769`, easeInOutQuad `N0:960/966`) e stringhe CSS dichiarate. Quindi la soglia di Fase 3 "<0.02 sui punti di controllo delle bezier" si verifica in gran parte **per identità**, non per fitting.

**Avvertimento sul lerp — richiede una tua scelta.** Lo smoothing a fattore `0.15` per frame (`N0:791`) non compensa il delta-time: il sito **si comporta diversamente a 60 Hz e a 120 Hz** (a 120 Hz converge in circa metà tempo). Lo implemento identico, non "corretto" con un `dt`, perché la parità 1:1 è il requisito. Due conseguenze da tenere presenti:

1. In Fase 3 il confronto originale-vs-clone va fatto **forzando lo stesso frame rate su entrambi**, altrimenti il diff misura l'hardware invece del codice.
2. Se in futuro vorrai il comportamento indipendente dal refresh rate, la modifica è `fattore_effettivo = 1 − (1 − 0.15)^(dt/16.67)`. Non la applico ora: divergerebbe dall'originale sui monitor ad alto refresh, che è esattamente ciò che stiamo replicando.

**Assenza di asset.** `/assets/` è vuota. Finché non ci metti i tuoi materiali, la Fase 2 userà placeholder generati e dichiarati come tali. Nessun asset, testo, logo o immagine dell'originale finirà nel repo.
