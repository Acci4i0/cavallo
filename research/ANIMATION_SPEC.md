# ANIMATION_SPEC — jinleeoffice.com

Data misura: 2026-08-06. Riferimenti file → `/research/bundles/`.
`N0` = `nodes/0.8FshwVoq.js` (beautified, 1036 righe) · `C0` = `css/0.ltaFBs3n.css` · `CN` = `css/naturalGrid.DE_z6Qf6.css`

**Metodo** (in ordine di affidabilità, come da brief):
- **M1** = valore letterale nel bundle, con file:riga. Confidenza **alta**.
- **M2** = campionamento runtime a 60fps di `getComputedStyle` / stato DOM. Confidenza **alta** se coincide con M1, **media** se solo M2.
- **M3** = fitting frame-by-frame. *Non è stato necessario per nessun parametro*: tutte le curve sono definite in forma chiusa nel bundle (funzioni di easing esplicite) o dichiarate nel CSS.

Tutti i valori qui sotto sono estratti. Nessuno è stimato. Quello che non sono riuscito a estrarre è in `UNKNOWNS.md`, non qui.

---

## 0. Costanti globali del motore

| Simbolo | Valore | Significato | Fonte |
|---|---|---|---|
| cella base | `60` px | dimensione di riferimento di una cella a zoom 1 | M1 `N0:644` |
| breakpoint mobile | `innerWidth <= 768` | commuta i valori marcati "mobile" | M1 `N0:645` |
| zoom min | `0.4` desktop / `0.1` mobile | | M1 `N0:646` |
| zoom max | `5` | | M1 `N0:647` |
| step zoom | `1.5` (moltiplicativo) | | M1 `N0:648` |
| zoom idle | `0.4` desktop / `0.1` mobile | | M1 `N0:649` |
| zoom default | `1.5` | valore all'ingresso e al reset | M1 `N0:650` |
| durata reveal | `1500` ms | | M1 `N0:651` |
| cap DPR | `2` | canvas 2880×1800 su viewport 1440×900 | M1 `N0:664` + M2 |
| timeout idle | `7000` ms | | M1 `N0:671` |
| durata tween idle | `1200` ms | | M1 `N0:672` |
| durata hover | `250` ms | | M1 `N0:678` |
| padding griglia | `20%` di width e height, per lato | usato in clamp e centratura | M1 `N0:786,788` |

### Funzioni di easing usate (le uniche due nel motore)

| Nome | Forma | cubic-bezier equivalente | Fonte |
|---|---|---|---|
| **easeInOutCubic** | `t<0.5 ? 4t³ : 1-(-2t+2)³/2` | `(0.65, 0, 0.35, 1)` | M1 `N0:769` |
| **easeInOutQuad** | `t<0.5 ? 2t² : 1-(-2t+2)²/2` | `(0.45, 0, 0.55, 1)` | M1 `N0:960, 966` |

Il CSS usa `cubic-bezier(.65,0,.35,1)` esplicito in un punto (`CN:35`) — che è **la stessa curva** di easeInOutCubic. Coerenza confermata.

---

## A. Pan / "scroll" — fisica

Non c'è scroll di pagina. C'è pan di un canvas. Tre sorgenti di input, **tre comportamenti diversi**.

