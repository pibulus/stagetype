# Accessibility and typography

StageType exists so the people at the back, the people who can't hear the speaker, and the people who process text better than speech all get the talk. Some numbers a disability services office can check:

Measured from the computed colours in the browser (Aug 2026 pass):

| Reader theme | Live line | Earlier lines | Small UI text |
| :--- | :--- | :--- | :--- |
| Cream (`#1e1714` on `#fbf1e4`) | 17.5:1 | 8.1:1 | 5.4:1 |
| Espresso (`#fbf1e4` on `#1e1714`) | 15.8:1 | 10.0:1 | 7.5:1 |
| Contrast (`#1e1714` on `#fff0a8`) | 15.4:1 | 8.0:1 | 5.4:1 |
| Night (`#fff0a8` on `#1e1714`) | 15.4:1 | 9.7:1 | 7.3:1 |
| Stage ticker, ink (`#fffdf5` on `#1e1714`) | 17.4:1 | 5.2:1 | |
| Stage ticker, paper/brut/hemingway | 17.4–12.0:1 | ≥ 4.6:1 (78% instead of 62%) | |

Every caption line clears WCAG AAA (7:1); secondary UI text clears AA (4.5:1). Beyond colour: the reader has a 14 to 56 px type scale, a loose-spacing mode for dyslexic readers, `aria-live` regions that announce finished sentences but not the in-progress fragment, full keyboard focus rings, and every animation honours `prefers-reduced-motion`. The transcript is downloadable as plain text or Markdown so it can go into a screen reader, a notes app, or an LMS.

## Typography, curated

Five faces, all SIL Open Font License, vendored in `vendor/fonts/` so they load on venue wifi with no internet. Readers pick theirs in the Aa panel on their own phone. The presenter no longer picks a face: each of the four stage styles ships its own (Ink and Yellow Brut are Helvetica bold, Paper is Inter medium, Hemingway is Fraunces regular). Nobody has to touch either: the default is the Swiss system look.

| Face | Why it's here |
| :--- | :--- |
| System (Helvetica / SF) | Zero bytes, invisible, the stage default |
| Inter | Clean humanist grotesk, tall x-height, variable weight |
| Atkinson Hyperlegible | Designed by the Braille Institute for low-vision readers; letterforms that can't be confused for each other |
| Fraunces | Warm soft serif at its softest setting, for rooms that want a friendlier voice |
| JetBrains Mono | For the dev talk, where captions read like the code on screen |

Readers choose weight (Regular, Bold) and **flow**: *Live words* streams the in-progress fragment; *Settled sentences* shows finished ones only, calmer on a six-metre screen. The presenter chooses one thing, the **style** (Ink, a dark bar; Paper, a light one for bright rooms; Yellow Brut, a warm slab; Hemingway, Fraunces on cream), which carries its face, weight and frame. Size is three stops (S 28 px / 1 line, M 38 / 2, L 50 / 3). The standalone ticker takes the same options as a query string: `style`, `face`, `weight`, `size`, `depth`, `flow`. Webfonts cover Latin and Latin Extended; other scripts fall through to the system stack.

A **talk title** ("COMP1010 Week 3") shows on every phone, on the projector QR card, and in the exported file name and Markdown header.
