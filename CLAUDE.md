# 🎙️ StageType (CLAUDE.md)
> Live presentation captions ticker + wireless phone lapel mic + instant audience QR reader.
> Part of the TalkType family. Sovereign, zero-dependency, in-memory architecture.

## 🏃 Quick Start & Commands
```bash
deno task dev           # Start development server with auto-reload (port 8787)
deno task start         # Start production server
deno task listen-local  # Pipe stdin / whisper-stream to a room over LAN without internet
deno task test          # Unit tests (server_test.ts)
deno task check         # TypeScript type-checking
deno task ci            # fmt --check + lint + check + test: run before every commit
deno task e2e           # Browser suite (e2e/browser_test.js), needs Chromium: CHROMIUM_PATH or Playwright's install
```

## 📁 Where things live
- Docs: README.md is the front door only. Depth goes in `docs/ARCHITECTURE.md` (API, engines, persistence, security, file map), `docs/DEPLOY.md` (env vars, launch checklist), `docs/ACCESSIBILITY.md` (contrast table, typefaces), `docs/GLOSSARY.md`. Product and business in `ROADMAP.md`. Update the doc that owns a fact; don't duplicate it into the README.
- Tests: `server_test.ts` (unit), `e2e/browser_test.js` (browser, plain JS because most of it runs in the page), `e2e/mock_deepgram.ts` (shared by both). New behaviour gets a test in the right one.
- Config: every env var is in `.env.example` and the DEPLOY table. Add to both or neither.
- CI: `.github/workflows/ci.yml` runs `deno task ci` then `deno task e2e`.

## 🌐 Routes & Ports
- Default port: `8787` (`http://localhost:8787`)
- Presenter Console: `GET /`
- Audience Live Reader: `GET /live/:roomId`
- Phone Lapel Mic: `GET /mic/:roomId#token`
- Standalone Ticker: `GET /ticker/:roomId?style=ink|paper&face=…&weight=…&size=NNpx&depth=1-3&flow=live|settled&ring=…` (second screens, OBS)
- Join by code: `GET /join` (also `/live`), `GET /j/:code` (302), `GET /api/join/:code` -> `{ id }`
- Live demo: `GET /demo`, `GET /api/demo/mint` -> `{ id, sig, exp, token }`, `GET /api/demo/:id?s=` -> `{ alive, listeners }`. A signed demo id becomes a room on the first `GET /api/room/:id/stream?s=<sig>` (the reader forwards `?s=`). Demo rooms: 3 listeners, 10 min, no Deepgram, token = `derive(SECRET, id, "write")`. Env `STAGETYPE_SECRET` (random per process if unset).
- Network Discovery: `GET /api/info` (returns LAN IP and port for QR encoding)
- Static: `GET /vendor/qrcode.js`, `GET /vendor/fonts.css`, `GET /vendor/fonts/*.woff2` (allowlisted names only, immutable cache), `GET /ghost.svg` (favicon), `GET /deepgram.js` (client capture script)
- Engines: `GET /api/engines` -> `{ browser, deepgram }`; `WS /api/room/:id/audio?source=&lang=` with subprotocol `["bearer", token]` streams PCM16 @ 16 kHz to Deepgram via the relay. Env: `DEEPGRAM_API_KEY` (off without it), `DEEPGRAM_MODEL` (nova-3), `DEEPGRAM_URL` (tests point it at a mock).
- Room Lifecycle API:
  - `POST /api/room` (optional `{ title }`) -> `{ id, token, title, code }`; codes are 4 letters from ABCDEFGHJKLMNPRSTUVWXYZ, blocklisted words skipped, unique among open rooms, released on end (capped at 1000 open rooms; title ≤ 80 chars)
  - `POST /api/room/:id` (Bearer auth) -> pushes speech chunk `{ text, final, source: mic|phone|typed, speaker?, phone? }`; `{ ping: true }` is a silent keepalive; `{ ping: true, source: "phone", live, phone? }` announces/heartbeats a phone session in `room.phones` (up to 8 concurrent phones, lost after 45 s of silence, checked every 5 s)
  - `GET /api/room/:id/stream` -> Server-Sent Events: `backlog { lines, speakers?, offset, startedAt, title, phone }`, `interim { text, source, speaker? }`, `final { text, seq, source, speaker? }`, `source { source, live, lost, phones }`, `end`
  - `DELETE /api/room/:id` (Bearer auth) -> ends talk and flushes room
- Invariants: token compared in constant time (`sameToken`); push body ≤ 16 KB; images ≤ 2 MB with a ≤ 90k-char thumb, 40 a room, 24 MB a room, validated before anything is broadcast; join-code lookups rate limited (`takeJoinSlot`, capped at 10k buckets); backlog keeps last 400 lines and reports `offset`; every listener's ping timer is cleared on end/sweep (Deno's test sanitizer enforces this).

