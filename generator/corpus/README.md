# Phase 0 test corpus — salmon fishing

Twenty salmon/fish inputs for visual regression. Real user catches + Wikimedia Commons photos.

```bash
gyotaku corpus
# → corpus/runs/<timestamp>/contact_sheet.png
```

- `01`–`05`: user uploads
- `06`–`16`: Wikimedia Commons salmon (chinook, coho, sockeye/kokanee)
- `17`–`20`: deliberately bad (should soft-reject)

See `SOURCES.json` for filenames and sizes. Do **not** run `gyotaku make-corpus` — that regenerates synthetic placeholders and will wipe these.