| Meccanica | Proprietà | Valore | Easing | Durata | Fonte | Conf. |
|---|---|---|---|---|---|---|
| **Wheel / trackpad** | pan x,y | `x -= deltaX`, `y -= deltaY`, **1:1 diretto** | nessuna | istantanea (0 ms) | M1 `N0:923-927` | alta |
| Wheel: listener | — | `{ passive: false }` + `preventDefault()` | — | — | M1 `N0:978` | alta |
| **Drag mouse** | pan x,y | 1:1 con il puntatore mentre il tasto è premuto | nessuna | — | M1 `N0:905-909` | alta |
| **Rilascio drag → inerzia** | target | `pos + velocità × 10` | lerp (sotto) | fino a settle | M1 `N0:916-919` | alta |
| Soglia inerzia | — | attiva solo se `|vx| > 0.5` **o** `|vy| > 0.5` | — | — | M1 `N0:916` | alta |
| Calcolo velocità | — | `(Δpos / Δt_ms) × 16` → px per frame @60fps | — | — | M1 `N0:909` | alta |
| **Lerp (smoothing)** | zoom, x, y | fattore **`0.15`** per frame | esponenziale | — | M1 `N0:789, 791` | alta |
| Lerp in reset view | | **`0.06`**, poi ripristinato a `0.15` a settle | esponenziale | — | M1 `N0:805` | alta |
| Soglia di settle | zoom / x / y | `|Δzoom| > 0.001`, `|Δx| > 0.5 px`, `|Δy| > 0.5 px` | — | — | M1 `N0:794` | alta |
| **Drag touch** | soglia di attivazione | `3` px (Chebyshev su x o y) | — | — | M1 `N0:941` | alta |
| **Pinch** | zoom | continuo, `zoom₀ × (dist/dist₀)`, clamp `[min, 5]` | nessuna | istantanea | M1 `N0:936-939` | alta |

**Il lerp esatto** (`N0:791-798`): a ogni frame, `valore += (target - valore) × 0.15`.
È smoothing esponenziale non compensato per il delta-time — quindi **frame-rate dependent**: su un monitor a 120 Hz converge in metà tempo. Da replicare così com'è per parità 1:1, non "corretto" con un `dt`.

Tempo di convergenza a 60fps con fattore 0.15: 63% in 6 frame (~100 ms), 95% in 19 frame (~316 ms), settle sotto 0.5px da 100px di distanza in ~33 frame (~550 ms).

### Clamp dei bordi (`N0:786`)

La griglia è circondata da un padding pari al 20% della sua larghezza e altezza per lato. Poi:
- se il contenuto (griglia + padding, scalato) è **più piccolo** del viewport su un asse → **centrato** su quell'asse, pan bloccato;
- altrimenti → clamp tra i due estremi, così che non si veda mai oltre il padding.

Nessun rubber-band, nessun overshoot elastico: è un clamp secco applicato **prima** del lerp, sul target.

### Effetto "squash" da velocità (`N0:834`, costanti `N0:702-705`)

Uno smorzamento visivo guidato dalla velocità di trascinamento, attivo durante e dopo il drag:

| Parametro | Valore | Fonte |
|---|---|---|
| decadimento per frame del picco di velocità | `× 0.85` | M1 `N0:704` |
| fattore di conversione velocità → intensità | `0.01` | M1 `N0:703` |
| ampiezza massima dell'effetto | `0.2` (cioè max −20%) | M1 `N0:702` |
| lerp verso il valore target | `0.08` per frame | M1 `N0:705` |
| soglia di arresto | `|1 − valore| <= 0.0005` | M1 `N0:834` |

Formula per frame: `picco *= 0.85` ; `target = 1 − min(picco × 0.01, 1) × 0.2` ; `valore += (target − valore) × 0.08`.
Il picco è il massimo della norma euclidea della velocità raggiunto durante il drag (`N0:910, 946`).

---

## B. Griglia

### B1. Layout

| Voce | Valore | Fonte | Conf. |
|---|---|---|---|
| Engine | **canvas 2D**, `drawImage` da sprite atlas | M1 `N0:784` + M2 | alta |
| Non è CSS grid né absolute positioning | — | M2 (un solo `<canvas>` nel DOM) | alta |
| Scala effettiva | `60 / cellSize × zoom` | M1 `N0:772, 786, 831` | alta |
| Posizione celle | precalcolata in `gridData` (dati dal CMS) | M1 `N0:719` | alta |
| Bleed anti-gap | `0.5` (in **spazio griglia**, quindi scalato dallo zoom) | M1 `N0:783-784` | alta |
| Dimensione disegnata | `cellSize − spacing`, `+1` per il bleed sui due lati | M1 `N0:776, 784` | alta |
| Atlas | **due**: uno a colori, uno in scala di grigi per gli stati filtrati | M1 `N0:782` | alta |
| `imageSmoothingQuality` | `"low"` (con smoothing abilitato) | M1 `N0:774` | alta |

### B3-bis. Ordine esatto delle trasformazioni di contesto (`N0:772-774`)

