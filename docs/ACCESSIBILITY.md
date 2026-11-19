# Accessibility and typography

StageType exists so the people at the back, the people who can't hear the speaker, and the people who process text better than speech all get the talk. Every ratio below is computed directly from the active sRGB tokens in `audience.html`, `presenter.html`, `ticker.html`, `join.html`, `mic.html`, and `demo.html`.

| Surface & theme | Primary caption text | Earlier lines | Secondary UI / muted |
| :--- | :--- | :--- | :--- |
| Reader · Cream (`#1e1714` on `#fbf1e4`) | 15.8:1 (AAA) | 10.6:1 (AAA) | 7.9:1 (AAA) |
| Reader · Espresso (`#fbf1e4` on `#1e1714`) | 15.8:1 (AAA) | 10.6:1 (AAA) | 7.9:1 (AAA) |
| Reader · High contrast (`#1e1714` on `#fff0a8`) | 15.4:1 (AAA) | 10.3:1 (AAA) | 7.7:1 (AAA) |
| Reader · Night (`#fff0a8` on `#1e1714`) | 15.4:1 (AAA) | 10.3:1 (AAA) | 7.7:1 (AAA) |
| Stage & Standalone ticker · Ink (`#fffdf5` on `#1e1714`) | 17.5:1 (AAA) | 7.2:1 (AAA) | — |
| Stage & Standalone ticker · Paper (`#1e1714` on `#fbf1e4`) | 15.8:1 (AAA) | 9.6:1 (AAA, 78% opacity) | — |
| Stage & Standalone ticker · Yellow Brut (`#1e1714` on `#ffc74d`) | 11.4:1 (AAA) | 7.0:1 (AAA, 78% opacity) | — |
| Stage & Standalone ticker · Hemingway (`#2c221e` on `#f7ecdc`) | 13.5:1 (AAA) | 8.4:1 (AAA, 78% opacity) | Interim `#724c27` ≥ 5.5:1 (AA) |
| Lapel Mic (`#fbf1e4` on `#1e1714`) | 15.8:1 (AAA) | — | 8.3:1 (`rgba(251,241,228,.72)`) |

Beyond colour:
- **Screen-reader live announcements:** Dedicated polite announcers on the reader, standalone ticker, and demo announce finalized sentences only (never spamming interim keystrokes or flooding late-joiner backlogs). The lapel mic echo intentionally omits `aria-live` so VoiceOver never feeds back into the microphone.
- **Keyboard & focus management:** High-contrast `var(--ink)` focus rings (`≥ 3:1` across every theme and vibe); `role="dialog" aria-modal="true"` with focus trapping & focus restoration on fullscreen QR and shared-image lightbox modals; keyboard line starring (`Enter`/`Space`), keyboard kept-quote reordering (`↑`/`↓`), and global shortcuts that never hijack focused buttons or modals.
- **Reading comfort & RTL:** 14–56 px text scale, loose dyslexic spacing mode, `lang` broadcast + `dir="auto"` with logical inline-start borders for RTL languages (such as Arabic), Screen Wake Lock while live, `prefers-reduced-motion` honoured in CSS and JS, and clean `.md` / print-PDF exports.

## Typography, curated

Five faces, all SIL Open Font License, vendored in `vendor/fonts/` so they load on venue wifi with no internet. Both readers (in the `Aa` panel) and presenters (in the stage face picker) can choose their typeface, and every stage style preset carries its own default face, weight, and frame accent.

| Face | Why it's here |
| :--- | :--- |
| System (Helvetica / SF) | Zero bytes, crisp Swiss sans |
| Inter | Clean humanist grotesk, tall x-height, variable weight |
| Atkinson Hyperlegible | Designed by the Braille Institute for low-vision readers; unmistakable letterforms (default on Ink stage) |
| Fraunces | Warm soft serif (`SOFT: 100`), default on Hemingway stage |
| JetBrains Mono | For the dev talk, where captions read like the code on screen |

Readers choose weight (Regular, Medium, Bold) and **flow**: *Live words* streams the in-progress fragment; *Settled* shows finished sentences only. Note: Atkinson Hyperlegible ships weights `400` and `700`; Inter, Fraunces, and JetBrains Mono are variable fonts. Webfonts cover Latin and Latin Extended; other scripts fall through to the system stack.
