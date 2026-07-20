# Phase 0 test corpus

Twenty fixed inputs for visual regression. Re-run after every generator change:

```bash
gyotaku corpus
# → corpus/runs/<UTC timestamp>/contact_sheet.png
```

## Contents

Synthetic stand-ins (JPEG) covering dogs, cats, fish, a bird, and four deliberately bad inputs that should soft-reject at the matte gate.

Replace these with real photos when available — keep filenames or drop any `*.jpg`/`*.png` into `images/`. There is no automated “looks good” metric; review the contact sheet by eye.

Regenerate synthetics with `gyotaku make-corpus` if the recipe in `gyotaku/synth_corpus.py` changes.
