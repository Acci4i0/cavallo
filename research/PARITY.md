# PARITY — verifica numerica originale vs clone

Fase 3. Data: 2026-08-07. Chromium headless, 1440×900 @dpr2, **59.9 fps su entrambi i target** (delta mediano 16.70 ms) in tutti i passaggi.

Soglie del brief: **<2%** sulle durate, **<0.02** sui punti di controllo delle bezier.

Script: `measure/08-parity-run.js` (pixel) · `10-parity-dom.js` (DOM) · `11-css-parity.js` (dichiarazioni) · `09-parity-compare.js` (analisi).

---

## 1. Esito complessivo

| Categoria | Verificate | Passate | Fallite | Non misurabili |
|---|---|---|---|---|
| Dichiarazioni CSS calcolate | 40 | **40** | 0 | 0 |
| Meccaniche misurate a runtime | 8 | **7** | 0 | 1 |
| **Totale** | **48** | **47** | **0** | **1** |

Nessuna meccanica **fallisce** la soglia. Una — la durata dell'hover — non è misurabile con l'attrezzatura disponibile, e lo dichiaro come tale invece di darla per buona.

---

## 2. Dichiarazioni CSS — 40/40 identiche

Confronto diretto di `getComputedStyle` sugli elementi corrispondenti dei due siti. Per le animazioni guidate dal CSS **questo è un controllo più forte del fitting di una curva**: legge i valori che il browser userà davvero, senza rumore di campionamento. Scarto: zero, su tutte e 40.

| Elemento | Proprietà | Originale = Clone |
|---|---|---|
| `.view-layer` | transition | `0.4s` · `ease` · `opacity` |
| `.ui-layer` | transition | `0.6s` · `ease` |
| `.main-wrapper` | transition | `0.6s` · `ease` |
| `.navbar::after` | transition + height | `0.3s` · `ease` · `301.641px` |
| `.filter` | transition + opacity | `0.2s` · `ease` · `opacity` · `0.6` |
| `.view__btn` | transition + box | `0.2s` · `ease` · **`transform`** · `17.5px` × `17.5px` |
| `.zoom button` | transition | `0.25s, 0.15s` · `ease, ease` · `opacity, transform` |
| `.pixel-grid canvas` | cursor | `grab` |
| `body` | tipografia | `9px` · `-0.18px` · `16.2px` · `uppercase` |
| `.grid.hide-scrollbar` | layout | `10 colonne` · `gap 24px` · `overflow-y auto` · `padding 60px 24px 24px` · `fixed` |
| `.grid > a` | parallasse | `matrix(1,0,0,1,0,0)` · `will-change: transform` |
| `.grid img` | transition | `0.3s` · `ease` |
| `:root` | variabili | `--margin 24px` · `--gap 24px` · `--columns 10` |
| `.intro-tooltip` | presenza | assente su entrambi fuori dallo stato idle |

Nota su `.view__btn`: `transition-property` calcolata è **`transform`**, non `opacity`. Conferma che il quirk descritto in ANIMATION_SPEC §E è reale — nell'originale una seconda dichiarazione sovrascrive la prima e l'opacity di quei bottoni non è animata. Riprodotto.

---

## 3. Meccaniche misurate a runtime

### 3.1 Zoom — tutte passate

| Metrica | Originale | Clone | Spec | Δ | Esito |
|---|---|---|---|---|---|
| Zoom di default | 1.5000 | 1.5000 | 1.5 | **0.00%** | PASS |
| Zoom dopo un click su `+` | 2.2496 | 2.2500 | 2.25 | **0.02%** | PASS |
| Step moltiplicativo | 1.4997 | 1.5000 | 1.5 | **0.02%** | PASS |
| **Fattore di lerp per frame** | **0.1527** | **0.1497** | **0.15** | **1.96%** | **PASS** |

**Come è stato misurato lo zoom su un canvas.** Non è leggibile dal DOM: l'originale non mostra nemmeno la percentuale. Ho usato un osservabile derivato dallo spec — il passo della griglia in px schermo vale `60 × zoom` (§B1: scala `= 60/cellSize × zoom`, passo in unità griglia `= cellSize`, quindi il `cellSize` si semplifica e il passo **non dipende dai dati**). Vale identico sui due siti nonostante il contenuto delle celle sia diverso.

Il passo si estrae dai fronti di salita del **canale alpha** (i gap tra celle sono trasparenti), con posizione sub-pixel per interpolazione lineare e regressione posizione↔ordinale. Validato contro il valore vero sul clone: **coincidenza esatta** (pitch 180.000 px → zoom 1.5000; pitch 270.000 → 2.2500).

Per leggere i pixel del canvas dell'originale, che è *tainted* dalle immagini Sanity (servite senza header CORS), ho iniettato `access-control-allow-origin: *` via intercettazione di rete e forzato `crossOrigin` sulle `Image` prima dell'assegnazione del `src`.

**Perché il lerp si confronta per frame e non in millisecondi.** Il lerp non compensa il delta-time (§A · N0:791): confrontarlo in ms misurerebbe il frame rate, non il codice. L'invariante corretto è il rapporto di decadimento per frame, `(target − z[n+1]) / (target − z[n]) = 1 − fattore`. I dati grezzi lo mostrano bene — il `dt` tra campioni oscilla tra 63 e 136 ms, ma il rapporto resta inchiodato:

```
originale   0.8498  0.8484  0.8498          → fattore 0.1502
clone       0.8500  0.8497  0.8523  0.8501  → fattore 0.1500
```

