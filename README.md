# cavallo — a galloping horse made of photographs

A horse at full gallop, drawn out of photographs: every frame of the animation
is an occupancy mask over a **54 × 42** grid, and the lit cells hold the images.
No interface — just the silhouette, fullscreen on desktop and on iPhone. The
gallop never stops.

**Live:** https://acci4i0.github.io/cavallo/

The cells show 158 photographs taken in Puglia, in **WebP**, across three
levels of detail chosen by the cell's real pixel size:

| Level | Contents | When | Weight |
|---|---|---|---|
| `thumb` | 320 px square | up to a 200 px cell | 2.4 MB |
| `hd` | 1024 px square | up to 600 px | 18.5 MB |
| `xl` | 1536 px square, **native** | beyond 600 px | 42.6 MB |
| `full` | whole frame | viewer, one at a time | 129.5 MB |

Each level downloads only once its threshold is crossed: on load the page pulls
the 2.4 MB of `thumb` and nothing else.

The grid levels are **square** because the cells are, and they use
`background-size: cover`: on a 4:3 image the long side would be thrown away
anyway, so cropping upstream means every downloaded pixel reaches the screen.
No level ever upscales its source.

### Sharpness

At maximum zoom a cell measures 605 real pixels and is served at 1536:
**2.54× oversampling**, against the reference site's 1.71×.

Re-encoding is done by **Chrome**, not `sips`. Measuring how much detail
survives against an uncompressed ideal:

| Pipeline | Retention |
|---|---|
| reference site, AVIF q75 | 72.6% |
| `sips` q82 (used before) | 77.2% |
| **Chrome + WebP (current)** | **94.8% `hd`, 97.5% `xl`** |

`sips` uses a poor resampling filter: on detail-rich images it dropped to 62%.
The `xl` level is at native pixels, so it isn't resized at all.

What's left on the table is the material: the sources are 2048×1536 and already
recompressed, while the reference site starts from originals up to 69 MP. With
full-resolution originals the crops would come from 3024 px instead of 1536.

## How it works

The grid isn't hand-drawn: it is generated **entirely** from the matrix in
`src/data/mask-frames.json`. There is not one coordinate in the markup.

| | |
|---|---|
| Grid | 54 × 42 cells, `cellSize` 12, gap 2 on both axes, no stagger |
| Animation | 58 frames, 19 unique matrices, hard cuts with no interpolation |
| Cycle | 100 ms per frame, frozen while zoomed |
| Lit cells | 477 to 555, depending on the frame |

Cells are `div`s positioned with `transform: translate()` — never `top`/`left`
— so they stay on the compositing layer and zooming doesn't force a reflow.

## Interaction

There are no visible controls, and the cells aren't clickable: the only thing
you can do is move the view. The gallop continues through every gesture —
nothing pauses it.

| Gesture | Effect |
|---|---|
| wheel or pinch | zoom anchored to the pointer |
| drag | pan |

Zoom starts at the scale that fits the silhouette exactly into the viewport and
goes up to 12.5×, the same ratio as the measured limits.

**At the starting scale the framing is fixed.** It doesn't move and can't be
pulled back further: the horse stays put, and the gallop runs.

The moment you zoom, the gallop stops and the view unlocks: you drag to move
around and you can open a photograph. With the cells still, the target is
stable — and that is the condition that makes opening one possible at all.

| Gesture (only while zoomed) | Effect |
|---|---|
| drag | move through the silhouette |
| click or tap a cell | the photograph opens fullscreen |
| `←` `→` | previous / next photograph |
| click, tap or `Esc` | close |

With a photograph open the grid **stays visible** behind it, desaturated under a
pale veil — as on the reference, where the canvas takes `grayscale(1)` on
detail routes. Moving from one photograph to the next, **the background
follows**: it looks for the cell carrying the destination image closest to the
centre of the screen and travels there, so the silhouette accompanies the
change.

The photograph never touches the edges: the margin leaves room for the arrows,
which would otherwise sit on top of the image and disappear against dark shots.

No captions. Just the arrows.

After **7 seconds** without input while zoomed, the view returns to the starting
scale on its own with a 1200 ms tween, and the gallop resumes. Those are the
idle and return timings measured on the reference site.

### Why opening only works when the grid is still

This isn't an arbitrary restriction. With the gallop running, elements change
position every 100 ms: between aiming at a photograph and touching it, that cell
has already moved and another has arrived under your finger. Human reaction time
is around 250 ms — two or three frames of lag — so hitting the wrong target was
systematic, not occasional.

Beyond tying the interaction to a still grid, the target is captured on
`pointerdown`, reconfirmed on `pointerup` that the same cell is still under the
pointer, and the photograph is read from the element's `dataset` — never from
its position.

## Running it

No runtime dependencies and no build step. All you need is a static server,
because the mask is loaded over `fetch`:

```bash
python3 -m http.server 4173
# then open http://localhost:4173/
```

The dependencies in `package.json` exist only for the measurement scripts
(Playwright, js-beautify) and never reach the page.

## Changing the photographs

Put the originals in a folder and regenerate the crops (`sips` ships with
macOS). Names must be contiguous, from `photo001.jpg` upward:

```bash
node scripts/build-photos.js <folder>
```

It generates all four levels, deduplicates by hash, numbers contiguously and
prints the `PHOTO_COUNT` value to carry into `src/app.js`. For `full` it copies
the source without re-encoding when it is already within 2048 px: recompressing
would be a second loss for no gain.

Then align `PHOTO_COUNT` in `src/app.js` to the number of files produced.

Watch out for names with spaces: without `-print0` and `read -d ''` the loop
breaks them apart and the numbering slips.

## Regenerating the mask

`src/data/mask-frames.json` is a generated artefact — don't edit it by hand.

```bash
node scripts/build-mask.js          # from the silhouettes in assets/gallop/
node scripts/use-reference-mask.js  # from the reference matrix
```

`build-mask.js` accepts any grid resolution: it converts a sequence of images to
greyscale, applies a threshold, subsamples and writes the boolean matrices.
Change the silhouettes in `assets/gallop/` and re-run it, and the shape changes
without touching a line of the renderer.

## Structure

```
index.html                  the page, no interface
src/app.js                  mask, gallop, zoom, pan
src/style.css               fullscreen, dvh, safe area
src/data/mask-frames.json   boolean matrices — generated
assets/photos/thumb/        158 square 320 px crops (WebP)
assets/photos/hd/           158 square 1024 px crops (WebP)
assets/photos/xl/           158 square native 1536 px crops (WebP)
assets/photos/full/         158 whole frames (viewer)
assets/gallop/              source silhouettes for build-mask.js
scripts/                    mask and photo generators
research/                   measurements and behavioural specs
```

## A note on the reference material

The behaviour was reconstructed by measuring an existing site. That site's
production bundles, DOM and raw data live in `_reference/` and `research/raw/`,
**excluded from this repository**: they are local study material and are not to
be published. The derived measurements and specs stay in `research/`.

The matrix in `src/data/mask-frames.json` is the silhouette extracted from the
reference site, not an original one — a deliberate choice, to get an exact
replica. Replacing it with your own is what `scripts/build-mask.js` is for.

## License

[MIT](LICENSE) © Andrea Lando ([Acci4i0](https://github.com/Acci4i0)).
Covers the code, not the photographs.
