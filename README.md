# Gyotaku Plotter Prints

Upload a photo → gyotaku-style pen-plotter artwork → order a hand-plotted original or giclée.

**Current focus: Phase 0** — offline generator quality. See [`generator/README.md`](generator/README.md).

```bash
cd generator && pip install -e ".[dev]"
gyotaku make-corpus
gyotaku generate corpus/images/01_fish_side.png -o /tmp/gyotaku-out
```

Phases 1–3 (queue API, web UI, checkout) wait until corpus outputs are wall-worthy.