Va replicato nell'ordine, o pan e squash non si compongono correttamente:

1. `setTransform(dpr, 0, 0, dpr, 0, 0)` con `dpr = min(devicePixelRatio, 2)`
2. `clearRect` · `save()`
3. **solo se squash ≠ 1**: `translate(vw/2, vh/2)` → `scale(squash, squash)` → `translate(-vw/2, -vh/2)`
4. `translate(panX, panY)`
5. `scale(s, s)` con `s = 60 / cellSize × zoom`
6. `translate(padX, padY)` con `padX = floor(gridW × 0.2)`, `padY = floor(gridH × 0.2)`

Dopo il punto 6 il disegno avviene **in spazio griglia**: le coordinate delle celle, lo `spacing` e il bleed di `0.5` non vanno pre-moltiplicati per la scala. Lo squash è applicato **attorno al centro del viewport**, prima del pan.

Il bleed (sorgente e destinazione allargate di `0.5` per lato) evita le fessure da arrotondamento subpixel tra celle adiacenti. Va replicato o si vedono le righe.

Nota: sulle rotte `/works/*` il canvas riceve anche un `filter: grayscale(1)` CSS e tutte le celle passano all'atlas in scala di grigi (`N0:777, 779`). Fuori scope per la home.

### B2. LOD — livelli di dettaglio (`N0:666`)

| Zoom fino a | width immagine richiesta | tile atlas |
|---|---|---|
| `1` | 128 | 128 |
| `2` | 256 | 256 |
| `3.5` | 512 | 512 |
| `∞` | 1024 | 512 |

URL Sanity: `?w=<width>&auto=format&q=75`. Confermato a runtime: al primo paint tutte a `w=128`, a zoom 1.5 osservato `w=512`.

### B3. Reveal iniziale (desktop) — `N0:866-868`

Non è uno stagger su elementi DOM: è un **wipe radiale dal centro** disegnato nel canvas.

| Proprietà | Valore | Fonte | Conf. |
|---|---|---|---|
| Metrica per cella | distanza euclidea dal centro griglia, normalizzata 0→1 sul massimo | M1 `N0:863` | alta |
| Durata del wipe | **1500 ms** | M1 `N0:651` | alta |
| Easing del wipe | **lineare** (nessuna easing applicata al progresso) | M1 `N0:868` | alta |
| Direzione | dal centro verso l'esterno | M1 `N0:863` | alta |
| **Soglia di comparsa per cella** | la cella è **saltata** finché `progresso < distanza_normalizzata × 0.7` | M1 `N0:778` | alta |
| Tipo di comparsa | **pop-in secco**, nessun ramp di alpha per cella | M1 `N0:778` | alta |

Il fattore `0.7` significa che l'ultima cella compare al 70% del progresso: il wipe si completa a **1050 ms**, e i restanti 450 ms del ciclo da 1500 ms scorrono con la griglia già intera. Da non confondere con una easing.
| Fade del canvas | opacity `0 → 1` | M1 `N0:866` | alta |
| Durata fade canvas | **800 ms**, `ease` | M1 `N0:866` / M2 misurato **795 ms** | alta |
| Innesco | doppio `requestAnimationFrame` dopo aver messo `transition: none` | M1 `N0:866` | alta |
| Zoom di partenza | `0.4` (desktop), poi tween a `1.5` | M1 `N0:865` | alta |

Il doppio rAF è necessario: serve a far applicare `opacity:0` con `transition:none` prima di installare la transizione. Riprodurlo, o il fade non parte.

**Percorso mobile** (`N0:865`): salta il wipe radiale. Solo fade del canvas **600 ms `ease`**, poi prosegue dopo **1100 ms** di timeout.

### B4. Hover su cella — `N0:913-914, 955-967`

| Transizione | Da → a | Easing | Durata | Fonte | Conf. |
|---|---|---|---|---|---|
| **Entrata** (hover on) | alpha `1 → 0.6` | easeInOutQuad | **250 ms** | M1 `N0:678, 957-961` | alta |
| **Uscita** (hover off) | alpha `→ 1` | easeInOutQuad | **250 ms** | M1 `N0:678, 963-967` | alta |

