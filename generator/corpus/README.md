# Salmon test corpus

Twenty salmon/fish inputs for visual regression. Real user catches + Wikimedia Commons photos.

```bash
gyotaku corpus
# → corpus/runs/<timestamp>/contact_sheet.png

gyotaku corpus --gate          # fail if matteScore / pathCount drift past baseline
gyotaku corpus --write-baseline  # refresh corpus/baseline_metrics.json after intentional changes
```

- `01`–`05`: user uploads
- `06`–`16`: Wikimedia Commons salmon (chinook, coho, sockeye/kokanee)
- `17`–`20`: deliberately bad (should soft-reject)

See `SOURCES.json` for filenames and sizes. Do **not** run `gyotaku make-corpus` — that regenerates synthetic placeholders and will wipe these.

CI runs unit tests (including salmon matte heuristics + gate helpers). Full `--gate` on real photos is opt-in via repo variable `GYOTAKU_CORPUS_GATE=1`.
