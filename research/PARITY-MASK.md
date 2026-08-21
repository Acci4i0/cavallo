# PARITY-MASK — griglia a maschera e ciclo di galoppo

Data: 2026-08-07. Chromium headless. Viewport di registrazione 1600×1200 @dpr2 (serve alto: a zoom minimo la griglia è 1008 px, non entrerebbe in 900 e la maschera risulterebbe tagliata).

Avevi ragione: la griglia non è una matrice piena. È una **lista sparsa di celle accese**, diversa per ogni frame, e i frame ciclano.

---

## 1. Esito

| | |
|---|---|
| Metriche a soglia | **11 PASS · 0 FAIL** |
| Ricostruzione per osservazione vs sorgente | **100.000% di coincidenza cella-per-cella** (75 764 / 75 764) |

---

## 2. FASE 1 — Ricostruzione per osservazione

### Criterio di "cella accesa" (misurabile e documentato)

Le celle **non sono elementi del DOM**: sono disegnate su canvas 2D. Nessun criterio basato su `opacity`, `visibility` o presenza in DOM è applicabile.

Criterio adottato: il canvas viene ridisegnato in un offscreen di esattamente `cols × rows` pixel, così ogni pixel di destinazione integra l'area di una cella. **Una cella è accesa se l'alpha medio di quel pixel supera 88/255.** La soglia è a metà tra i due stati teorici: cella vuota = alpha 0; cella piena = `(cellSize − spacing)² / cellSize² = (10/12)² = 69%` → 177/255.

Si legge il **canale alpha**, non la luminanza: nei gap il canvas è trasparente e `getImageData` restituisce RGB (0,0,0), indistinguibile da un contenuto nero.

Per leggere i pixel del canvas dell'originale — *tainted* dalle immagini Sanity servite senza header CORS — ho iniettato `access-control-allow-origin: *` via intercettazione di rete e forzato `crossOrigin` sulle `Image` prima dell'assegnazione del `src`.

### Risultati (registrazione di 20 s in stato idle)

| Grandezza | Valore osservato |
|---|---|
| Passo del reticolo a zoom idle | **48 px** backing (= 60 × 0.4 × dpr2) |
| Estensione accesa (unione dei frame) | **47 × 31** celle |
| Campioni distinti in 20 s | 180 |
| Matrici **uniche** | **19** |
| Passi del ciclo | **52** |
| Durata frame | **99.19 ms** (mediana 100.2) → **10.08 fps** |
| Tipo di loop | **perfetto** (periodo esatto 52, match 100.0%) |
| Transizione tra frame | **hard-cut**, nessuna interpolazione |

Output: `research/mask-frames.json` · anteprima ASCII in `research/mask-frames.txt`.

L'anteprima mostra senza ambiguità la sagoma di un cavallo al galoppo.

---

## 3. FASE 2 — Conferma dalla sorgente

La maschera **non** è codificata nei bundle. È un JSON scaricato a runtime:

```
https://cdn.sanity.io/files/j9vmr6ts/production/9c349bba7ab12614824561347cc2bc93016fdb12.json   (3.7 MB)
```

Struttura: `{ version, aspectRatio, thumbnailCount, settings, frames[] }`, dove ogni frame è `{ frameIndex, timestamp, gridData: { cols, rows, cellSize, spacing, width, height, cells[] } }` e ogni cella è `{ x, y, gridCol, gridRow }`.

| | Sorgente | Osservazione | |
|---|---|---|---|
| Estensione accesa (colonne) | 47 | 47 | ✓ |
| Estensione accesa (righe) | 31 | 31 | ✓ |
| Matrici uniche | 19 | 19 | ✓ |
| Passi del ciclo | 52 | 52 | ✓ |
| fps di riproduzione | 9.87 | 10.08 | ✓ |
| **Coincidenza cella-per-cella** | — | **100.000%** (75 764/75 764, shift di fase 6) | ✓ |

**Nessuna divergenza.** I due metodi concordano perfettamente.

### Due dettagli che emergono solo dal confronto

**58 frame, ma 52 passi.** La sorgente dichiara 58 frame; 6 coppie consecutive sono matrici identiche (indici con conteggi 493·493, 539·539, 492·492, 515·515, 499·499, 548·548). La deduplica dell'osservazione le collassa: 58 − 6 = 52. Le due cifre non sono in conflitto, misurano cose diverse.

**I timestamp della sorgente vengono ignorati.** La sorgente porta `Δt = 0.101293 s` → 9.8724 fps (è la cadenza del video da cui è stata generata, 5.77 s totali). Il sito però riproduce con `setInterval` a valori tondi: **50 ms nell'intro, 100 ms in idle**. Il campo `timestamp` non è letto.

