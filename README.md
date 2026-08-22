# cavallo — griglia mascherata a schermo intero

Un cavallo al galoppo composto da fotografie: ogni fotogramma dell'animazione è
una maschera di occupazione su una griglia **54 × 42**, e le celle accese
ospitano l'immagine. Nessuna interfaccia — solo la sagoma, a tutto schermo su
desktop e iPhone. Il galoppo non si ferma mai.

Le celle mostrano 158 fotografie scattate in Puglia, in **WebP**, su tre livelli
di dettaglio scelti in base al lato della cella in pixel reali:

| Livello | Contenuto | Quando | Peso |
|---|---|---|---|
| `thumb` | quadrato 320 px | fino a 200 px di cella | 2.4 MB |
| `hd` | quadrato 1024 px | fino a 600 px | 18.5 MB |
| `xl` | quadrato 1536 px, **nativo** | oltre 600 px | 42.6 MB |
| `full` | fotogramma intero | visore, una alla volta | 129.5 MB |

Ogni livello si scarica solo se si supera la sua soglia: all'apertura la pagina
carica i soli 2.4 MB di `thumb`.

I livelli della griglia sono **quadrati** perché le celle lo sono e usano
`background-size: cover`: di un'immagine 4:3 il lato lungo verrebbe scartato
comunque, quindi ritagliando a monte ogni pixel scaricato finisce a schermo.
Nessun livello ingrandisce mai la sorgente.

### Nitidezza

A zoom massimo una cella misura 605 px reali e viene servita a 1536:
**2.54× di sovracampionamento**, contro l'1.71× del sito di riferimento.

La ricodifica è fatta da **Chrome**, non da `sips`. Misurando quanto dettaglio
sopravvive rispetto a un ideale non compresso:

| Pipeline | Ritenzione |
|---|---|
| sito di riferimento, AVIF q75 | 72.6% |
| `sips` q82 (usato prima) | 77.2% |
| **Chrome + WebP (attuale)** | **94.8% `hd`, 97.5% `xl`** |

`sips` usa un filtro di ricampionamento scadente: su immagini ricche di dettaglio
scendeva al 62%. Il livello `xl` è a pixel nativi, quindi non viene ridimensionato
affatto.

Il tetto residuo è nel materiale: le sorgenti sono 2048×1536 già ricompresse,
mentre il sito di riferimento parte da originali fino a 69 MP. Con gli originali
a piena risoluzione i ritagli nascerebbero da 3024 px invece che da 1536.

## Come funziona

La griglia non è disegnata a mano: viene generata **interamente** dalla matrice
in `src/data/mask-frames.json`. Nel markup non esiste una sola coordinata.

| | |
|---|---|
| Griglia | 54 × 42 celle, `cellSize` 12, gap 2 su entrambi gli assi, nessuno stagger |
| Animazione | 58 fotogrammi, 19 matrici uniche, hard-cut senza interpolazione |
| Ciclo | 100 ms per fotogramma, fermo quando si zooma |
| Celle accese | da 477 a 555 secondo il fotogramma |

Le celle sono `div` posizionati con `transform: translate()` — mai `top`/`left`,
così restano sul layer di composizione e lo zoom non forza un reflow.

## Interazione

Non ci sono controlli visibili, e le celle non sono cliccabili: l'unica cosa che
si può fare è muovere la vista. Il galoppo continua durante ogni gesto — non
esiste nulla che lo metta in pausa.

| Gesto | Effetto |
|---|---|
| rotella o pinch | zoom ancorato al puntatore |
| trascina | pan |

Lo zoom parte dalla scala che fa entrare la sagoma esattamente nel viewport e
sale fino a 12.5×, lo stesso rapporto fra i limiti misurati.

**Alla scala di partenza l'inquadratura è fissa.** Non si sposta e non si può
ridurre oltre: il cavallo resta sempre nella stessa posizione, e il galoppo gira.

Appena si zooma il galoppo si ferma e la vista si sblocca: si trascina per
muoversi e si può aprire una fotografia. Con le celle immobili il bersaglio è
stabile, ed è la condizione che rende l'apertura possibile.

| Gesto (solo sotto zoom) | Effetto |
|---|---|
| trascina | si naviga nella sagoma |
| click o tap su una cella | la fotografia si apre a schermo intero |
| frecce, `←` `→` | fotografia precedente / successiva |
| click, tap o `Esc` | si chiude |

Con una fotografia aperta la griglia **resta visibile** dietro, desaturata, sotto
un velo chiaro — come sul riferimento, dove il canvas prende `grayscale(1)` sulle
rotte di dettaglio. Passando da una fotografia all'altra **lo sfondo la segue**:
si cerca la cella che porta l'immagine di destinazione più vicina al centro dello
schermo e ci si sposta sopra, così la sagoma accompagna il cambio.

