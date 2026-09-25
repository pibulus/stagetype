# 🎙️ StageType (CLAUDE.md)
> Live presentation captions ticker + wireless phone lapel mic + instant audience QR reader.
> Part of the TalkType family. Sovereign, zero-dependency, in-memory architecture.

## 🏃 Quick Start & Commands
```bash
deno task dev      # Start development server with auto-reload (port 8787)
deno task start    # Start production server
deno task test     # Run room lifecycle and SSE unit test suite
deno task check    # TypeScript type-checking
```

## 🌐 Routes & Ports
- Default port: `8787` (`http://localhost:8787`)
- Presenter Console: `GET /`
- Audience Live Reader: `GET /live/:roomId`
- Phone Lapel Mic: `GET /mic/:roomId#token`
- Network Discovery: `GET /api/info` (returns LAN IP and port for QR encoding)
- Static: `GET /vendor/qrcode.js`, `GET /vendor/fonts.css`, `GET /vendor/fonts/*.woff2` (allowlisted names only, immutable cache), `GET /ghost.svg` (favicon)
- Room Lifecycle API:
  - `POST /api/room` (optional `{ title }`) -> `{ id, token, title }` (capped at 1000 open rooms; title ≤ 80 chars)
  - `POST /api/room/:id` (Bearer auth) -> pushes speech chunk `{ text, final }`; `{ ping: true }` is a silent keepalive
  - `GET /api/room/:id/stream` -> Server-Sent Events: `backlog { lines, offset, startedAt, title }`, `interim`, `final { text, seq }`, `end`
  - `DELETE /api/room/:id` (Bearer auth) -> ends talk and flushes room
- Invariants: token compared in constant time; push body ≤ 16 KB; backlog keeps last 400 lines and reports `offset`; every listener's ping timer is cleared on end/sweep (Deno's test sanitizer enforces this).

## 🎨 Design System & Aesthetic Laws
- **Soft Neo Toybrut**:
  - Ground: `#fffef7`
  - Paper: `#fbf1e4`
  - Ink: `#1e1714`
  - Line: `#3a2e28`
  - Pastels: Pink `#ffb3d1`, Mint `#b8f0d8`, Lilac `#d9c8ff`, Butter `#fff0a8`
- **Zero absolute white (`#fff`) or absolute black (`#000`)** across body and UI surfaces.
- **NO EMOJIS as button labels or copy garnish**. Keep buttons typographic and clear.
- `button { display: inline-flex }` beats the `hidden` attribute; keep the `button[hidden] { display: none }` rule.
- **Mascot**: TalkType ghost SVG in header. It is alive: eyes blink (`.eye` paths), it floats faster when live, and it swells with mic level via the `--vu` CSS variable.
- **Motto: juicy, sticky, fresh.** The vibe lives in aesthetics of utility, in what we offer, and in how things feel to touch. Never in gags.
  - Juicy: every button squishes on press and lifts on hover with `--spring` (`cubic-bezier(.2,.9,.3,1.35)`); the newest caption glows in; the audience's fresh line gets a highlighter sweep; interim text carries a caret. Each of these tells the reader something.
  - Sticky: small, honest feedback. Count badge bumps when it changes, sticker-style step numbers, the mic page says how many words were captioned. The ghost blinks and swells with your voice because it is the connection indicator, not a mascot on holiday.
  - Fresh: dot-grid ground, one accent per state (mint = live, pink = attention, lilac = phone mic), lots of air. No gradients on surfaces, no glassmorphism.
  - Classy is the ceiling. No confetti, no "That's a wrap", no "Nice one", no idle nudges. If a flourish needs a switch to turn it off, it shouldn't exist. Copy is warm and factual.
  - Landing animations on inline caption text must be wrap-safe (opacity/text-shadow only, never `inline-block` + transform).
  - Everything respects `prefers-reduced-motion`.
- **Choices are curated, not exhaustive.** Faces: System, Inter, Atkinson Hyperlegible, Fraunces, JetBrains Mono (all OFL, vendored, Latin + Latin Ext). Weights: 400 / 500 / 700. Flow: live / settled. Ticker depth 1–3, ring mint/pink/lilac/butter/none. Readers choose on their phone (`stl-*` in localStorage); the presenter chooses the ticker (`st-*`). Add a face only if it brings a new voice and an open licence.
- **Contrast floor.** Caption text ≥ 7:1 on every reader theme, secondary UI ≥ 4.5:1. The README table has the numbers; recompute if you touch a theme colour or `--muted`.

## 📱 Appendage Pattern (Phone as Lapel Mic)
- Phone connects via `/mic/:id#token`.
- Write token rides in `#hash`, keeping credentials client-side only.
- Audio capture via Web Speech API / `getUserMedia`.
- Screen Wake Lock active while broadcasting.
- Mobile browsers enforce HTTPS for mic capture (`cloudflared tunnel --url http://localhost:8787` for mobile rehearsals).
- Never project the mic QR: it carries the write token. The fullscreen modal copy says so.

## 🧭 Presenter Rules
- Space toggles mic pause/resume, never ends the talk. Ending is a deliberate click.
- Finals reach the ticker via the SSE echo (works for laptop and phone mic alike); local push only if the relay is unreachable.
- Fatal recogniser errors (`not-allowed`, `audio-capture`, ...) pause instead of restart-looping.