### Metadati della sorgente

`version 1.1` · esportata 2026-02-08 · `aspectRatio 1.29317` (= 644/498) · `thumbnailCount 37` · `settings { detail: 50, spacing: 2 }`.

`width 644` e `height 498` sono le dimensioni dell'immagine sorgente, costanti su tutti i 58 frame — la griglia non salta tra un frame e l'altro. Da lì: `cols = ceil(644/12) = 54`, `rows = ceil(498/12) = 42`.

---

## 4. FASE 3 — Comportamento

| Domanda | Risposta | Come l'ho stabilita |
|---|---|---|
| **Quando parte il ciclo** | Due regimi distinti: **intro al load a 50 ms/frame**, e **idle a 100 ms/frame** dopo 7000 ms di inattività | M1 `N0:872` / `N0:851` + osservazione: istogramma con cluster netti a 50 ms (37 campioni) e 100 ms (84) |
| **Si ferma?** | **Sì.** Fuori da intro e idle la maschera è **congelata**: 0 cambi in 6 s di attività continua | Osservazione |
| **Su quale frame di riposo** | **Indice 49** su 58 — coincidenza **100.000%** (1364/1364 celle) col frame 49 della sorgente | Osservazione + conferma: gli indici 5, 19, 34, 49 condividono la stessa matrice |
| **Celle spente** | **Non esistono.** Non sono nel DOM (niente lo è), non sono nella lista celle del frame, non vengono disegnate, non occupano spazio | M1 `N0:777-784` + osservazione |
| **Assegnazione immagini** | **Si rimescolano a ogni frame.** `thumbIndex = ordinale_della_cella_nel_frame % thumbnailCount` — è una proprietà dell'ordine, non della posizione | M1 `N0:763`. Verifica sui dati: su **384** posizioni accese sia nel frame 0 che nel 3, **0** mantengono la stessa immagine |
| **Interazione con lo ZOOM** | **Scalata, non ricampionata.** Una sola matrice serve tutti i livelli | Osservazione: passo 180 → 120 → 80 px (rapporti 1.5 e 1.5) con **pattern identico** nella finestra centrale a tutti e tre gli zoom |
| **Interazione con i FILTRI** | La maschera **sopravvive invariata**. Le celle non-matching restano disegnate ad alpha 0.05 con l'atlas in scala di grigi. Nota: siccome `thumbIndex` cambia a ogni frame, cambia anche *quali* celle risultano filtrate | M1 `N0:780` |
| **Interazione con VIEW** | Il Natural Grid è un layer DOM separato: la maschera **non si applica**, il canvas è sotto in crossfade | M1 + PARITY.md §E2 |
| **Mobile 390×844** | **Stessa maschera, stessa risoluzione, entrambi i regimi.** Misurato pulito perché il canvas è piccolo: **50.0 ms** nell'intro e **100.1 ms** in idle | Osservazione |

### Struttura completa dell'intro

Ricostruita e misurata:

| Fase | Durata | Fonte |
|---|---|---|
| wipe radiale a zoom 0.4 | 1500 ms lineare | M1 `N0:651` |
| **galoppo** | **50 ms × passi** | M1 `N0:872` (`N = 50`) |
| pausa | **400 ms** | M1 `N0:872` (`I = 400`) |
| zoom-in finale 0.4 → 1.5 | **1800 ms** easeInOutCubic | M1 `N0:878` (`ce = 1800`) |
| tooltip | 4000 ms | M1 `N0:882` |

Passi del galoppo = `(introCycles − 1) × 58 + ceil(58 × 0.85)`.

**`introCycles = 1`, non il default 3 del bundle.** Misurato: il galoppo dura **2300 ms ≈ 46 passi**, contro i 2500 ms/50 passi previsti da `introCycles=1` e gli 8300 ms/166 passi di `introCycles=3`. Conferma incrociata indipendente: con 50 passi il frame di riposo è `(50−1) % 58 = 49`, esattamente quello osservato con coincidenza 100%.

### Tre costanti che erano in UNKNOWNS

Questa fase le ha risolte tutte e tre: `N = 50` (passo del galoppo), `I = 400` (pausa), `ce = 1800` (zoom-in finale). Erano non tracciabili perché il bundle riusa gli identificatori tra scope; il contesto della maschera le ha rese leggibili.

---

## 5. FASE 4 — Implementazione con i miei dati

Le matrici dell'originale **restano in `/research/`** come specifica di riferimento e non entrano nel codice.

```
tools/make-gallop-placeholders.js  → assets/gallop/*.png   (58 silhouette SEGNAPOSTO)
scripts/build-mask.js              → src/data/mask-frames.json
src/js/data.js buildFrames()       → liste sparse di celle, thumbIndex per ordinale
```

