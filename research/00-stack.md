# FASE 0 — Recon stack: jinleeoffice.com

Misurato il 2026-08-06. Chromium headless (Playwright 1.62.1), viewport 1440×900 @dpr2 e 390×844 @dpr2.

## 1. Stack

| Livello | Valore | Come l'ho stabilito |
|---|---|---|
| Framework | **SvelteKit** (Svelte 5, compilato con le rune) | Struttura path `/_app/immutable/{entry,nodes,chunks,assets}/`, file `start.*.js` + `app.*.js`, nodi numerati `nodes/0..3` |
| Bundler | Vite / Rollup (default SvelteKit) | Naming hash a 8 char base64url, chunk splitting per rotta |
| Rendering | SSR + hydration | HTML del documento = 74 KB con markup completo; script inline di hydration da 61.382 caratteri |
| CMS / dati | **Sanity** — projectId `j9vmr6ts`, dataset `production` | Client Sanity dentro `chunks/DhVBEBIW.js`; immagini da `cdn.sanity.io/images/j9vmr6ts/production/` |
| Libreria di animazione | **NESSUNA** | Zero match per gsap/GreenSock/ScrollTrigger/Lenis/Locomotive/Framer/Motion/anime/Tween in tutti i bundle. Tutte le animazioni sono `requestAnimationFrame` scritte a mano |
| Smooth scroll | **NESSUNO** (né libreria né wrapper) | `document.documentElement.scrollHeight === clientHeight === 900`; `body { overflow: auto hidden }`. La home non scrolla affatto |
| Rendering griglia | **Canvas 2D** (non WebGL) | Un solo `<canvas>`, `getContext('webgl')` → null dopo che il 2d è attivo; il bundle usa `drawImage` da atlas |
| Routing | SvelteKit client-side router + **View Transitions API nativa** | `view-transition-name: navbar`, pseudo-elementi `::view-transition-old/new(work-page)` nel CSS |
| Analytics | GA4 (`G-9Z68HQNR3X`) | Tag googletagmanager |
| Font | **NEXT Mono Thin**, weight 100, woff2 + woff fallback, `font-display: swap` | `@font-face` in `0.ltaFBs3n.css:203-209` |

**Conseguenza per la ricostruzione:** non esiste un layer di libreria da riprodurre. Va reimplementato un motore rAF proprio. Tutti i numeri in ANIMATION_SPEC.md sono letterali estratti dal bundle, non default di libreria.

## 2. File scaricati e beautified

In `/research/bundles/` (21 file, `manifest.json` con URL → path). I due che contano:

- `nodes/0.8FshwVoq.js` — 1036 righe beautified. **Contiene l'intero motore della griglia**: pan, zoom, inerzia, LOD, hover, idle, loading. 36 hit su keyword di animazione; tutti gli altri file: 1 hit ciascuno (falsi positivi).
- `css/0.ltaFBs3n.css` — 826 righe. Tutte le transizioni CSS, @font-face, variabili di tema.
- `css/naturalGrid.DE_z6Qf6.css` — 55 righe. Il secondo layout ("Natural Grid").
- `css/3.BGONRHO9.css` — la pagina /info.

## 3. Rete e caricamento immagini

Ordine osservato (desktop, tempi dal navigationStart):

```
 726ms  document        74 KB
 861ms  2× stylesheet   13.5 KB + 0.7 KB
1441ms  17× script      ~250 KB totali (start → chunks → nodes)
1474ms  font woff2      23.7 KB   NEXT-Mono-Thin
1492ms  ~60× image      cdn.sanity.io, 0.5–7 KB ciascuna
```

**Parametri di trasformazione Sanity:** `?w=<N>&auto=format&q=75`.
Solo `w`, `auto=format` (WebP/AVIF via content negotiation) e `q=75`. Nessun `h`, `fit`, `crop`, `dpr`.

`w` non è fisso: è il **tier LOD** scelto in base allo zoom corrente (vedi ANIMATION_SPEC §B2). Al primo paint tutte le immagini partono a `w=128`; salendo di zoom il motore richiede `w=256`, `512`, `1024`.

Nessun `loading="lazy"`: le immagini non sono elementi `<img>` del DOM, sono caricate via `Image()` e disegnate su canvas. Il "lazy loading" è quindi gestito a mano per tier.

## 4. Struttura DOM

Il body ha **un solo figlio**, con 3 nipoti. Niente classi su `<html>`/`<body>`. Il contenuto visibile è quasi tutto dentro `.pixel-grid > canvas`; il DOM contiene solo la navbar, il tooltip di intro e i layer UI.

UI reale della navbar (rilevata a runtime, non dal design):

- `.navbar__logo` "Jin Lee Office"
- `.navbar__link_works` "Works" (active)
- `.navbar__link_info` "Info"
- `.navbar__list` → bottone "Filters +"
- `.view` → 2 bottoni: `aria-label="Pixel Grid view"` (active) e `"Natural Grid view"`
- `.zoom` → **2 bottoni** (+ / −), SVG inline

## 5. Tre scostamenti dal brief da segnalare subito

1. **Lo "Zoom" non è uno slider.** Sono due bottoni con step moltiplicativo ×1.5 / ÷1.5. Non c'è un range input né una scala continua nell'UI (il pinch su touch invece è continuo).
2. **Non esiste un cursore custom.** Il canvas usa i cursori CSS nativi `grab` e `pointer`. Nessun elemento `[class*=cursor]` nel DOM, nessun lag/lerp da misurare.
3. **Non esiste smooth scroll**, perché non esiste scroll. La home è un canvas pannabile a schermo intero. Il punto A del brief va riletto come "fisica del pan", ed è lì che ho misurato.