## 🎨 Design System & Aesthetic Laws
- **Soft Neo Toybrut** (console tokens; the reader keeps its own theme pairs):
  - Ground: `#fff6e6` (plus 4 Page Atmospheres cycled via `#vibePill`: Peach Sunset, Stage Lights, Warm Paper, Night Ink)
  - Surface: `#fffdf5`
  - Sand (the room card): `#fdf1e0`
  - Ink: `#1e1714`
  - Borders & Shadows: `2px solid var(--line)` with `4px 4px 0 var(--line)` hard offset shadows on `.bar` and `.card`; `1.5px solid var(--line)` with `2px 2px 0` on controls and custom `.stage-select` popovers
  - Accents: pink `#ff6ac2`, coral `#ff8a5c`, amber `#ffc74d`, teal `#2dd4bf`, violet `#a78bfa`
- **Zero absolute white (`#fff`) or absolute black (`#000`)** across body and UI surfaces.
- **NO EMOJIS as button labels or copy garnish**. Keep buttons typographic and clear.
- `button { display: inline-flex }` beats the `hidden` attribute; keep the `button[hidden] { display: none }` rule.
- **No mascot.** The console, the demo landing and the join page are type-led: a wordmark, a status pill, nothing smiling at the presenter. Lumen lives in git history, not on screen.
- **Tactile Neo-Toybrut hardware framing.** The console is centered in the viewport (`min-height: 100dvh`) as a balanced hardware deck. Cards wear crisp `2px` warm sepia borders and `4px 4px 0` offset shadows; `#ticker` is locked to a fixed `220px` height (`overflow: hidden`, bottom-anchored) so multi-line wraps never push controls downward. Native `<select>` elements are progressively enhanced into `.stage-select` spring popovers while keeping `<select>` synced in DOM for accessibility and tests.
- **One palette, intentional accents.** Hot pink `#ff6ac2` is the primary "go" colour on the console, amber `#ffc74d` the pause, teal `#2dd4bf` the live ring, violet `#a78bfa` the float and lapel-mic QR accent. Audience CTAs (join, demo) may wear mint. No dot grid behind running text.
- **Layout before decoration.** The talk bar runs full width on top (title + `#wordsChip`, language, engine, one action), then two cards of matched height: the stage on the left, the room (QR + code + `Room | Phone mic` tabs) on the right.
- **Auto-sent means pull-back-able.** Anything that reaches forty phones without a second glance needs an undo: the console's tray thumbnails are buttons, and DELETE on the asset broadcasts `asset-gone` so the figure leaves every feed (and reconnects reconcile `assets` against the live set).
- **Images are a catch, not a gallery.** A shared picture lands in the reader's transcript where it was shared, live only, capped at 58vh, tap for the full frame. They are compressed in the console (1280 WebP q0.7 + 320 thumb, with `bitmap.close()` in `finally`) before upload, so the relay never sees a 12 MP photo, and they die with the room: no image ever enters the saved copy.
- **Offering beats sending.** Coming back to the console with a screenshot on the clipboard shows a chip (thumbnail + "Share the clipboard image"); it never broadcasts by itself. A private DM or a password manager on the clipboard must not walk into a room of eighty. ⌘V, drag-drop and the file picker are the explicit paths.
- **Names ride along.** The `Names to get right` field (More, seeded from the talk title on the first Start or via `?title=&words=` URL query params) goes to Deepgram as repeated `keyterm` params (or `keywords` before nova-3), runs client-side via `applyRoomWords()` for Browser STT (including CamelCase compounds), and rides into the phone-mic pairing QR. Sanitised server-side: 20 terms, 40 chars.
- **Exports are prose.** Both the console and the reader paragraph by pause (8 s) and sentence-grouped fallback (~420 chars broken at `.!?`), weave speaker transitions (`**Host:**`), and extract `## Links Mentioned`. The saved copy keeps line times and speakers so a reload does not lose the structure.
- **The clipboard is the fastest source.** Paste anywhere on the console, or click Image with a screenshot already copied. Coming back to the window only *offers* the clipboard. Browsers cannot watch the clipboard in the background, so a true watcher (send on ⌘C, while another app has focus) is a native-app job, not a web one.
- **Control budget: one dial per idea.** Size carries its own line count; the style carries its own frame colour; the microphone inherits the talk's language and engine from the QR query and only overrides on the phone. A control that duplicates another one gets deleted, not hidden in a submenu.
- **Motto: juicy, sticky, fresh.** The vibe lives in aesthetics of utility, in what we offer, and in how things feel to touch. Never in gags.
  - Juicy: every button squishes on press and lifts on hover with `--spring` (`cubic-bezier(.2,.9,.3,1.35)`); the newest caption glows in; the audience's fresh line gets a highlighter sweep; interim text carries a caret. Each of these tells the reader something.
  - Sticky: small, honest feedback. Count badge bumps when it changes, step numbers carry a pastel chip, the mic page says how many words were captioned.
  - Fresh: warm cream ground, one accent per state (mint = live, pink = attention, lilac = phone mic), lots of air. No gradients on text surfaces, no glassmorphism.
  - Classy is the ceiling. No confetti, no "That's a wrap", no "Nice one", no idle nudges. If a flourish needs a switch to turn it off, it shouldn't exist. Copy is warm and factual.
  - Landing animations on inline caption text must be wrap-safe (opacity/text-shadow only, never `inline-block` + transform).
  - Everything respects `prefers-reduced-motion`.