**Entrata e uscita hanno la stessa durata e la stessa easing.** Il brief ipotizzava fossero diverse: qui non lo sono. Sono però due animazioni **separate e indipendenti** (due rAF distinti, `N0:957` e `N0:963`), con una gestione di interruzione: se passi da una cella all'altra, la vecchia parte in uscita **dal suo valore corrente** e la nuova parte in entrata dal suo (`N0:913-914`) — niente salti.

| Altro stato | Valore | Fonte |
|---|---|---|
| Cella esclusa dal filtro | alpha `0.05` (costante, non animata) | M1 `N0:780` |
| Cursore su cella cliccabile | `pointer` (nativo) | M1 `N0:914` |
| Cursore altrove | `grab` (nativo) | M1 `N0:910, 914` |

---

## C. Zoom

**Non è uno slider.** Due bottoni, più due azioni programmatiche (`N0:978`: `zoomIn`, `zoomOut`, `resetView`, `zoomToMin`).

| Azione | Target | Meccanica | Easing | Durata | Fonte | Conf. |
|---|---|---|---|---|---|---|
| **+** | `min(5, zoom × 1.5)` | lerp `0.15` | esponenziale | fino a settle (~550 ms tipici) | M1 `N0:800, 832` | alta |
| **−** | `max(min, zoom / 1.5)` | lerp `0.15` | esponenziale | idem | M1 `N0:802, 832` | alta |
| **reset view** | `1.5` + ricentrato | lerp **`0.06`** → poi torna a `0.15` | esponenziale | ~2.5× più lento | M1 `N0:804-805` | alta |
| **zoom to min** | `0.4` / `0.1` | **tween a tempo** | **easeInOutCubic** | **1200 ms** | M1 `N0:807-812` | alta |
| **pinch** | continuo | diretto, nessuno smoothing | nessuna | 0 ms | M1 `N0:936-939` | alta |

**Cosa modifica realmente:** un unico fattore di scala applicato al disegno su canvas (`60 / cellSize × zoom`). Non tocca il numero di colonne, non tocca i gap, non tocca il font-size. Il layout della griglia è invariante: cambia solo la matrice di trasformazione. *(Il numero di colonne esiste come variabile CSS `--columns` ma appartiene al layout Natural Grid, non al Pixel Grid — `N0:1035`.)*

**Continuo, non a step discreti.** I bottoni applicano step moltiplicativi, ma il valore sottostante è float e il pinch lo muove con continuità.

**Ancoraggio:** i bottoni zoomano sul **centro del viewport** (`N0:831`); il pinch zooma sul **midpoint delle due dita** (`N0:938`).

**Label:** percentuale intera, `round(zoom × 100)` (`N0:805, 812, 832`). Default 1.5 → "150".

---

## D. Filtri

| Elemento | Proprietà | Valore | Fonte | Conf. |
|---|---|---|---|---|
| `.filter` riposo | opacity | `1` | M1 `C0:433` | alta |
| `.filter` hover | opacity | `0.8`, `0.2s ease` | M1 `C0:435, 439-441` | alta |
| `.filter` attivo | opacity | `0.6` | M1 `C0:444` | alta |
| Gate hover | — | solo `(hover:hover) and (min-width:1024px)` | M1 `C0:438` | alta |
| Scrim navbar chiuso | height | `215%` | M1 `C0:476` | alta |
| Scrim navbar aperto | height | `260%`, `0.3s ease` | M1 `C0:482, 486` | alta |
| Pannello | layout | `flex column`, `gap: 12px` | M1 `C0:449-451` | alta |
| Variante dal basso | — | `column-reverse` | M1 `C0:459-462` | alta |

**Come escono/rientrano gli item filtrati (Pixel Grid):** né FLIP né opacity+transform su DOM. Le celle non-matching vengono semplicemente disegnate ad **alpha 0.05** nel frame successivo (`N0:780`). **Nessuna transizione, nessuna durata, nessuno stagger, nessun riordino.** Il cambio è istantaneo al frame.

Questo è il punto in cui il brief si aspettava una meccanica ricca e il sito non ce l'ha. Va replicato com'è.

