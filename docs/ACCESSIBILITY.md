# Accessibility and typography

StageType exists so the people at the back, the people who can't hear the speaker, and the people who process text better than speech all get the talk. Some numbers a disability services office can check:

| Reader theme | Live line | Earlier lines | Small UI text |
| :--- | :--- | :--- | :--- |
| Cream (`#1e1714` on `#fbf1e4`) | 15.8:1 | 8.1:1 | 4.7:1 |
| Espresso (`#fbf1e4` on `#1e1714`) | 15.8:1 | 10.0:1 | 6.6:1 |
| Contrast (`#1e1714` on `#fff0a8`) | 15.4:1 | 8.0:1 | 4.6:1 |
| Night (`#fff0a8` on `#1e1714`) | 15.4:1 | 9.7:1 | 6.4:1 |
| Stage ticker (`#fffef7` on `#1e1714`) | 17.5:1 | 6.0:1 | |

Every caption line clears WCAG AAA (7:1); secondary UI text clears AA (4.5:1). Beyond colour: the reader has a 14 to 56 px type scale, a loose-spacing mode for dyslexic readers, `aria-live` regions that announce finished sentences but not the in-progress fragment, full keyboard focus rings, and every animation honours `prefers-reduced-motion`. The transcript is downloadable as plain text or Markdown so it can go into a screen reader, a notes app, or an LMS.

## Typography, curated

Five faces, all SIL Open Font License, vendored in `vendor/fonts/` so they load on venue wifi with no internet. Readers pick theirs in the Aa panel on their own phone; the presenter picks the stage ticker's on the console. Nobody has to touch either: the default is the Swiss system look.

| Face | Why it's here |
| :--- | :--- |
| System (Helvetica / SF) | Zero bytes, invisible, the stage default |
| Inter | Clean humanist grotesk, tall x-height, variable weight |
| Atkinson Hyperlegible | Designed by the Braille Institute for low-vision readers; letterforms that can't be confused for each other |
| Fraunces | Warm soft serif at its softest setting, for rooms that want a friendlier voice |
| JetBrains Mono | For the dev talk, where captions read like the code on screen |

Weight is three stops (Regular, Medium, Bold). **Flow** is two: *Live words* streams the in-progress fragment as it's recognised; *Settled sentences* shows finished sentences only, which is calmer on a six-metre screen and for readers who find the flicker tiring. The stage ticker also chooses its **style** (Ink, a dark bar; Paper, a light one for bright rooms and light decks), **depth** (one to three lines) and **ring** colour (or none). The same options ride the standalone ticker's query string: `style`, `face`, `weight`, `size` (px), `depth`, `flow`, `ring`. Webfonts cover Latin and Latin Extended; other scripts fall through to the system stack.

A **talk title** ("COMP1010 Week 3") shows on every phone, on the projector QR card, and in the exported file name and Markdown header.