- **Choices are curated, not exhaustive.** Faces: System, Inter, Atkinson Hyperlegible, Fraunces, JetBrains Mono (all OFL, vendored, Latin + Latin Ext). Weights: 400 / 500 / 700. Flow: live / settled. Ticker depth 1–3, ring mint/pink/lilac/butter/none. Readers choose on their phone (`stl-*` in localStorage); the presenter chooses the ticker (`st-*`). Add a face only if it brings a new voice and an open licence.
- **Contrast floor.** Caption text ≥ 7:1 on every reader theme, secondary UI ≥ 4.5:1. The table in docs/ACCESSIBILITY.md has the numbers; recompute if you touch a theme colour or `--muted`.

## 📱 Appendage Pattern (Phone as Lapel Mic)
- Phone connects via `/mic/:id?lang=xx&engine=browser|deepgram#token`. The query inherits the talk's language and engine; the write token stays in the `#hash`.
- Write token rides in `#hash`, keeping credentials client-side only.
- Audio capture via Web Speech API / `getUserMedia`.
- Screen Wake Lock active while broadcasting.
- Mobile browsers enforce HTTPS for mic capture (`cloudflared tunnel --url http://localhost:8787` for mobile rehearsals).
- Never project the mic QR: it carries the write token. The fullscreen modal copy says so.
- **Handoff rule.** Phone live ⇒ console pauses the laptop recogniser (`pausedByPhone`). Phone paused ⇒ laptop stays paused, notice explains. Phone lost ⇒ laptop resumes only if it was paused by the phone. The presenter can always override with Space / Resume mic. The mic page heartbeats every 20 s while live and sends `live:false` on pause, End talk (via stop), and `pagehide` (keepalive fetch, not sendBeacon, so the token stays in a header).

## 🧠 Mental Model
- **A talk is a chat room.** Sources send lines in (laptop mic, phone mic, the typing box, Deepgram through the relay; later a native app). `pushChunk()` in server.ts is the single entry point for words; the Deepgram session and HTTP pushes both call it. Displays read them out (audience reader, console ticker, PiP float, `/ticker/:id`, OBS). Keep `server.ts` dumb: it relays text and image bytes, proxies audio to Deepgram, and stores no audio. New capability should be a new source or a new display, not a new server feature.
- The typing box sends interim on input (250 ms debounce) and final on Enter. Space in the box types a space; the global Space shortcut ignores inputs.

## 💾 Persistence (client side only)
- Reader: `stl-talk-<roomId>` = `{ id, title, lines, seen, startedAt, updatedAt, ended, stars }`, index `stl-talks` (last 20, each with words/kept/links). Restored on load; `seen` keeps the backlog offset logic exact. Room gone + saved copy ⇒ state "Saved on this phone" with the export card.
- Console: `st-talk-<roomId>` same shape plus `code`, index `st-talks` (last 10, shown under Earlier talks). `transcript[]` is every final in room order; `finals[]` is only the ticker tail. The open room is in `sessionStorage` `st-room` (tab-scoped, token never leaves the tab) and `resumeRoom()` picks it up on load if the relay still has it.
- Server keeps nothing beyond the open room's last 400 lines and its images (40 / 24 MB), all in memory. Keep it that way.

## 🚀 Hosting
- One process, one machine (in-memory rooms). `Dockerfile` + `fly.toml` (never scale to zero). Not Deno Deploy / multi-isolate until rooms move to KV.

## 🎛️ Console layout (keep it this lean)
- Top: the talk bar (title, language, engine, one action) which collapses to the title plus Pause/End once live. Then two cards of matched height: **Stage** (ticker, which doubles as the typing field, then size, four style chips, Display, More = flow + shuffle, transcript strip with Export) and **Room** (one QR for the room, the four-letter code, Copy link / Full screen / Mic). The lapel mic pairing card lives in the modal behind **Mic** because it carries the write key.
- Gone on purpose: the quickstart strip, the VU meter and Test mic button (the ghost is the meter), the Screen Overlay blurb. Don't bring them back; add guidance to empty states instead.

## 🗺️ Strategy
- ROADMAP.md holds the position, pricing model, numbers, guardrails and build order. Read it before proposing product work; update it when a decision changes. Licence: Pablo has OK'd moving to AGPL, deferred until a hosted service is close. Stay MIT until asked.
- `signed_noise.ts` stays dependency-free and product-agnostic so it can be lifted into QR Buddy.

## 🧭 Presenter Rules
- Space toggles mic pause/resume, never ends the talk. Ending is a deliberate click.
- Finals reach the ticker via the SSE echo (works for laptop and phone mic alike); local push only if the relay is unreachable.
- Fatal recogniser errors (`not-allowed`, `audio-capture`, ...) pause instead of restart-looping.