### D1. Stagger di apertura del pannello — **RISOLTO: non esiste** (M2)

Run mirato del 2026-08-06 (`measure/03-phase1bis.js`): apertura del pannello, campionamento a 60fps di `getComputedStyle` + `getAnimations()` su tutte le voci per 2200 ms.

| Osservazione | Risultato |
|---|---|
| Animazioni rilevate da `getAnimations()` sulle voci | **0** (insieme vuoto per tutti i 54 campioni) |
| `animation` computed sulle voci | `none` |
| Valori di opacity al primo frame in cui le voci esistono | già finali: `1` per le inattive, `0.6` per l'attiva |
| Valori intermedi campionati | nessuno |

**Conclusione:** le voci compaiono istantaneamente al valore finale. Nessuno stagger, nessun fade d'ingresso, nessuna durata. L'unica cosa animata all'apertura è l'altezza dello scrim navbar (`215% → 260%`, `0.3s ease`).

Le voci reali rilevate: `All` (attiva), `Visual Identity`, `Typography`, `Art Direction`. Il bottone commuta il testo `Filters +` ⇄ `Filters −`.

Il `transition: opacity 0.2s` presente sulle voci serve **solo** agli stati hover/active, non all'ingresso.

---

## E. View toggle

Due stati: **Pixel Grid** (default, active) e **Natural Grid** (`aria-label` rilevati a runtime).

| Elemento | Proprietà | Valore | Fonte | Conf. |
|---|---|---|---|---|
| `.view__btn` | dimensione | `17.5 × 17.5` px | M1 `C0:351, 359` | alta |
| | outline | `0.5px solid var(--black)` | M1 `C0:354` | alta |
| | offset | `translateY(0.5px)` | M1 `C0:356` | alta |
| | transition | **`transform .2s`** (vedi nota) | M1 `C0:357-358` | alta |
| hover | opacity | `0.8` | M1 `C0:363-365` | alta |
| attivo | opacity + transform | `0.6` + `translateY(0.5px) scale(0.85)` | M1 `C0:368-372` | alta |
| `.view-layer` | opacity | `0 → 1`, **`0.4s ease`** | M1 `C0:814-816` | alta |
| `.ui-layer` | opacity | **`0.6s ease`** | M1 `C0:808-810` | alta |
| `.main-wrapper` | opacity | **`0.6s ease`** | M1 `C0:824-826` | alta |

> **Nota — quirk da replicare.** In `C0:357-358` la regola dichiara `transition: opacity .2s ease` e **subito dopo** `transition: transform .2s`. La seconda sovrascrive la prima: l'opacity di quei bottoni **non è animata**, cambia di scatto; solo il transform transiziona, in 200 ms con easing `ease` (default). È quasi certamente un bug loro, ma per la parità 1:1 va riprodotto identico.

**Morph tra i due layout: non esiste.** Non c'è FLIP. Sono due layer sovrapposti che fanno crossfade in `0.4s ease`, con i layer di contorno a `0.6s ease`.

### E1. Verifica del crossfade per fitting (M2 + M3)

Unico parametro per cui ho eseguito il fitting numerico richiesto dal brief. Dati: `raw/phase1bis.json`, script `measure/04-fit-bezier.js`. 12 campioni sul tratto di transizione.

| Easing candidata | Durata best-fit | RMS |
|---|---|---|
| **`ease` (.25,.1,.25,1)** | **396 ms** | **0.01446** |
| easeOutCubic (.33,1,.68,1) | 372 ms | 0.02464 |
| easeOutQuad (.5,1,.89,1) | 328 ms | 0.02816 |
| easeInOutCubic (.65,0,.35,1) | 516 ms | 0.03087 |
| ease-out (0,0,.58,1) | 300 ms | 0.03217 |
| ease-in-out (.42,0,.58,1) | 364 ms | 0.03959 |
| linear | 340 ms | 0.08393 |

Vince `ease` con distacco netto (RMS inferiore del 41% rispetto alla seconda). Coincide con il letterale CSS `.4s ease` (`C0:814-816`). **Scarto sulla durata: 396 vs 400 ms = 1.0%**, entro la soglia del 2% del brief. Residuo massimo su singolo punto 0.033 (jitter di campionamento headless), residuo mediano 0.006.

