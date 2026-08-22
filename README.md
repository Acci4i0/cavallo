# cavallo — griglia mascherata a schermo intero

Un cavallo al galoppo composto da fotografie: ogni fotogramma dell'animazione è
una maschera di occupazione su una griglia **54 × 42**, e le celle accese
ospitano l'immagine. Nessuna interfaccia — solo la sagoma, a tutto schermo su
desktop e iPhone. Il galoppo non si ferma mai.

Tutte le celle mostrano la stessa fotografia. La sorgente è
`assets/photos/source/IMG_5757.HEIC`; da lì derivano il JPEG e la miniatura che
la griglia usa davvero.

## Come funziona

La griglia non è disegnata a mano: viene generata **interamente** dalla matrice
in `src/data/mask-frames.json`. Nel markup non esiste una sola coordinata.

| | |
|---|---|
| Griglia | 54 × 42 celle, `cellSize` 12, gap 2 su entrambi gli assi, nessuno stagger |
| Animazione | 58 fotogrammi, 19 matrici uniche, hard-cut senza interpolazione |
| Ciclo | 100 ms per fotogramma, ininterrotto |
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

## Sviluppo

Nessuna dipendenza a runtime, nessun build step. Serve solo un server statico,
perché la maschera viene caricata via `fetch`:

```bash
python3 -m http.server 4173
# poi apri http://localhost:4173/
```

Le dipendenze in `package.json` servono solo agli script di misura
(Playwright, js-beautify) e non finiscono nella pagina.

## Cambiare la fotografia

Basta sostituire la sorgente e riconvertirla (`sips` è già su macOS):

```bash
sips -s format jpeg -s formatOptions 85 -Z 1600 <nuova> --out assets/photos/photo.jpg
sips -s format jpeg -s formatOptions 80 -Z 320  <nuova> --out assets/photos/thumb/photo.jpg
```

La griglia usa solo la miniatura: le celle sono piccole e l'immagine viene
ritagliata al centro con `background-size: cover`. Il JPEG grande resta come
copia leggibile dai browser, che l'HEIC non supportano tutti.

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
assets/photos/              la fotografia, la miniatura e l'originale HEIC
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
