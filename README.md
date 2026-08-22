# cavallo — griglia mascherata a schermo intero

Un cavallo al galoppo composto da fotografie: ogni fotogramma dell'animazione è
una maschera di occupazione su una griglia **54 × 42**, e le celle accese
ospitano l'immagine. Nessuna interfaccia — solo la sagoma, a tutto schermo su
desktop e iPhone. Il galoppo non si ferma mai.

Le celle mostrano 158 fotografie scattate in Puglia, in due livelli di dettaglio:
miniature a 320 px (`assets/photos/thumb`, 5.3 MB) alla scala di partenza, e
versioni a 900 px (`assets/photos/hd`, 28 MB) quando si zooma. Le HD si scaricano
**solo** oltre la soglia, quindi all'apertura la pagina carica 5.3 MB. Esiste un
terzo livello (`assets/photos/full`, 134 MB) che serve unicamente al visore: si
scarica una immagine alla volta, quella che si apre.

Il terzo livello è a **2048 px**, che è la risoluzione nativa delle sorgenti: non
c'è margine per andare oltre senza interpolare. Una versione precedente le
riduceva a 1600 px e a schermo intero si vedeva.

La soglia è sul lato della cella in pixel reali del dispositivo: sopra 200 px la
miniatura verrebbe ingrandita e si sgranerebbe. A zoom massimo una cella arriva a
605 px su desktop retina, coperti dai 675 px di lato corto delle HD.

L'assegnazione è fissa per elemento: l'ennesimo `div` del pool porta sempre la
stessa fotografia. Il rimescolamento che si vede nasce dal fatto che a ogni
fotogramma quello stesso elemento finisce in una posizione diversa della sagoma.

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

Passando da una fotografia all'altra **lo sfondo la segue**: si cerca la cella
che porta l'immagine di destinazione più vicina al centro dello schermo e ci si
sposta sopra, così la sagoma dietro accompagna il cambio invece di restare ferma.

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
i=0
find <cartella> -type f -iname '*.jpg' -print0 | sort -z | while IFS= read -r -d '' f; do
  i=$((i+1)); n=$(printf 'photo%03d.jpg' $i)
  sips -s format jpeg -s formatOptions 78 -Z 320 "$f" --out "assets/photos/thumb/$n"
  sips -s format jpeg -s formatOptions 82 -Z 900 "$f" --out "assets/photos/hd/$n"
done
```

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
assets/photos/thumb/        158 miniature a 320 px (scala di partenza)
assets/photos/hd/           158 versioni a 900 px (sotto zoom)
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