Pipeline di `build-mask.js`: **grayscale → threshold configurabile → downsample a cols×rows (media d'area = copertura) → soglia di copertura → booleano → JSON**. Due soglie separate e configurabili (`--threshold`, `--coverage`), più `--invert` per soggetto chiaro su fondo scuro. Rigenerabile per qualsiasi `--cols`/`--rows`. La decodifica passa da Chromium, quindi accetta PNG/JPEG/WebP/SVG senza dipendenze aggiuntive.

**Nessuna matrice è hardcoded**: il renderer legge solo il JSON.

> ⚠️ **`/assets/gallop/` era vuota.** Ho generato 58 silhouette segnaposto di un quadrupede stilizzato in ciclo di galoppo, così la pipeline è eseguibile end-to-end. Sostituiscile con le tue e rilancia `node scripts/build-mask.js`: nient'altro cambia.

---

## 6. FASE 5 — Diff clone vs originale

Stesso script di registrazione applicato a entrambi.

| Metrica | Originale | Clone | Esito |
|---|---|---|---|
| Griglia dichiarata | 54 × 42 | 54 × 42 | **PASS** |
| cellSize | 12 | 12 | **PASS** |
| spacing | 2 | 2 | **PASS** |
| Frame nella sorgente | 58 | 58 | **PASS** |
| fps in idle | 10.082 | 10.015 | **PASS** — Δ 0.67% |
| Durata frame | 99.19 ms | 99.85 ms | **PASS** — Δ 0.66% |
| Tipo di loop | perfetto | perfetto | **PASS** |
| Transizione | hard-cut | hard-cut | **PASS** |
| Passo reticolo a zoom idle | 48 px | 48 px | **PASS** |
| Celle spente | assenti dalla lista, mai disegnate | assenti dalla lista, mai disegnate | **PASS** |
| Immagini: stesso thumb tra frame 0 e 3 | 0/384 | 0/456 | **PASS** |
| Passi del ciclo osservati | 52 | 58 | *atteso* |
| Celle accese per frame | 477–555 (media 518) | 514–539 (media 526) | *informativo* |
| Estensione accesa | 47 × 31 | 48 × 34 | *escluso per progetto* |

**11 PASS · 0 FAIL.**

Le tre voci fuori soglia sono per costruzione:

- **Passi del ciclo 52 vs 58**: il conteggio frame coincide (58 = 58). L'originale ne mostra 52 solo perché la sua sequenza sorgente contiene 6 coppie consecutive identiche. È una proprietà della *loro* silhouette, non della meccanica. Se le tue silhouette avranno duplicati consecutivi, il numero scenderà allo stesso modo.
- **Estensione accesa e densità**: dipendono dalla forma, che per progetto è diversa. Come da tua indicazione, escluse dal confronto.

---

## 7. Limiti dichiarati

- **`introCycles = 1` è misurato indirettamente** (durata del galoppo + indice del frame di riposo), non letto come letterale: nel bundle è un prop del componente, e il valore passato in produzione non compare come costante. Le due misure indipendenti concordano, ma è una deduzione, non una lettura.
- **La cadenza dell'intro sul clone non è stata ri-misurata in modo pulito**: durante wipe e zoom il canvas cambia a ogni rAF, quindi l'istogramma delle durate confonde i cambi di maschera con i cambi di trasformazione. Sul clone il valore è imposto dalla costante (`MASK_INTRO_FRAME_MS = 50`); sull'originale è misurato (cluster netto a 50 ms). L'idle a 100 ms è invece misurato pulito su entrambi.
- **La registrazione avviene in stato idle**, dove lo zoom è al minimo e l'intera griglia è visibile. Le altre fasi sono state osservate ma non registrate matrice-per-matrice.
- **Un solo ambiente**: Chromium headless su macOS, 59.9 fps.

---

## 8. Riproduzione

```bash
python3 -m http.server 4173

# Fase 1 — ricostruzione per osservazione
node research/measure/20-mask-record.js --secs=20 --out=original
node research/measure/21-mask-analyze.js original

# Fase 2 — confronto con la sorgente
node research/measure/22-mask-compare-source.js

# Fase 3 — comportamento
node research/measure/23-mask-behavior.js
node research/measure/24-mask-behavior2.js
node research/measure/25-resting-frame.js
node research/measure/27-intro-length.js

# Fase 4 — build dai miei dati
node tools/make-gallop-placeholders.js
node scripts/build-mask.js

# Fase 5 — diff
node research/measure/20-mask-record.js --url=http://localhost:4173/ --secs=20 --out=clone
node research/measure/21-mask-analyze.js clone
node research/measure/26-mask-parity.js
```
