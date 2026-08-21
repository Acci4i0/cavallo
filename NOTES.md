# Scostamenti dichiarati

Tutto ciò che nel clone **non** corrisponde all'originale, e perché. Nessuno di questi punti tocca un parametro di animazione: durate, easing, soglie e fattori restano quelli di `/research/ANIMATION_SPEC.md`.

## 1. Contenuti — segnaposto, per tuo vincolo

| Cosa | Nel clone |
|---|---|
| Immagini | 96 PNG neri generati da `tools/make-placeholders.js` (24 soggetti × 4 tier LOD), 33 KB totali |
| Testi, titoli, categorie | segnaposto dichiarati in `src/js/data.js` |
| Logo / nome | "Studio Placeholder" |

Nessun asset, testo, marchio o riga di codice dell'originale è nel repo. Il motore è riscritto dallo spec misurato, non copiato dai loro bundle. I bundle scaricati stanno solo in `/research/bundles/` come materiale di analisi e non vengono serviti.

## 2. Font — sostituzione necessaria

L'originale usa **NEXT Mono Thin**, un font commerciale su licenza. Non è incluso e non va prelevato da lì. Il clone usa uno stack monospace di sistema come segnaposto.

**Le metriche misurate sono però applicate**: `font-size: 9px` fisso, `letter-spacing: -.02em`, `line-height: 180%`, `text-transform: uppercase`. Sostituendo la sola `--font-body` con il tuo font, il resto del layout non cambia.

## 3. Atlas — differenza di implementazione, non di comportamento

L'originale impacchetta i thumbnail in **due sprite atlas** (uno a colori, uno in scala di grigi) e disegna con `drawImage` da coordinate di tile (§B1 · N0:782-784).

Il clone disegna direttamente dagli oggetti `Image`, con una **copia in scala di grigi per soggetto unico** (24 canvas offscreen invece di un atlas). Motivo: con 144 thumb al tier 512 un atlas singolo sarebbe 6144×6144 px (~150 MB di memoria video) senza alcun guadagno su canvas 2D, dove l'atlas serve a risparmiare bind di texture — un problema WebGL, non 2D.

Restano identici: geometria in spazio griglia, bleed `0.5`, `imageSmoothingQuality: "low"`, alpha per stato, e lo swap di sorgente per tier LOD (che è il comportamento di rete osservabile).

## 4. Maschera a galoppo — segnaposto miei, meccanica misurata

La griglia **non è una matrice piena**: è una lista sparsa di celle accese che disegna una sagoma, e i frame ciclano (research/PARITY-MASK.md). Griglia 54×42, `cellSize 12`, `spacing 2`, 58 frame, 100 ms in idle e 50 ms nell'intro — tutti valori misurati.

Le matrici dell'originale restano in `/research/` come riferimento e **non entrano nel codice**. Le mie si generano così:

```bash
node tools/make-gallop-placeholders.js   # 58 silhouette SEGNAPOSTO in assets/gallop/
node scripts/build-mask.js               # → src/data/mask-frames.json
```

`/assets/gallop/` era vuota: le 58 silhouette sono un quadrupede stilizzato generato proceduralmente, dichiarato come segnaposto. Sostituiscile con le tue e rilancia `build-mask.js`.

## 4-bis. Sagoma: ora è quella ESTRATTA dall'originale

Su tua scelta esplicita (EXTRACTION.md §7, opzione b) il progetto servito usa la sagoma cavallo+fantino estratta da jinleeoffice.com, non una silhouette propria. Rigenerata da `node scripts/use-reference-mask.js`.

Per tornare a una sagoma tua: `node scripts/build-mask.js`. Nient'altro cambia — il renderer non distingue le due sorgenti.

Verifica in `_reference/VERIFICATION.md`: 9/9, matrice resa bit-identica alla sorgente su 2268 celle.

## 5. Silhouette segnaposto — forma mia, meccanica identica

La sagoma è diversa dall'originale per progetto, e questo produce due scarti attesi: l'estensione accesa (48×34 contro 47×31) e il numero di passi del ciclo (58 contro 52 — l'originale ha 6 coppie di frame consecutivi identici, proprietà della loro sequenza). Risoluzione griglia, conteggio frame, fps, tipo di loop e comportamento delle celle spente coincidono: 11 PASS su 11 in PARITY-MASK §6.

## 6. `/works/*` fuori scope

Il brief copre la home. Non sono implementate le pagine opera né le loro `::view-transition-*(work-page)` a `0.35s ease-out` (§F), che restano documentate nello spec. Il click su una cella logga in console.

## 7. Comportamento dipendente dal frame rate — voluto

Il lerp a fattore `0.15` per frame **non compensa il delta-time**, esattamente come l'originale (§A · N0:791). Su un monitor a 120 Hz il clone converge in circa metà tempo — e così fa il sito di riferimento. È una scelta di parità, non un difetto. Dettagli e formula di correzione in `research/UNKNOWNS.md`.

---

# Come si avvia

```bash
python3 -m http.server 4173
# poi apri http://localhost:4173/
```

Serve un server: il progetto usa ES modules, che da `file://` sono bloccati dal CORS.

# Struttura

```
index.html
src/css/style.css        ogni regola annotata con il riferimento allo spec
src/js/
  spec.js                TUTTE le costanti numeriche. Se un numero non è qui, non va usato
  data.js                dataset segnaposto + generazione gridData
  grid.js                stato, LOD, lerp, renderer canvas 2D
  scroll.js              §A — wheel / drag / touch / pinch / inerzia / squash
  zoom.js                §C — le tre meccaniche di zoom
  filters.js             §D
  view.js                §E — toggle + natural grid con parallasse
  transitions.js         §F — overlay info
  loader.js              §G2/§G4 — sequenza di loading + idle
  main.js                orchestrazione + hover (§B4)
tools/make-placeholders.js
research/                spec, misure, script Playwright, bundle di analisi
```