I due layer sono complementari: la somma delle opacity campionate è `1.0000` a ogni frame → è un crossfade puro, non due fade indipendenti.

### E2. Natural Grid — layout e fisica

**È una CSS grid reale, con scroll nativo.** Nessun canvas, nessun posizionamento assoluto calcolato in JS.

| Proprietà | Valore desktop | Valore ≤768px | Fonte |
|---|---|---|---|
| `display` | `grid` | idem | M1 `C0:195-201` |
| `grid-template-columns` | `repeat(var(--columns), 1fr)` | idem | M1 `C0:198` |
| `--columns` | **10** | **4** | M1 `C0:149, 156` |
| `--gap` | **24 px** | **16 px** | M1 `C0:148, 155` |
| `--margin` | **24 px** | **20 px** | M1 `C0:147, 154` |
| `position` | `fixed`, `width: 100vw`, `height: 100%`, `z-index: -1` | idem | M1 `C0:570-578` |
| `padding` | `60px var(--margin) var(--margin)` | `60px var(--margin) 60px` | M1 `C0:575, 583` |
| `align-items` | `start` | idem | M1 `C0:571` |
| `overflow-y` | `auto` (scroll **nativo sul contenitore**, non sul documento) | idem | M1 `C0:574` |
| Scrollbar | nascosta (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) | idem | M1 `C0:186-193` |

Confermato a runtime: il documento non scrolla (`scrollHeight === clientHeight === 900`); scrolla il contenitore. 235 `<img>` presenti nel DOM in questa vista.

**Parallasse per-item** (`C0:587-590` + `N0:599-605`) — la meccanica più interessante del layout:

| Elemento | Valore | Fonte |
|---|---|---|
| Transform | `translateY(calc(var(--scroll-progress, 0) × var(--extra-space, 0px)))` | M1 `C0:588` |
| `will-change` | `transform` | M1 `C0:589` |
| `--scroll-progress` | `scrollTop / (scrollHeight − clientHeight)`, range 0→1, impostata sul **contenitore** | M1 `N0:603-605` |
| `--extra-space` (per item) | `(altezza massima della sua riga) − (propria altezza)`, in px | M1 `N0:599-601` |
| Raggruppamento in righe | per `offsetTop` identico | M1 `N0:599-600` |
| Smoothing / easing | **nessuno** — aggiornamento diretto a ogni evento di scroll | M1 `N0:605` |
| Listener scroll | `{ passive: true }` | M1 `N0:607` |

In pratica: ogni item scende, mentre scrolli, di una quantità pari allo spazio verticale che gli avanza rispetto all'item più alto della sua riga. Gli item più alti di ogni riga hanno `--extra-space: 0` e restano fermi. A `scroll-progress = 1` ogni riga risulta allineata in basso invece che in alto. Effetto a costo zero, tutto in CSS, con il JS che scrive solo due custom properties.

**Ricalcolo di `--extra-space`** (`N0:607-611`): dopo il caricamento di **tutte** le `img`/`video` (contatore su `load`/`loadeddata`, `{ once: true }`), più `ResizeObserver` sul contenitore, più un `setTimeout` di fallback a **2000 ms**.

| Stato | Valore | Fonte |
|---|---|---|
| Hover su item | `opacity: 0.5`, gate `(hover:hover) and (min-width:1024px)` | M1 `C0:592-596` |
| Item filtrato fuori | `filter: grayscale(1) contrast(4)` + `opacity: 0.05` + `pointer-events: none` | M1 `C0:598-601` |
| Fade-in immagine | `opacity 0 → 1`, **`0.3s ease`**, alla classe `.loaded` | M1 `CN:12-19` |
| Crossfade poster video | **`0.35s cubic-bezier(.65,0,.35,1)`** | M1 `CN:35` |
| `scroll-behavior` | `smooth` sul documento | M2 |
| Scroll programmatico a un'opera | `scrollTo({ behavior: 'smooth' })`, tolleranza **5 px**, fallback **800 ms** | M1 `N0:633-634` |