La fotografia non tocca mai i bordi: il margine lascia lo spazio alle frecce, che
altrimenti finiscono sopra l'immagine e su scatti scuri diventano invisibili.

Nessuna didascalia: solo le frecce.

Dopo **7 secondi** senza input sotto zoom si rientra da soli alla scala di
partenza, con un tween di 1200 ms, e il galoppo riprende. Sono i tempi di idle e
di rientro misurati sul sito di riferimento.

### Perché l'apertura funziona solo a griglia ferma

Non è una limitazione arbitraria. Con il galoppo in corso gli elementi cambiano
posizione ogni 100 ms: fra il momento in cui si mira una fotografia e quello in
cui si tocca, quella cella si è già spostata e sotto il dito ne è arrivata
un'altra. Il tempo di reazione umano è di circa 250 ms, cioè due o tre
fotogrammi di ritardo: sbagliare bersaglio era sistematico, non occasionale.

Oltre a legare l'apertura alla griglia ferma, il bersaglio si cattura al
`pointerdown`, si riconferma al `pointerup` che sotto il puntatore ci sia ancora
la stessa cella, e la fotografia si legge dal `dataset` dell'elemento — mai dalla
posizione.

## Sviluppo

Nessuna dipendenza a runtime, nessun build step. Serve solo un server statico,
perché la maschera viene caricata via `fetch`:

```bash
python3 -m http.server 4173
# poi apri http://localhost:4173/
```

Le dipendenze in `package.json` servono solo agli script di misura
(Playwright, js-beautify) e non finiscono nella pagina.

## Cambiare le fotografie

Metti gli originali in una cartella e rigenera le miniature (`sips` è già su
macOS). I nomi devono essere contigui, da `photo001.jpg` in avanti:

```bash
node scripts/build-photos.js <cartella>
```

Genera tutti e quattro i livelli, deduplica per hash, numera in modo contiguo e
stampa il valore di `PHOTO_COUNT` da riportare in `src/app.js`. Per `full` copia
il sorgente senza ricodificarlo quando è già entro 2048 px: ricomprimerlo
sarebbe una seconda perdita senza alcun guadagno.

Poi allinea `PHOTO_COUNT` in `src/app.js` al numero di file prodotti.

Attenzione ai nomi con spazi: senza `-print0` e `read -d ''` il ciclo li spezza
e la numerazione si sfasa.

## Rigenerare la maschera

`src/data/mask-frames.json` è un artefatto generato, non si modifica a mano.

```bash
node scripts/build-mask.js          # dalle silhouette in assets/gallop/
node scripts/use-reference-mask.js  # dalla matrice di riferimento
```

`build-mask.js` accetta qualunque risoluzione di griglia: converte una sequenza
di immagini in scala di grigi, applica una soglia, sottocampiona e scrive le
matrici booleane. Cambiando le silhouette in `assets/gallop/` e rilanciandolo,
la sagoma cambia senza toccare una riga del renderer.

## Struttura

```
index.html                  la pagina, senza interfaccia
src/app.js                  maschera, galoppo, zoom, pan
src/style.css               schermo intero, dvh, safe area
src/data/mask-frames.json   matrici booleane — generato
assets/photos/thumb/        158 ritagli quadrati 320 px (WebP)
assets/photos/hd/           158 ritagli quadrati 1024 px (WebP)
assets/photos/xl/           158 ritagli quadrati 1536 px nativi (WebP)
assets/photos/full/         158 fotogrammi interi (visore)
assets/gallop/              silhouette sorgente per build-mask.js
scripts/                    generatori della maschera
research/                   misure e spec del comportamento
prototypes/canvas-clone/    variante su canvas 2D, con pan/zoom/filtri
```

## Nota sul materiale di riferimento

Il comportamento è stato ricostruito misurando un sito esistente. I bundle di
produzione, il DOM e i dati grezzi di quel sito stanno in `_reference/` e
`research/raw/`, **esclusi dal repository**: sono materiale di studio locale e
non vanno pubblicati. Le misure e le specifiche derivate restano in `research/`.

La matrice in `src/data/mask-frames.json` è la sagoma estratta dal sito di
riferimento, non una silhouette originale: è una scelta esplicita per ottenere
una replica esatta. Per sostituirla con una propria basta `scripts/build-mask.js`.

## Licenza

MIT — vedi [LICENSE](LICENSE). La licenza copre il codice, non le fotografie.