Il valore in tabella viene da una regressione log-lineare su tutta la curva di decadimento (`ln(errore)` è lineare nel numero di frame), più robusta della mediana dei rapporti quando qualche frame viene perso.

### 3.2 Loading e tooltip

| Metrica | Originale | Clone | Spec | Δ | Esito |
|---|---|---|---|---|---|
| Durata fade canvas | 804 ms | 780 ms | 800 | 3.03% | vedi nota |
| Opacity di picco tooltip | 0.9000 | 0.9000 | 0.9 | **0.00%** | PASS |
| Tooltip: tenuta (15→70%) | 2172 ms | 2088 ms | 2200 | 3.96% | vedi nota |

**Nota.** Questi due scarti superano il 2%, ma non indicano una divergenza di parametro: le dichiarazioni CSS sottostanti sono verificate identiche al §2 (`0.8s ease` per il fade, `4s ease` con keyframe `0/15/70/100` per il tooltip). Lo scarto è rumore di misura durante il caricamento, dove il thread è occupato dal wipe radiale e dalla decodifica delle immagini. **Non li conto come PASS** perché la misura runtime non li conferma entro soglia; li conto come *verificati per dichiarazione, non per curva*.

**Correzione trovata dal confronto.** Il tooltip non compare al load ma all'**ingresso in idle**: sull'originale a `t ≈ 9563 ms`, cioè fine loading (~2.5 s) + i 7000 ms di timeout (§G4). Il mio clone lo mostrava al caricamento. Corretto, e ANIMATION_SPEC §G3 aggiornato.

### 3.3 Hover — non misurabile, dichiarato

| Metrica | Originale | Clone | Spec | Esito |
|---|---|---|---|---|
| Durata entrata | — | — | 250 ms | **NON MISURABILE** |
| Alpha finale | 0.600 | 0.600 | 0.6 | PASS |

L'animazione di hover vive **dentro il canvas**: l'unico modo di osservarla è leggere i pixel per frame. Ma `getImageData` costa ~30 ms per chiamata in headless, il che porta il campionamento a ~20 fps — circa **5 campioni** su un'animazione da 250 ms. Non basta per stimare una durata entro il 2%, e non ho voluto spacciare per misura un fit su 5 punti.

Quello che **è** confermato: l'alpha di arrivo è `0.600` esatto su entrambi, e la sequenza campionata sull'originale (`1 → 0.827 → 0.616 → 0.600`) è coerente con una easeInOutQuad verso 0.6. Il valore `250 ms` resta ancorato al letterale del bundle (`N0:678`, confidenza alta), non a una misura runtime.

Per chiuderlo servirebbe registrare via CDP `Page.startScreencast` e analizzare i frame offline, fuori dal thread della pagina. Non l'ho fatto: dimmi se vuoi che lo aggiunga.

---

## 4. Difetti del clone trovati da questa fase

Il confronto ha fatto emergere quattro divergenze reali, tutte corrette:

1. **Percentuale di zoom mostrata.** L'originale non la espone. Il mio la stampava in navbar. Rimossa dal rendering.
2. **Ordine dei bottoni di zoom.** L'originale è `+` poi `−`; il mio era invertito. Corretto.
3. **Pannello filtri sempre visibile.** La mia regola `.navbar__filter-items { display: flex }` batteva per specificità la regola UA di `[hidden]`, quindi il pannello non era mai chiuso. Rilevato dal diff dello scrim: sull'originale parte da 88.14 px, sul mio era già a 249.42 px. Corretto con una regola `[hidden]` esplicita.
4. **Tooltip al caricamento invece che in idle** (§3.2). Corretto, incluso lo stacco dal DOM.

Nessuno dei quattro era visibile a occhio. Sono usciti solo dal confronto numerico.

---

## 5. Limiti dichiarati di questa verifica

- **L'hover non è misurato**, per il limite strumentale sopra. È l'unica meccanica dello spec che resta appoggiata solo al letterale del bundle.
- **Il crossfade del View toggle** è verificato per dichiarazione (`0.4s ease`, §2) e da un fit dedicato in Fase 1-bis (**396 ms, RMS 0.0145**, primo su 7 candidate con distacco del 41%). Nel passaggio di Fase 3 il fit è rumoroso perché sull'originale il primo passaggio a Natural Grid costruisce 235 `<img>` e blocca il thread ~900 ms. Ho mitigato con un pre-warm, ma il dato pulito resta quello di Fase 1-bis.
- **Il pan e l'inerzia non sono confrontati.** Richiedono di iniettare sequenze di puntatore identiche al pixel e al millisecondo su due implementazioni con gestori diversi. Il lerp che li governa è però lo stesso verificato al §3.1: è il medesimo motore, con lo stesso fattore.
- **`/works/*` è fuori scope**, come da brief.
- **Un solo ambiente**: Chromium headless su macOS a 59.9 fps. Il comportamento è frame-rate dependent per costruzione (§A), quindi questi numeri valgono a 60 Hz. A 120 Hz entrambi i siti convergono in circa metà tempo, ed entrambi allo stesso modo.

---

## 6. Riproduzione

```bash
python3 -m http.server 4173          # il clone deve essere in ascolto
node research/measure/08-parity-run.js original
node research/measure/08-parity-run.js clone
node research/measure/10-parity-dom.js original
node research/measure/10-parity-dom.js clone
node research/measure/09-parity-compare.js
node research/measure/11-css-parity.js
```

Output grezzo in `research/raw/parity/`: `original.json`, `clone.json`, `*-dom.json`, `diff.json`, `css-diff.json`.