Nota: l'opacity `0.05` dell'item filtrato coincide con l'alpha `0.05` delle celle filtrate nel Pixel Grid (`N0:780`). Stesso valore, due implementazioni.

---

## F. Transizioni di pagina

| Meccanica | Valore | Fonte | Conf. |
|---|---|---|---|
| Tecnologia | **View Transitions API nativa** | M1 `C0:309-323, 468` | alta |
| Elemento persistente | navbar, via `view-transition-name: navbar` | M1 `C0:468` | alta |
| Nav opera successiva | slide-out-left + slide-in-from-right | M1 `C0:309-315` | alta |
| Nav opera precedente | slide-out-right + slide-in-from-left | M1 `C0:317-323` | alta |
| Durata | **350 ms**, `ease-out`, `both` | M1 `C0:310, 314, 318, 322` | alta |
| Direzione pilotata da | attributo `[data-work-nav-direction=next|prev]` | M1 `C0:309, 317` | alta |

**Home ↔ /info:** /info **non sostituisce** la home. È un overlay `position: fixed`, `z-index: 9`, `height: 100dvh`, sopra il canvas (`css/3.BGONRHO9.css:1-11`). Il canvas resta montato e vivo sotto. Il passaggio è il crossfade dei layer di §E (`0.4s` / `0.6s ease`), non una transizione di rotta.

Contenuto /info: colonna centrata, `gap: 16px`, `width: 800px`, `transform: translateY(-10%)`; su `max-width:768px` diventa centratura assoluta (`translate(-50%,-50%)`).

⚠️ Non ho trovato una chiamata letterale a `startViewTransition` nei bundle scaricati → `UNKNOWNS.md` #3.

---

## G. Cursore, loader, tipografia

### G1. Cursore — **non è custom**

Cursori CSS nativi: `grab` sul canvas, `pointer` sopra una cella cliccabile (`N0:910, 914`). Nessun elemento cursore nel DOM (verificato a runtime: `document.querySelector('[class*=cursor]')` → `null`). **Niente lag, niente lerp, niente dimensioni da misurare.**

### G2. Loader

**Non è una progress bar né una percentuale.** È una macchina a stati: `loading` → `fadeIn` (desktop) oppure `playFrames` (mobile) → `done` (`N0:654, 865-868`). Il passaggio è gated sul caricamento reale delle immagini, non su un timer.

| Fase | Valore | Fonte | Conf. |
|---|---|---|---|
| Fade canvas desktop | `0.8s ease` | M1 `N0:866` / M2 **795 ms** | alta |
| Fade canvas mobile | `0.6s ease` | M1 `N0:865` | alta |
| Ritardo post-fade mobile | `1100 ms` | M1 `N0:865` | alta |
| Wipe radiale desktop | `1500 ms` lineare | M1 `N0:651, 868` | alta |
| Inizio fade osservato | ~1790 ms da DOMContentLoaded | M2 | media (dipende dalla rete) |

Non c'è durata minima artificiale imposta.

### G3. Tooltip di intro — `C0:651-670`

**Innesco: l'ingresso in IDLE, non il caricamento.** (M2, Fase 3) Campionando l'opacity dal primo frame, sull'originale il tooltip compare a **t ≈ 9563 ms** — coerente con fine loading (~2.5 s) + i **7000 ms** di timeout di inattività (§G4), non con il load. Fuori dallo stato idle l'elemento è **staccato dal DOM**, non semplicemente nascosto (verificato: `querySelector` restituisce `null`).

Testo: "Drag and move around to navigate". Animazione `4s ease forwards`, keyframe:

| % | tempo | opacity |
|---|---|---|
| 0% | 0 ms | 0 |
| 15% | 600 ms | 0.9 |
| 70% | 2800 ms | 0.9 |
| 100% | 4000 ms | 0 |

Quindi: fade-in 600 ms → hold 2200 ms → fade-out 1200 ms. Posizionato al centro (`left/top: 50%`, `translate(-50%,-50%)`), `padding: 8px 16px`, `background: #fff`, `line-height: 100%`, `pointer-events: none`.

### G4. Modalità idle (auto-demo) — `N0:838-861`

