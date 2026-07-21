# Gyotaku Plotter Prints

Upload a salmon photo → gyotaku-style pen-plotter artwork → order a hand-plotted original or giclée.

**Current focus: Phase 0** — offline generator quality. See [`generator/README.md`](generator/README.md).

```bash
cd generator && pip install -e ".[dev]"
gyotaku generate corpus/images/01_fish.jpg -o /tmp/gyotaku-out
gyotaku corpus
```

Phases 1–3 (queue API, web UI, checkout) wait until corpus outputs are wall-worthy.

### Railway

Railpack needs a start command. Until Phase 1, the root service is a **health placeholder** (`app.py` + `railpack.json`) — not the product API. Local generation still runs from `generator/`.

---

## How it works when finished

### For the customer

1. **Upload** a salmon photo from their phone (drag-drop or camera roll).
2. **Wait ~20–90s** while the generator runs: cut the fish from the background → turn tone into pen strokes → apply light “ink” imperfections → make an SVG + preview.
3. **Preview** a watermarked print on paper texture. Tweak style (density / ink character). Each tweak makes a new version; good combos are cached.
4. If the photo is bad (busy background, blur, etc.), they get a clear “try another photo” message — not a muddy fake print.
5. **Order** size + type:
   - **Plotted original** — hand-drawn on an AxiDraw, signed/editioned
   - **Giclée** — high-res print, no hand plotting
6. Pay via Stripe → shipping → done. No account until checkout.

### Behind the scenes

```
Phone → website → API → job queue → Python generator → S3 (SVG + previews)
                              ↓
                         Postgres (order + seed)
```

Every artwork stores its **seed + settings**, so a reprint or re-plot is identical.

### For the operator

- A small **plot queue**: download SVG, see estimated plot time, mark plotting → packed → shipped, add tracking.
- Originals stay limited; if the queue gets too long, that tier closes automatically.
- Giclées go out through a print-on-demand path without touching each one.

### What “finished” really means

Phase 0 quality first: the generator makes prints you’d hang. Then the website is just plumbing around that. The product people buy is the **line work**, not the app.