| Parametro | Valore | Fonte | Conf. |
|---|---|---|---|
| Timeout di inattività | **7000 ms** | M1 `N0:671, 838` | alta |
| Eventi che resettano | `mousemove`, `mousedown`, `keydown`, `touchstart` | M1 `N0:970` | alta |
| Entrata idle: tween a zoom | `0.4` desktop / `0.1` mobile, ricentrato | M1 `N0:842, 846` | alta |
| Durata entrata | **1200 ms**, **easeInOutCubic** | M1 `N0:849-850` | alta |
| Ciclo delle varianti | ogni **100 ms** (`setInterval`) | M1 `N0:851` | alta |
| Uscita idle: durata | **1200 ms**, **easeInOutCubic** | M1 `N0:859-860` | alta |
| Uscita: destinazione | se zoom pre-idle `< 1.5` → torna a `1.5` centrato; altrimenti torna a posizione e zoom pre-idle | M1 `N0:856-857` | alta |
| Cicli di intro | default **3** | M1 `N0:643` | alta |

### G5. Tipografia e tema

| Proprietà | Valore | Fonte | Conf. |
|---|---|---|---|
| Font | `"NEXT Mono", monospace` (headings **e** body) | M1 `C0:212-213` | alta |
| Weight | `100` | M1 `C0:207` | alta |
| `font-display` | `swap` | M1 `C0:204` | alta |
| Formati | woff2 + woff | M1 `C0:208` | alta |
| **font-size body** | **`9px` fisso** | M1 `C0:262` | alta |
| letter-spacing | `-0.02em` | M1 `C0:265` | alta |
| line-height | `180%` | M1 `C0:266` | alta |
| `font-feature-settings` | **non impostato** (solo `inherit` nel reset) | M1 `C0:53` | alta |
| Unità responsive | **nessuna** — niente `clamp()`, niente `vw` | M1 (grep su `C0`) | alta |
| `--margin` | `24px`, `20px` sotto breakpoint | M1 `C0:147, 154` | alta |
| Padding navbar | `13px var(--margin) 10px var(--margin)` | M1 `C0:466` | alta |
| `--color-primary` | `#003882` (P3: `color(display-p3 0 .19624 .54823)`) | M1 `C0:212, 226` | alta |
| `--color-accent` | `#ffd84c` (P3: `color(display-p3 1 .84795 .24474)`) | M1 `C0:214, 227` | alta |
| `--color-neutral` | `#3d3a42` | M1 `C0:215` | alta |
| Sfondo pagina | `#f9f9f9` | M1 `C0:474` | alta |
| `user-select` | `none` globale | M1 `C0:243-245` | alta |
| tap highlight | `rgba(0,0,0,.05)` | M1 `C0:243` | alta |

**Il font-size è 9px fisso a ogni viewport.** Nessuna scala fluida. Il gradiente dello scrim navbar è una rampa a 16 stop di `#f9f9f9` con alpha decrescente (`C0:474`) — riproducibile 1:1 ma banale.

---

## Riepilogo confidenza

| Sezione | Parametri estratti | Confidenza alta | Da chiarire |
|---|---|---|---|
| A. Pan / fisica | 15 | 15 | 0 |
| B. Griglia (Pixel) | 14 | 14 | 0 |
| C. Zoom | 8 | 8 | 0 |
| D. Filtri (+ D1) | 13 | 13 | 0 — stagger risolto |
| E. View toggle (+ E1, E2) | 39 | 39 | 0 — Natural Grid risolto |
| F. Transizioni | 6 | 6 | 1 (trigger home↔info) |
| G. Cursore/loader/type | 30 | 29 | 1 (t inizio fade, dipende da rete) |

**125 parametri estratti, 124 ad alta confidenza.** Nessun valore inventato, nessun default di libreria (non ci sono librerie).

Ripartizione per metodo: **117 da letterale nel bundle (M1)**, 7 da campionamento runtime (M2), 1 da fitting (M3, §E1 — che conferma il letterale M1).

Aperto in `UNKNOWNS.md`: 1 voce non bloccante (trigger `startViewTransition`, rilevante solo se `/works/*` entra nello scope) + 3 costanti non identificate da cui **nessun numero di questo spec dipende**.
